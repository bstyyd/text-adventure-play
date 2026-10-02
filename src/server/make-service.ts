import {ScenarioService} from '../scenario/service';
import { Repository } from '../storage/repository';
import { TurnEngine } from '../engine/engine';
import { SuggestionService } from '../engine/suggestions';
import { CharacterService } from '../characters/service';
import { DEFAULT_PROFILES, capabilities, capabilityKey } from '../llm/config';
import { SiliconFlowProvider,DeepSeekProvider } from '../llm/chat-completions';
import { GoogleGemmaProvider } from '../llm/google-gemma';
import { MockProvider } from '../llm/mock';
import { LocalSecurity,SecretVault } from '../security/local';
import { ProviderError } from '../llm/types';
import { safeError } from '../engine/engine';
import type { Capabilities, Profile } from '../domain/types';
import {guardedProvider} from './guarded-provider';
import type {SiteControl} from './site-control';
export function makeService(options:{dir?:string;repo?:Repository;security?:LocalSecurity;control?:SiteControl;playerId?:string;vault?:SecretVault;beforeAttempt?:()=>Promise<void>}={}){
  const repo=options.repo||new Repository(options.dir),vault=options.vault||new SecretVault(),security=options.security||new LocalSecurity();
  if(options.control){repo.putProfile(options.control.config.profile);repo.setSetting('narrator','site-model');repo.setSetting('extractor','same');}
  else if(!repo.profiles().length)for(const p of DEFAULT_PROFILES)repo.putProfile(p);
  const provider=(p:Profile)=>{
    const inner=p.provider==='mock'?new MockProvider():p.provider==='siliconflow'?new SiliconFlowProvider():p.provider==='deepseek'?new DeepSeekProvider():new GoogleGemmaProvider();
    const checked=options.control?guardedProvider(inner,options.control,options.playerId!):inner;
    if(!options.beforeAttempt)return checked;
    const request=(r:import('../llm/types').TextRequest)=>({...r,onAttempt:async()=>{await options.beforeAttempt!();r.signal.throwIfAborted();await r.onAttempt?.();}});
    return {id:checked.id,generateText:(r:import('../llm/types').TextRequest)=>checked.generateText(request(r)),streamText:(r:import('../llm/types').TextRequest)=>checked.streamText(request(r)),extractJson:(r:import('../llm/types').TextRequest)=>checked.extractJson(request(r)),testConnection:(r:import('../llm/types').TextRequest)=>checked.testConnection(request(r)),listModels:(r:import('../llm/types').TextRequest)=>checked.listModels(request(r))};
  };
  const getCaps=(p:Profile)=>repo.setting<Capabilities>('cap:'+capabilityKey(p),capabilities(p));
  const getProfiles=()=>{
    const list=repo.profiles();
    const narrator=options.control?.config.profile||list.find(p=>p.id===repo.setting('narrator','mock'))||list[0];
    const extractor=list.find(p=>p.id===repo.setting('extractor','same'))||narrator;
    return {narrator,extractor};
  };
  const engine=new TurnEngine(repo,{provider,secret:p=>vault.get(p),profiles:getProfiles,capabilities:getCaps,characterLimit:()=>repo.setting('character-context-limit',12),style:()=>repo.setting('style','克制，留白，以对白与动作推进。'),reportFailure:(profile,error)=>{
    if(error instanceof ProviderError){repo.setSetting('provider-error',safeError(error));if(error.status===400)repo.setSetting('cap:'+capabilityKey(profile),{...getCaps(profile),streaming:'unknown',jsonObject:'unknown',jsonSchema:'unknown',acceptedParameters:['model'],checkedAt:new Date().toISOString(),source:'probe'});}
  }});
  const suggestions=new SuggestionService(repo,{provider,secret:p=>vault.get(p),profiles:getProfiles,capabilities:getCaps});
  return {repo,vault,security,engine,suggestions,scenarios:new ScenarioService(repo,{provider,secret:p=>vault.get(p),profiles:getProfiles,capabilities:getCaps}),characters:new CharacterService(repo),provider,getCaps,getProfiles};
}
