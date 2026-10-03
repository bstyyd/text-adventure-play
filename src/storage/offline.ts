import { randomUUID } from 'node:crypto';
import type { Bootstrap, OfflineCopy } from '../domain/offline';
import { publicView } from '../characters/public';
import { CharacterService } from '../characters/service';
import type { Repository } from './repository';
import { exportSave } from './transfer';

export function offlineCopy(repo:Repository,saveId:string,bootstrap:Bootstrap):OfflineCopy{
  return repo.db.transaction(()=>{
    const archive=exportSave(repo,saveId),save=archive.payload.save;
    const serverId=repo.setting<string>('server-id','')||randomUUID();
    if(!repo.setting('server-id',''))repo.setSetting('server-id',serverId);
    const views:OfflineCopy['views']={},books:OfflineCopy['books']={},characters=new CharacterService(repo);
    for(const branch of archive.payload.branches){
      const view=publicView(repo.view(saveId,branch.id));
      // In-flight drafts are recovered separately, never treated as a saved node.
      views[branch.id]={...view,drafts:[]};
      for(const turn of view.turns)books[branch.id+':'+turn.id]=characters.book(saveId,branch.id,turn.id);
    }
    const dates=archive.payload.turns.map(t=>t.createdAt).sort();
    return {formatVersion:1 as const,serverId,revision:archive.sha256,downloadedAt:new Date().toISOString(),saveId,title:save.title,
      scope:{branches:archive.payload.branches.length,turns:archive.payload.turns.length,from:dates[0],to:dates.at(-1)!},views,books,archive,
      bootstrap:{...bootstrap,saves:[save],dataDir:'主存档位于提供服务的电脑／服务器；当前查看此浏览器的离线副本。',profiles:bootstrap.profiles.map(p=>({...p,hasKey:false,keyRemembered:false})),lastError:'',backupError:''}};
  })();
}
