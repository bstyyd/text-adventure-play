import {makeService} from './make-service';
export {makeService} from './make-service';
import {publicConfig} from './public-config';
import {PublicControl} from './public-control';
import {LocalSecurity} from '../security/local';
const globalService=globalThis as typeof globalThis&{dayaoService?:ReturnType<typeof makeService>};
type Runtime={security:LocalSecurity;control?:PublicControl;players:Map<string,ReturnType<typeof makeService>>;draining:boolean};
const globalRuntime=globalThis as typeof globalThis&{novelRuntime?:Runtime};
function runtime():Runtime{
  if(globalRuntime.novelRuntime)return globalRuntime.novelRuntime;
  const config=publicConfig(),control=config?new PublicControl(config):undefined;
  const security=new LocalSecurity(undefined,()=>Date.now(),control?{sessions:control,principal:()=>control.createPlayer(),limit:(key,max,ms)=>control.limit(key,max,ms)}:{});
  return globalRuntime.novelRuntime={security,control,players:new Map(),draining:false};
}
export function requestSecurity(){return runtime().security;}
export function deploymentStatus(playerId:string){return runtime().control?.status(playerId);}
export function draining(){return runtime().draining;}
export function drain(value:boolean){runtime().draining=value;}
export function activeJobs(){const r=runtime();return [...r.players.values(),...(globalService.dayaoService?[globalService.dayaoService]:[])].reduce((n,s)=>n+s.engine.active.size,0)+(r.control?.activeCalls||0);}
export function service(playerId='single-player'){
  const r=runtime();
  if(!r.control)return globalService.dayaoService??=makeService({security:r.security});
  if(!r.players.has(playerId))r.players.set(playerId,makeService({dir:r.control.playerDir(playerId),security:r.security,control:r.control,playerId}));
  return r.players.get(playerId)!;
}
