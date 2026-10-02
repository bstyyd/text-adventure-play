import {ProfileSchema,type Profile} from '../domain/types';
export type PublicConfig={dir:string;profile:Profile;maxPlayers:number;maxOutput:number;maxInputBytes:number;dailyRequests:number;playerDailyRequests:number;dailyOutput:number;dailyInputBytes:number;maxActive:number};
function number(env:Record<string,string|undefined>,key:string,fallback:number,min:number,max:number){
  const n=env[key]?Number(env[key]):fallback;
  if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(key+' 超出允许范围');
  return n;
}
export function publicConfig(env:Record<string,string|undefined>=process.env):PublicConfig|undefined{
  if(env.APP_PLAYER_MODE!=='isolated')return;
  const provider=env.APP_SHARED_PROVIDER||'mock';
  if(!['mock','siliconflow','deepseek','google-gemma'].includes(provider))throw new Error('APP_SHARED_PROVIDER 不是受支持供应商');
  const model=env.APP_SHARED_MODEL||(provider==='google-gemma'?'gemma-4-26b-a4b-it':provider==='mock'?'mock-novel-v1':'');
  if(provider!=='mock'&&!model)throw new Error('请显式配置 APP_SHARED_MODEL');
  if(!env.APP_DATA_DIR)throw new Error('隔离模式必须明确持久 APP_DATA_DIR');
  if(env.APP_ACCESS_MODE==='public'){
    if(provider==='mock')throw new Error('正式分享站必须配置真实 APP_SHARED_PROVIDER，不把 Mock 冒充游戏模型');
    const configured=provider==='siliconflow'?env.SILICONFLOW_API_KEY:provider==='deepseek'?env.DEEPSEEK_API_KEY:env.GOOGLE_AI_API_KEY||env.GOOGLE_API_KEY;
    if(!configured)throw new Error('站长模型密钥尚未配置');
  }
  const maxOutput=number(env,'APP_MAX_OUTPUT_TOKENS',4096,256,8192);
  return {dir:env.APP_DATA_DIR,profile:ProfileSchema.parse({id:'site-model',label:'站点模型',provider,model,maxOutputTokens:maxOutput,
    timeoutMs:number(env,'APP_MODEL_TIMEOUT_MS',180000,5000,300000),length:'normal'}),
    maxPlayers:number(env,'APP_MAX_PLAYERS',100,1,1000),maxOutput,maxInputBytes:number(env,'APP_MAX_INPUT_BYTES',131072,4096,262144),
    dailyRequests:number(env,'APP_LLM_DAILY_REQUESTS',200,1,10000),playerDailyRequests:number(env,'APP_PLAYER_DAILY_REQUESTS',20,1,1000),
    dailyOutput:number(env,'APP_LLM_DAILY_OUTPUT_TOKENS',409600,256,10000000),
    dailyInputBytes:number(env,'APP_LLM_DAILY_INPUT_BYTES',12000000,4096,100000000),
    maxActive:number(env,'APP_MAX_ACTIVE_MODEL_CALLS',4,1,16)};
}
