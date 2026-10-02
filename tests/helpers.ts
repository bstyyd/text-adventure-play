import { mkdirSync,mkdtempSync } from 'node:fs';
import path from 'node:path';
import { Repository } from '../src/storage/repository';
import { MockProvider } from '../src/llm/mock';
import { TurnEngine } from '../src/engine/engine';
import { DEFAULT_PROFILES,capabilities } from '../src/llm/config';
import type { TextRequest } from '../src/llm/types';
import type { Draft,Extraction,Profile,TurnInput } from '../src/domain/types';
export function temporaryRepo(){
  const base=path.resolve('.test-data');mkdirSync(base,{recursive:true});
  return new Repository(mkdtempSync(path.join(base,'case-')));
}
export function testEngine(repo:Repository,provider=new MockProvider()){
  return new TurnEngine(repo,{provider:()=>provider,secret:()=>'',profiles:()=>({narrator:DEFAULT_PROFILES[0],extractor:DEFAULT_PROFILES[0]})});
}
export function inputFor(repo:Repository,saveId:string,text='让沈彻进来'):TurnInput{
  const v=repo.view(saveId);return {clientRequestId:crypto.randomUUID(),saveId,branchId:v.branch.id,expectedHeadTurnId:v.branch.headTurnId,playerText:text,target:null,mode:'story'};
}
export function textRequest(profile:Profile):TextRequest{
  return {profile,key:'fixture-secret',system:'叙事规则',messages:[{role:'user',content:'测试'},{role:'assistant',content:'已采用正文'},{role:'user',content:'你好'}],capabilities:capabilities(profile),signal:new AbortController().signal};
}
export function emptyExtraction():Extraction{return {sceneProposal:null,facts:[],knowledgeProposals:[],relationshipEvidence:[],eventProposals:[],pendingThreads:[],suggestedActions:['观察','询问','等待'],validationWarnings:[]};}
export function putLegacyDraft(repo:Repository,saveId:string,playerText:string,body:string,extraction:Extraction|null=null){
  const input=inputFor(repo,saveId,playerText),draft:Draft={...input,id:input.clientRequestId,body,status:'failed',error:extraction?'天气变化没有原文依据。':'旧版本正文检查未通过：玄天华内心描述。',
    createdAt:new Date().toISOString(),profile:DEFAULT_PROFILES[0],extractProfile:DEFAULT_PROFILES[0],turnId:null,requestCount:0,extraction,usage:{input:0,output:0},bodyComplete:true,bodyFinishReason:'stop',failureStage:'validation'};
  repo.putDraft(draft);return draft;
}
