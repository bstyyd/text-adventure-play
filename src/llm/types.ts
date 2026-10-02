import type { Capabilities, Profile, ProviderId } from '../domain/types';
export type Message={role:'user'|'assistant';content:string};
export type TextRequest={profile:Profile;key:string;system:string;messages:Message[];signal:AbortSignal;capabilities:Capabilities;format?:'text'|'json_object'|'json_schema';schema?:Record<string,unknown>;onAttempt?:(()=>void)|(()=>Promise<void>)};
export type TextResult={text:string;finishReason:'stop';usage:{input:number;output:number};requestId:string|null;requestCount:number};
export type StreamEvent={type:'delta';text:string}|{type:'complete';result:TextResult};
export type ModelList={status:'supported'|'unsupported';models:{id:string;methods?:string[]}[];note?:string};
export interface LLMProvider{
  id:ProviderId;
  generateText(r:TextRequest):Promise<TextResult>;
  streamText(r:TextRequest):AsyncIterable<StreamEvent>;
  extractJson(r:TextRequest):Promise<TextResult>;
  testConnection(r:TextRequest):Promise<TextResult>;
  listModels(r:TextRequest):Promise<ModelList>;
}
export class ProviderError extends Error{
  constructor(public code:string,message:string,public status?:number,public partialText?:string,public finishReason?:string){super(message);}
}
export function requestError(error:unknown,signal:AbortSignal,caller:AbortSignal){
  if(error instanceof ProviderError)return error;
  if(caller.aborted)return new ProviderError('CANCELLED','请求已停止；上游仍可能计费。');
  if(signal.aborted){
    if(signal.reason instanceof ProviderError)return signal.reason;
    return new ProviderError('TIMEOUT','已达到本次请求的总等待时间，可在模型设置中增加请求超时后重试。');
  }
  return new ProviderError('NETWORK','与供应商的连接中断或请求失败，请检查网络后重试。');
}
export function providerError(status:number){
  const messages:Record<number,string>={400:'参数或模型能力不匹配，请检查模型与能力设置。',401:'密钥无效或已失效。',403:'账号无权访问该模型。',404:'模型或官方 endpoint 不存在。',429:'供应商限流，请稍后手动重试。'};
  return new ProviderError('HTTP_'+status,messages[status]||'供应商暂时不可用（HTTP '+status+'）。',status);
}
export function validText(text:string,finish:string|undefined,refusal?:unknown){
  if(refusal)throw new ProviderError('REFUSED','模型拒绝或阻止了生成；未提交剧情。');
  if(text.length>100000)throw new ProviderError('TOO_LARGE','输出超过本地安全长度，仅保留前100000字符作为片段。',undefined,text.slice(0,100000),finish);
  if(finish==='length'||finish==='MAX_TOKENS')throw new ProviderError('OUTPUT_LIMIT','输出达到 token 上限，正文尚未完整；可增加输出上限后重新生成，或核对并修订草稿。',undefined,text,finish);
  if(finish!=='stop'&&finish!=='STOP')throw new ProviderError('INCOMPLETE','未收到正常结束标志，输出可能被截断或阻止；尚未提交。',undefined,text,finish);
  if(!text.trim())throw new ProviderError('EMPTY','模型返回空正文；未提交剧情。');
  return text;
}
export abstract class BaseProvider implements LLMProvider{
  abstract id:ProviderId;
  abstract generateText(r:TextRequest):Promise<TextResult>;
  abstract listModels(r:TextRequest):Promise<ModelList>;
  async *streamText(r:TextRequest):AsyncIterable<StreamEvent>{yield {type:'complete',result:await this.generateText(r)};}
  extractJson(r:TextRequest){return this.generateText(r);}
  testConnection(r:TextRequest){return this.generateText({...r,system:'请只回复：连接正常。',messages:[{role:'user',content:'这是不含剧情的连接测试。'}],format:'text',profile:{...r.profile,maxOutputTokens:256}});}
}
