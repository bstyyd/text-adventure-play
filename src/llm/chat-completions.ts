import { BaseProvider, ProviderError, providerError, validText, requestError } from './types';
import type { ModelList, StreamEvent, TextRequest, TextResult } from './types';
import { ENDPOINTS } from './config';
type ChatResponse={id?:string;choices?:{message?:{content?:string;refusal?:string};delta?:{content?:string;refusal?:string};finish_reason?:string|null}[];usage?:{prompt_tokens?:number;completion_tokens?:number};error?:unknown};
const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  signal.throwIfAborted();const end=()=>{clearTimeout(t);reject(new DOMException('Cancelled','AbortError'));};
  const t=setTimeout(()=>{signal.removeEventListener('abort',end);resolve();},ms);signal.addEventListener('abort',end,{once:true});
});
export function retryDelay(value:string|null){
  if(!value)return 750;
  const seconds=Number(value);return Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(value)-Date.now());
}
export async function* decodeSSE(body:ReadableStream<Uint8Array>,signal:AbortSignal,firstMs=60000){
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='',first=true;
  try{
    while(true){
      signal.throwIfAborted();
      let timer:ReturnType<typeof setTimeout>|undefined;
      const onAbort=()=>{void reader.cancel();};
      signal.addEventListener('abort',onAbort,{once:true});
      let item:ReadableStreamReadResult<Uint8Array>;
      try{item=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel();reject(new ProviderError('FIRST_TEXT_TIMEOUT','等待首字或后续响应超时。'));},first?firstMs:90000);})]);}
      finally{clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
      signal.throwIfAborted();
      if(item.done){buffer+=decoder.decode();if(buffer.trim())throw new ProviderError('STREAM_TRUNCATED','流式数据帧不完整。');break;}
      buffer+=decoder.decode(item.value,{stream:true});
      if(buffer.length>200000)throw new ProviderError('STREAM_TOO_LARGE','流式帧过大。');
      let boundary:number;
      // CRLF can itself straddle transport chunks; normalize only complete frames.
      while((boundary=buffer.search(/\r?\n\r?\n/))>=0){
        const match=/\r?\n\r?\n/.exec(buffer.slice(boundary))!;
        const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+match[0].length);
        const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
        if(data){first=false;yield data;}
      }
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export class ChatCompletionsProvider extends BaseProvider{
  constructor(public id:'siliconflow'|'deepseek',private fetcher:typeof fetch=fetch){super();}
  private payload(r:TextRequest,stream:boolean){
    const system=r.capabilities.systemInstruction==='supported'?[{role:'system',content:r.system}]:[{role:'user',content:'叙事规则与可信上下文：\n'+r.system}];
    const payload:Record<string,unknown>={model:r.profile.model,messages:[...system,...r.messages],stream};
    if(r.capabilities.acceptedParameters.includes('max_tokens'))payload.max_tokens=r.profile.maxOutputTokens;
    if(r.format==='json_schema'&&r.capabilities.jsonSchema==='supported')payload.response_format={type:'json_schema',json_schema:{name:'memory',strict:true,schema:r.schema}};
    else if(r.format==='json_object'&&r.capabilities.jsonObject==='supported')payload.response_format={type:'json_object'};
    return payload;
  }
  private async request(r:TextRequest,stream:boolean,path='/chat/completions',method='POST'){
    if(!r.profile.model&&method==='POST')throw new ProviderError('MODEL_REQUIRED','请先选择完整模型 ID。');
    if(!r.key)throw new ProviderError('KEY_REQUIRED','请先在设置中输入此供应商的 API Key。');
    const total=AbortSignal.any([r.signal,AbortSignal.timeout(r.profile.timeoutMs)]);
    let count=0;
    for(let attempt=0;attempt<2;attempt++){
      if(total.aborted)throw requestError(total.reason,total,r.signal);
      await r.onAttempt?.();count++;
      if(total.aborted)throw requestError(total.reason,total,r.signal);
      const headers=new AbortController(),startedAt=Date.now();
      // fetch resolves at response headers, which may arrive only AFTER non-streamed generation.
      // A TCP-style 15s deadline must never be applied to that whole model computation.
      const headerMs=method==='GET'?r.profile.connectTimeoutMs:stream?r.profile.firstTextTimeoutMs:r.profile.timeoutMs;
      const timer=setTimeout(()=>headers.abort(new ProviderError(stream?'FIRST_TEXT_TIMEOUT':'TIMEOUT',stream?'等待首个正文字符超时，可增加首字等待时间后重试。':'等待供应商响应超时，请检查网络或增加请求超时。')),headerMs);
      const signal=AbortSignal.any([total,headers.signal]);
      let response:Response;
      try{
        response=await this.fetcher(ENDPOINTS[this.id]+path,{method,redirect:'error',headers:{Authorization:'Bearer '+r.key,'Content-Type':'application/json'},body:method==='POST'?JSON.stringify(this.payload(r,stream)):undefined,signal});
      }catch(error){
        throw requestError(error,signal,r.signal);
      }finally{clearTimeout(timer);}
      if(response.ok)return {response,signal:total,count,startedAt};
      const delay=retryDelay(response.headers.get('retry-after'));
      await response.body?.cancel();
      if(attempt===0&&(response.status===429||response.status>=500)&&delay<=10000){
        try{await sleep(delay,total);}catch(error){throw requestError(error,total,r.signal);}
        continue;
      }
      throw providerError(response.status);
    }
    throw new ProviderError('NETWORK','请求失败。');
  }
  async generateText(r:TextRequest):Promise<TextResult>{
    const {response,count,signal}=await this.request(r,false);
    let json:ChatResponse;
    try{json=await response.json() as ChatResponse;signal.throwIfAborted();}
    catch(error){throw error instanceof SyntaxError?new ProviderError('RESPONSE_JSON','供应商响应不是完整 JSON，未提交剧情。'):requestError(error,signal,r.signal);}
    if(json.error)throw new ProviderError('REMOTE_ERROR','供应商返回错误结果。');
    const choice=json.choices?.[0],text=validText(choice?.message?.content||'',choice?.finish_reason||undefined,choice?.message?.refusal);
    return {text,finishReason:'stop',usage:{input:json.usage?.prompt_tokens||0,output:json.usage?.completion_tokens||0},requestId:json.id||response.headers.get('x-request-id'),requestCount:count};
  }
  async *streamText(r:TextRequest):AsyncIterable<StreamEvent>{
    if(r.capabilities.streaming!=='supported'){yield {type:'complete',result:await this.generateText(r)};return;}
    const {response,signal:requestSignal,count,startedAt}=await this.request(r,true);
    if(!response.body)throw new ProviderError('EMPTY','响应没有数据流。');
    const firstText=new AbortController();
    const firstTimer=setTimeout(()=>firstText.abort(new ProviderError('FIRST_TEXT_TIMEOUT','等待首个正文字符超时，可增加首字等待时间后重试。')),Math.max(1,r.profile.firstTextTimeoutMs-(Date.now()-startedAt)));
    const signal=AbortSignal.any([requestSignal,firstText.signal]);
    let text='',finish:string|undefined,done=false,requestId:string|null=null;
    let usage={input:0,output:0};
    try{for await(const frame of decodeSSE(response.body,signal,r.profile.firstTextTimeoutMs)){
      if(frame==='[DONE]'){done=true;break;}
      let json:ChatResponse;try{json=JSON.parse(frame);}catch{throw new ProviderError('STREAM_JSON','流式帧不是有效 JSON。');}
      if(json.error)throw new ProviderError('REMOTE_ERROR','供应商返回流式错误。');
      const c=json.choices?.[0];
      if(c?.delta?.refusal)throw new ProviderError('REFUSED','模型拒绝生成。');
      if(c?.delta?.content){clearTimeout(firstTimer);text+=c.delta.content;if(text.length>100000)throw new ProviderError('TOO_LARGE','输出过长。');yield {type:'delta',text:c.delta.content};}
      if(c?.finish_reason)finish=c.finish_reason;
      if(json.id)requestId=json.id;
      if(json.usage)usage={input:json.usage.prompt_tokens||0,output:json.usage.completion_tokens||0};
    }}catch(error){
      const failure=requestError(error,signal,r.signal);failure.partialText=text.slice(0,100000);failure.finishReason=finish;throw failure;
    }finally{clearTimeout(firstTimer);}
    if(!done)throw new ProviderError('STREAM_TRUNCATED','流式请求中断，未收到完整结束信号；草稿尚未提交。',undefined,text,finish);
    validText(text,finish);
    yield {type:'complete',result:{text,finishReason:'stop',usage,requestId,requestCount:count}};
  }
  async listModels(r:TextRequest):Promise<ModelList>{
    if(this.id==='deepseek')return {status:'unsupported',models:[],note:'保留官方预设与手填；未启用未经本项目核对的模型列表接口。'};
    const {response}=await this.request(r,false,'/models?sub_type=chat','GET');
    const json=await response.json() as {data?:{id:string}[]};
    return {status:'supported',models:(json.data||[]).filter(m=>typeof m.id==='string').map(m=>({id:m.id}))};
  }
}
export class SiliconFlowProvider extends ChatCompletionsProvider{constructor(fetcher?:typeof fetch){super('siliconflow',fetcher);}}
export class DeepSeekProvider extends ChatCompletionsProvider{constructor(fetcher?:typeof fetch){super('deepseek',fetcher);}}
