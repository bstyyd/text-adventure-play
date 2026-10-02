'use client';
import { useEffect, useState } from 'react';
import { api } from '../client/api';
import { allCopies, storeCopy, writeLocal } from '../client/storage';
import type { OfflineCopy } from '../domain/offline';
import type { PwaRuntime } from '../client/pwa';
import {browserEdition} from '../client/site-path';
export function PwaTools({saveId,offline,busy,typing,pwa,beforeUpdate,report}:{saveId?:string;offline:boolean;busy:boolean;typing:boolean;pwa:PwaRuntime;beforeUpdate:()=>Promise<void>;report:(message:string)=>void}){
  const [copies,setCopies]=useState<OfflineCopy[]>([]),[downloading,setDownloading]=useState(false),[updating,setUpdating]=useState(false);
  useEffect(()=>{void allCopies().then(setCopies).catch(e=>report(e.message));},[report]);
  async function download(){
    if(!saveId||offline)return;setDownloading(true);
    try{const copy=await api<OfflineCopy>('saves/'+saveId+'/offline');await storeCopy(copy);setCopies(await allCopies());report('离线副本下载完成。断网可阅读、查看当时状态并导出；联网后才可续写。');}
    catch(e){report((e as Error).message);}finally{setDownloading(false);}
  }
  const copy=copies.find(c=>c.saveId===saveId);
  async function update(){if(busy||typing||downloading||updating)return;setUpdating(true);try{await beforeUpdate();pwa.update();}catch(e){report((e as Error).message);}finally{setUpdating(false);}}
  return <section className="settings-card pwa-tools" aria-label="安装与离线阅读"><h2>安装与离线阅读</h2>
    <p>{browserEdition()?'主存档保存在此浏览器 IndexedDB；无需下载即可读取已经保存的故事。可另存完整 JSON 备份，换设备时手动导入。':'主存档保存在运行服务的电脑或服务器。此浏览器仅保留你明确下载的离线副本，旧副本不会自动上传覆盖主存档。'}</p>
    <p>下载范围：当前卷册的全部分支、完整原文及各节点人物状态；包括供恢复用的隐藏资料，请只在自己的设备下载。</p>
    <button className="outline" disabled={!saveId||offline||busy||downloading} onClick={()=>void download()}>{downloading?'正在下载并保存完整副本…':'下载此存档供离线阅读'}</button>
    {copy&&<div role="status"><p>已完整下载：{copy.title} · {copy.scope.branches} 条分支 · {copy.scope.turns} 节</p><p>最后同步：{new Date(copy.downloadedAt).toLocaleString('zh-CN')}<br/>副本版本：<code>{copy.revision.slice(0,16)}</code></p><p>主存档后续变化不会自动写入此副本，请联网后重新下载。</p></div>}
    <p className="muted">{pwa.ready?'离线应用资源已就绪。':'离线启动需要 HTTPS（或电脑 localhost）和资源缓存完成。局域网 HTTP 可在线游玩，但无法安装离线资源。'} 浏览器可能清理数据；请定期导出 JSON 备份。</p>
    {pwa.error&&<p role="status">{pwa.error}</p>}
    <div className="button-row"><button disabled={!navigator.storage?.persist} onClick={()=>void navigator.storage.persist().then(ok=>report(ok?'已获浏览器持久存储许可；仍请保留外部备份。':'浏览器未授予持久存储；请保留外部备份。')).catch(()=>report('浏览器未能确认持久存储权限；副本仍保留，请导出外部备份。'))}>请求保留浏览器副本</button>{copy&&<button disabled={downloading||updating} onClick={()=>void writeLocal('copy:'+copy.saveId,undefined).then(()=>allCopies()).then(setCopies).catch(e=>report(e.message))}>移除此设备的离线副本</button>}</div>
    {pwa.installed?<p>已添加到主屏幕。</p>:pwa.canInstall?<button className="primary" onClick={()=>void pwa.install()}>添加到主屏幕</button>:<p>没有安装按钮时：iPhone／iPad Safari 使用“分享 → 添加到主屏幕”；Android Chrome 使用浏览器菜单中的“安装应用”或“添加到主屏幕”。不支持安装时继续在浏览器游玩即可。</p>}
    {pwa.available&&<div className="update-card" role="status"><strong>有新版本可用</strong><p>输入草稿和存档会保留。请结束输入与生成后再更新。</p><button disabled={busy||typing||downloading||updating} onClick={()=>void update()}>保存就绪后更新应用</button></div>}
  </section>;
}
