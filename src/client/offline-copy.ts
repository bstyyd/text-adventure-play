import type { OfflineCopy } from '../domain/offline';

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const incomplete=()=>new Error('离线副本下载不完整或版本不一致，原有副本保留。请联网重新下载。');

// The server supplies public projections for reading and a separate full restore archive.
// Check that every downloaded branch has its complete path and per-node character book.
export function validateOfflineCopy(copy:OfflineCopy){
  if(!record(copy)||copy.formatVersion!==1||!copy.serverId||!/^[a-f0-9]{64}$/.test(copy.revision)||!Number.isFinite(Date.parse(copy.downloadedAt)))throw incomplete();
  if(!record(copy.views)||!record(copy.books)||!record(copy.scope)||!record(copy.archive)||!record(copy.archive.payload))throw incomplete();
  const archive=copy.archive,payload=archive.payload;
  if(!record(payload))throw incomplete();
  if(!record(payload.save)||payload.save.id!==copy.saveId||archive.sha256!==copy.revision||!Array.isArray(payload.branches)||!Array.isArray(payload.turns))throw incomplete();
  if(!Number.isSafeInteger(copy.scope.branches)||copy.scope.branches<1||!Number.isSafeInteger(copy.scope.turns)||copy.scope.turns<1||payload.branches.length!==copy.scope.branches||payload.turns.length!==copy.scope.turns||Object.keys(copy.views).length!==copy.scope.branches)throw incomplete();
  const nodes=new Map<string,Record<string,unknown>>();
  for(const turn of payload.turns){if(!record(turn)||typeof turn.id!=='string'||nodes.has(turn.id)||turn.saveId!==copy.saveId)throw incomplete();nodes.set(turn.id,turn);}
  const covered=new Set<string>(),branches=new Set<string>();
  for(const branch of payload.branches){
    if(!record(branch)||typeof branch.id!=='string'||branches.has(branch.id)||branch.saveId!==copy.saveId)throw incomplete();
    branches.add(branch.id);const view=copy.views[branch.id];
    if(!view||view.save?.id!==copy.saveId||view.branch?.id!==branch.id||view.branch.headTurnId!==branch.headTurnId||!Array.isArray(view.turns)||!view.turns.length||view.turns.at(-1)?.id!==branch.headTurnId)throw incomplete();
    let parent:string|null=null;const path=new Set<string>();
    for(const turn of view.turns){
      const raw=nodes.get(turn.id);
      const book:OfflineCopy['books'][string]|undefined=copy.books[branch.id+':'+turn.id];
      if(!raw||path.has(turn.id)||turn.saveId!==copy.saveId||turn.parentTurnId!==parent||raw.parentTurnId!==parent||turn.body!==raw.body||turn.playerText!==raw.playerText||!turn.state||!turn.effects)throw incomplete();
      if(!book||book.saveId!==copy.saveId||book.branchId!==branch.id||book.atTurnId!==turn.id||!Array.isArray(book.characters))throw incomplete();
      path.add(turn.id);covered.add(turn.id);parent=turn.id;
    }
  }
  if(covered.size!==nodes.size||!record(copy.bootstrap)||!Array.isArray(copy.bootstrap.saves)||copy.bootstrap.saves.length!==1||copy.bootstrap.saves[0]?.id!==copy.saveId||!branches.has(copy.bootstrap.saves[0]?.currentBranchId))throw incomplete();
}

export function validateCopyReplacement(next:OfflineCopy,previous?:OfflineCopy){
  if(!previous)return;
  if(previous.serverId!==next.serverId)throw new Error('此卷册的服务来源已改变。旧离线副本保留；请先导出备份并移除此设备的旧副本，再下载。');
  if(Date.parse(next.downloadedAt)<Date.parse(previous.downloadedAt))throw new Error('较早的下载结果已忽略，保留较新的完整离线副本。');
}
