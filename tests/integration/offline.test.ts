import { it,expect } from 'vitest';
import { temporaryRepo,inputFor,testEngine } from '../helpers';
import { offlineCopy } from '../../src/storage/offline';
import { importSave } from '../../src/storage/transfer';
import type { Bootstrap } from '../../src/domain/offline';
import { DEFAULT_PROFILES,capabilities,ENDPOINTS } from '../../src/llm/config';
import { publicNpcs } from '../../src/content/canon';
import { validateCopyReplacement,validateOfflineCopy } from '../../src/client/offline-copy';
const bootstrap:Bootstrap={scenarios:[],saves:[],npcs:publicNpcs(),dataDir:'private-path',profiles:DEFAULT_PROFILES.map(p=>({...p,hasKey:true,endpoint:ENDPOINTS[p.provider],capabilities:capabilities(p)})),selected:{narrator:'mock',extractor:'same'},style:'克制',lastError:'',backupError:'',accessMode:'local'};
it('downloads complete versioned snapshots; the projected book at an old node excludes future knowledge',async()=>{
  const repo=temporaryRepo();try{
    const save=repo.createSave(),root=repo.view(save.id).turns[0],engine=testEngine(repo),input=inputFor(repo,save.id);engine.start(input);await engine.wait(input.clientRequestId);
    const current=repo.view(save.id);repo.fork(save.id,current.branch.id,root.id,'旧时');
    const copy=offlineCopy(repo,save.id,bootstrap);expect(copy.scope).toMatchObject({branches:2,turns:2});
    expect(()=>validateOfflineCopy(copy)).not.toThrow();
    expect(copy.bootstrap.profiles.every(p=>!p.hasKey)).toBe(true);expect(copy.bootstrap.dataDir).not.toContain('private-path');
    const old=copy.books[current.branch.id+':'+root.id],latest=copy.books[current.branch.id+':'+current.turns.at(-1)!.id];
    expect(old.atTurnId).toBe(root.id);expect(latest.atTurnId).not.toBe(root.id);
    expect(old.characters.every(c=>c.timeline.every(e=>e.sourceTurnId===root.id))).toBe(true);
    const restored=importSave(repo,JSON.stringify(copy.archive));expect(repo.view(restored.id).turns.length).toBe(1);expect(repo.view(restored.id).branches.length).toBe(2);
    expect(repo.view(save.id).turns.length).toBe(1);expect(offlineCopy(repo,save.id,bootstrap).revision).toBe(copy.revision);
    repo.putSave({...save,title:'另一个卷名'});expect(offlineCopy(repo,save.id,bootstrap).revision).not.toBe(copy.revision);
    expect(offlineCopy(repo,save.id,bootstrap).serverId).toBe(copy.serverId);
  }finally{repo.close();}
});
it.each(['missing book','missing branch','missing turn','wrong source','wrong prose','wrong head','wrong scope','wrong revision'])('rejects an incomplete offline download: %s',problem=>{
  const repo=temporaryRepo();try{
    const save=repo.createSave(),copy=offlineCopy(repo,save.id,bootstrap),view=Object.values(copy.views)[0],turn=view.turns[0];
    if(problem==='missing book')delete copy.books[view.branch.id+':'+turn.id];
    if(problem==='missing branch')delete copy.views[view.branch.id];
    if(problem==='missing turn')view.turns=[];
    if(problem==='wrong source')copy.books[view.branch.id+':'+turn.id].atTurnId=crypto.randomUUID();
    if(problem==='wrong prose')turn.body+='不应混入的原文';
    if(problem==='wrong head')view.branch.headTurnId=crypto.randomUUID();
    if(problem==='wrong scope')copy.scope.turns++;
    if(problem==='wrong revision')copy.revision='a'.repeat(64);
    expect(()=>validateOfflineCopy(copy)).toThrow('原有副本保留');
  }finally{repo.close();}
});
it('refuses a late older download or a different source without overwriting the latest copy',()=>{
  const repo=temporaryRepo();try{
    const save=repo.createSave(),old=offlineCopy(repo,save.id,bootstrap);old.downloadedAt='2026-10-01T00:00:00.000Z';
    const newer={...old,downloadedAt:'2026-10-01T00:01:00.000Z'};
    expect(()=>validateCopyReplacement(newer,old)).not.toThrow();
    expect(()=>validateCopyReplacement(old,newer)).toThrow('保留较新的');
    expect(()=>validateCopyReplacement({...newer,serverId:'different-server'},newer)).toThrow('服务来源已改变');
  }finally{repo.close();}
});
