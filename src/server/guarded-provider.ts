import type {LLMProvider,TextRequest,StreamEvent} from '../llm/types';
import {ProviderError} from '../llm/types';
import type {SiteControl} from './site-control';
export function guardedProvider(inner:LLMProvider,control:SiteControl,playerId:string):LLMProvider{
  const request=(r:TextRequest):TextRequest=>{
    const p=control.config.profile;
    if(r.profile.provider!==p.provider||r.profile.model!==p.model)throw new ProviderError('SITE_MODEL_LOCKED','站点模型由站长配置，不能切换到其他模型。',403);
    const output=Math.min(r.profile.maxOutputTokens,control.config.maxOutput);
    const input=Buffer.byteLength(r.system+JSON.stringify(r.messages)+JSON.stringify(r.schema||{}),'utf8');
    if(input>control.config.maxInputBytes)throw new ProviderError('SITE_INPUT_LIMIT','上下文超过站点输入上限；没有发起模型请求。',413);
    const parameter=p.provider==='google-gemma'?'maxOutputTokens':'max_tokens';
    return {...r,profile:{...r.profile,maxOutputTokens:output,timeoutMs:Math.min(r.profile.timeoutMs,p.timeoutMs)},
      capabilities:{...r.capabilities,acceptedParameters:[...new Set([...r.capabilities.acceptedParameters,parameter])]},
      onAttempt:async()=>{r.signal.throwIfAborted();if(p.provider!=='mock')await control.reserveAttempt(playerId,input,output);r.signal.throwIfAborted();await r.onAttempt?.();}};
  };
  const enter=()=>{
    if(control.activeCalls>=control.config.maxActive)throw new ProviderError('SITE_BUSY','当前站点正在生成的请求较多，请稍后手动重试。',429);
    control.activeCalls++;
  };
  const call=async <T>(r:TextRequest,fn:(r:TextRequest)=>Promise<T>)=>{const next=request(r);enter();try{return await fn(next);}finally{control.activeCalls--;}};
  return {id:inner.id,generateText:r=>call(r,x=>inner.generateText(x)),extractJson:r=>call(r,x=>inner.extractJson(x)),
    testConnection:r=>call(r,x=>inner.testConnection(x)),listModels:r=>call(r,x=>inner.listModels(x)),
    async *streamText(r:TextRequest):AsyncIterable<StreamEvent>{const next=request(r);enter();try{yield*inner.streamText(next);}finally{control.activeCalls--;}}};
}
