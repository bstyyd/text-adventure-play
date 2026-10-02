import { ProfileSchema } from '../domain/types';
import type { Capabilities, Profile, ProviderId } from '../domain/types';
export const ENDPOINTS:Record<ProviderId,string>={mock:'local://mock',siliconflow:'https://api.siliconflow.cn/v1',deepseek:'https://api.deepseek.com','google-gemma':'https://generativelanguage.googleapis.com/v1beta'};
export const DEFAULT_PROFILES:Profile[]=[
  {id:'mock',label:'离线演练 · Mock',provider:'mock',model:'mock-novel-v1'},
  {id:'siliconflow',label:'硅基流动',provider:'siliconflow',model:''},
  {id:'deepseek',label:'DeepSeek 官方',provider:'deepseek',model:'deepseek-flash'},
  {id:'google-gemma',label:'Google AI · Gemma',provider:'google-gemma',model:'gemma-4-26b-a4b-it'},
].map(p=>ProfileSchema.parse(p));
export function capabilities(profile:Profile):Capabilities{
  const c:Capabilities={systemInstruction:'unknown',streaming:'unknown',jsonObject:'unknown',jsonSchema:'unknown',thinkingControl:'unknown',acceptedParameters:['model'],source:'official-docs',checkedAt:'2026-09-27'};
  if(profile.provider==='mock')return {...c,systemInstruction:'supported',streaming:'unsupported',jsonObject:'supported'};
  // max_tokens is a documented base chat-completions field; advanced abilities stay model-specific.
  if(profile.provider==='siliconflow')return {...c,acceptedParameters:['model','max_tokens']};
  if(profile.provider==='deepseek'&&['deepseek-flash','deepseek-v4-pro'].includes(profile.model))
    return {...c,systemInstruction:'supported',streaming:'supported',jsonObject:'supported',acceptedParameters:['model','stream','max_tokens','response_format']};
  if(profile.provider==='google-gemma'&&profile.model==='gemma-4-26b-a4b-it')
    return {...c,systemInstruction:'supported',thinkingControl:'supported',acceptedParameters:['model','systemInstruction','maxOutputTokens']};
  return c;
}
export const capabilityKey=(p:Profile)=>p.provider+'|'+ENDPOINTS[p.provider]+'|'+p.model;
