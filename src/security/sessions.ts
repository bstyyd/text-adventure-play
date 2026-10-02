export type Session={token:string;csrf:string;expires:number;authenticated:boolean;principalId:string};
export interface SessionStore{
  get(token:string):Session|undefined;
  set(session:Session):void;
  delete(token:string):void;
  prune(now:number):void;
}
export class MemorySessions implements SessionStore{
  private values=new Map<string,Session>();
  get(token:string){return this.values.get(token);}
  set(session:Session){this.values.set(session.token,session);}
  delete(token:string){this.values.delete(token);}
  prune(now:number){for(const [token,s] of this.values)if(s.expires<=now)this.values.delete(token);}
}
