import { GoogleGenAI } from '@google/genai';
import { BaseProvider, ProviderError, providerError, validText, requestError } from './types';
import type { TextRequest, TextResult, ModelList } from './types';
import { ENDPOINTS } from './config';
export class GoogleGemmaProvider extends BaseProvider{
  id='google-gemma' as const;
  constructor(private factory:(key:string)=>GoogleGenAI=key=>new GoogleGenAI({apiKey:key,httpOptions:{baseUrl:ENDPOINTS['google-gemma'].replace('/v1beta',''),apiVersion:'v1beta'}}),private fetcher:typeof fetch=fetch){super();}
  async generateText(r:TextRequest):Promise<TextResult>{
    if(!r.key)throw new ProviderError('KEY_REQUIRED','请输入 Google AI Key，无需 OpenAI Key。');
    r.signal.throwIfAborted();
    const signal=AbortSignal.any([r.signal,AbortSignal.timeout(r.profile.timeoutMs)]);
    const contents=r.messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));
    const config:Record<string,unknown>={abortSignal:signal,httpOptions:{timeout:r.profile.timeoutMs,retryOptions:{attempts:1}}};
    if(r.capabilities.systemInstruction==='supported')config.systemInstruction=r.system;
    else contents.unshift({role:'user',parts:[{text:'叙事规则与可信上下文：\n'+r.system}]});
    if(r.capabilities.acceptedParameters.includes('maxOutputTokens'))config.maxOutputTokens=r.profile.maxOutputTokens;
    if(r.format==='json_schema'&&r.capabilities.jsonSchema==='supported'){config.responseMimeType='application/json';config.responseJsonSchema=r.schema;}
    else if(r.format==='json_object'&&r.capabilities.jsonObject==='supported')config.responseMimeType='application/json';
    await r.onAttempt?.();
    try{
      signal.throwIfAborted();
      const result=await this.factory(r.key).models.generateContent({model:r.profile.model.replace(/^models\//,''),contents,config});
      signal.throwIfAborted();
      const candidate=result.candidates?.[0];
      const text=(candidate?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
      validText(text,candidate?.finishReason,result.promptFeedback?.blockReason);
      return {text,finishReason:'stop',usage:{input:result.usageMetadata?.promptTokenCount||0,output:result.usageMetadata?.candidatesTokenCount||0},requestId:result.responseId||null,requestCount:1};
    }catch(error){
      if(error instanceof ProviderError)throw error;
      if(signal.aborted)throw requestError(error,signal,r.signal);
      const status=(error as {status?:number}).status;
      if(status)throw providerError(status);
      throw new ProviderError('NETWORK','Google 原生请求失败，请检查网络和配置。');
    }
  }
  async listModels(r:TextRequest):Promise<ModelList>{
    if(!r.key)throw new ProviderError('KEY_REQUIRED','请输入 Google AI Key。');
    const models:ModelList['models']=[],seen=new Set<string>();let token='';
    do{
      r.signal.throwIfAborted();
      const response=await this.fetcher.call(globalThis,ENDPOINTS[this.id]+'/models?pageSize=100'+(token?'&pageToken='+encodeURIComponent(token):''),{headers:{'x-goog-api-key':r.key},redirect:'error',signal:AbortSignal.any([r.signal,AbortSignal.timeout(r.profile.connectTimeoutMs)])});
      if(!response.ok)throw providerError(response.status);
      const json=await response.json() as {models?:{name:string;supportedGenerationMethods?:string[]}[];nextPageToken?:string};
      for(const model of json.models||[])if(model.supportedGenerationMethods?.includes('generateContent'))models.push({id:model.name.replace(/^models\//,''),methods:model.supportedGenerationMethods});
      token=json.nextPageToken||'';
      if(token&&seen.has(token))throw new ProviderError('PAGINATION','模型列表分页重复。');
      seen.add(token);
      if(seen.size>100)throw new ProviderError('PAGINATION','模型列表分页过多。');
    }while(token);
    return {status:'supported',models};
  }
}
