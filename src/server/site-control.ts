import type {PublicConfig} from './public-config';
export interface SiteControl{
  config:PublicConfig;
  activeCalls:number;
  reserveAttempt(playerId:string,input:number,output:number):void|Promise<void>;
}
