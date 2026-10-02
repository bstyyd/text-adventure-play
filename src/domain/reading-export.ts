import type { Turn } from './types';
import { dateLabel } from './calendar';

// Shared by server downloads and the explicitly downloaded browser copy.
export function readingExport(title:string,turns:Turn[],format:'md'|'txt'='md'){
  const heading=format==='md'?'# ':'';
  return heading+title+'\n\n'+turns.filter(t=>t.kind!=='configuration').map(t=>(format==='md'?'## ':'')+dateLabel(t.state.date)+' · '+t.state.location+'\n\n'+(t.playerText?(t.playerName||'玩家角色')+'（玩家原文）：\n'+t.playerText+'\n\n':'')+t.body).join('\n\n────────────────\n\n');
}
