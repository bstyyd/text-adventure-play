'use client';
import { requestId } from '../client/storage';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Search, Star } from 'lucide-react';
import type { CharacterBook as Book, CharacterEvent, CharacterView, CharacterCorrection } from '../characters/schema';
import type {PublicScenario} from '../scenario/schema';
import {calendarDate} from '../scenario/calendar';
import {dateLabel} from '../domain/calendar';
import type { Branch } from '../domain/types';
import { useAppDialog } from './useAppDialog';

const stages={proposed:'提议',ordered:'已下令',active:'已生效',arrived:'已到任',ended:'已离任'};
const kinds={substantive:'实授',acting:'代理',concurrent:'兼任',commission:'差遣',honorary:'荣誉称号'};
const fields:Record<string,string>={name:'确认姓名',alias:'称呼',identity:'身份',background:'背景',personality:'性格',motivation:'动机',faction:'阵营',location:'地点',condition:'处境',lifeStatus:'生存状态',availability:'去向',age:'年龄'};
const certainty={confirmed:'已确认',claim:'自称／说法',rumor:'传闻',suspicion:'怀疑'};
function eventLabel(e:CharacterEvent){
  if(e.kind==='created')return e.sourceKind==='legacy'?'旧档登记 · 早期履历细节未知':'登记人物 · '+e.data.referenceName;
  if(e.kind==='office')return stages[e.data.stage]+' · '+kinds[e.data.assignmentKind]+' '+e.data.title;
  if(e.kind==='profile')return (fields[e.data.field]||e.data.field)+' · '+e.data.value+'（'+certainty[e.data.certainty]+'）';
  if(e.kind==='relationship')return (e.data.category==='attitude'?'主观态度':'客观关系')+' · '+e.data.description+(e.data.endedByEventId?' · 已结束':'');
  if(e.kind==='knowledge')return ({known:'获知',believed:'相信',suspected:'怀疑'})[e.data.certainty]+'一条人物信息 · '+({witness:'在场见证',told:'实际转告',letter:'收到信件',investigation:'调查所得',self:'本人知悉'})[e.data.path];
  if(e.kind==='policy')return '人物配置 · '+(e.data.relevance==='recurring'?'提升为主要人物；':'')+(e.data.relationshipEnabled!==undefined?(e.data.relationshipEnabled?'开放人物数值；':'关闭人物数值；'):'')+(e.data.romancePolicy==='available'?'恋爱路线已开放':'恋爱路线关闭')+'（不属于剧情事件）';
  return '未解析称呼 · '+e.data.label;
}
function role(c:CharacterView){return c.offices.filter(o=>['active','arrived'].includes(o.stage)).map(o=>o.title).join('、')||(c.offices.length?'暂无生效职务':c.identity);}
type Api=<T>(path:string,data?:unknown)=>Promise<T>;
export function CharacterBook({saveId,branchId,atTurnId,atLabel,historical,scenario,api,onSource,onFork,onPolicy}:{
  saveId:string;branchId:string;atTurnId:string;atLabel:string;historical:boolean;scenario?:PublicScenario;api:Api;
  onSource:(id:string)=>void;onFork:(branch:Branch,input:string)=>Promise<void>;onPolicy:()=>Promise<void>;
}){
  const [book,setBook]=useState<Book|null>(null),[query,setQuery]=useState(''),[group,setGroup]=useState('all'),[selected,setSelected]=useState<string|null>(null),[groupName,setGroupName]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[budget,setBudget]=useState(12);
  const [category,setCategory]=useState<CharacterCorrection['category']>('identity'),[note,setNote]=useState(''),[source,setSource]=useState('');
  const {ask,dialog}=useAppDialog();
  const load=useCallback(async()=>{
    const next=await api<Book>('saves/'+saveId+'/characters?'+new URLSearchParams({branch:branchId,at:atTurnId}));setBook(next);setBudget(next.contextLimit);
  },[api,saveId,branchId,atTurnId]);
  useEffect(()=>{let live=true;void api<Book>('saves/'+saveId+'/characters?'+new URLSearchParams({branch:branchId,at:atTurnId})).then(b=>{if(live){setBook(b);setBudget(b.contextLimit);}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[api,saveId,branchId,atTurnId]);
  async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const person=book?.characters.find(c=>c.id===selected),displayName=(id:string)=>id==='player'?(scenario?.player.name||'玩家角色'):book?.characters.find(c=>c.id===id)?.name||'未公开人物';
  const items=book?.characters.filter(c=>{
    const matches=[c.name,...c.aliases,c.identity,...c.offices.map(o=>o.title),...c.factions].some(v=>v.includes(query.trim()));
    return matches&&(group==='all'||group==='main'&&c.relevance==='recurring'||group==='follow'&&((scenario?.ui.pinnedCharacters||[]).includes(c.id)||book.followed.includes(c.id))||group==='supporting'&&!c.seedKey||group==='mentioned'&&c.visibility==='mentioned'||group==='departed'&&['departed','unreachable'].includes(c.availability)||group==='recent'&&c.lastInteractionTurnId===atTurnId||group.startsWith('custom:')&&book.groups?.[c.id]===group.slice(7));
  })||[];
  function choose(c:CharacterView){setSelected(c.id);setGroupName(book?.groups?.[c.id]||'');setSource(c.timeline.at(-1)?.sourceTurnId||c.firstMentionTurnId);setNote('');setNotice('');}
  async function correct(fork:boolean){
    if(!person||!note.trim())return;
    const result=await api<{branch:Branch|null;playerText:string}>('characters/correct',{saveId,branchId,characterId:person.id,sourceTurnId:source,category,note,fork});
    if(result.branch)await onFork(result.branch,result.playerText);else{await load();setNotice('更正已留记录，旧原文与事实保持原样。');setNote('');}
  }
  return <main className={'page character-page '+(person?'person-selected':'')}>
    <div className="page-heading"><div><div className="eyebrow">人有来处，事有前因</div><h1>人物簿</h1><p>{historical?'当时人物档案':'当前人物档案'} · {atLabel}</p></div></div>
    {error&&<p role="alert" className="error-text">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!book&&<p>正在查阅人物记录…</p>}
    {book&&<div className="character-layout"><section className="character-index" aria-label="人物列表">
      <label className="search-input"><Search size={18}/><input aria-label="搜索人物" placeholder="姓名、旧称、职位或势力" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <label>人物分组<select aria-label="人物分组" value={group} onChange={e=>setGroup(e.target.value)}><option value="all">全部已知人物</option><option value="main">主要人物</option><option value="follow">常驻／关注</option><option value="recent">本段交集</option><option value="supporting">剧情人物</option><option value="mentioned">已提及</option><option value="departed">已离场／失联</option>{[...new Set(Object.values(book.groups||{}))].map(label=><option key={label} value={"custom:"+label}>{label}</option>)}</select></label>
      <p className="muted">关注只影响显示，不会召见人物或改变关系。</p>
      <div className="character-list">{items.map(c=><button key={c.id} className={selected===c.id?'selected':''} onClick={()=>choose(c)} aria-label={'查看人物 '+c.name+' '+c.id}>
        <span><strong>{c.name}</strong><small>{role(c)}</small><small>{c.visibility==='mentioned'?'仅被提及':c.availability==='present'?'当前在场':'未在当前场景'}{c.possibleDuplicates.length?' · 有同名记录':''}</small></span>
        {book.followed.includes(c.id)&&<Star size={16}/>}</button>)}</div>
      {!items.length&&<p>这个时点没有符合条件的已知人物。</p>}
      {!!book.unresolvedMentions.length&&<details><summary>尚待辨认的称呼</summary>{book.unresolvedMentions.map((m,i)=><p key={i}>{m.label} · {m.candidates.length?'候选：'+m.candidates.map(displayName).join('、'):'身份尚不明确'} <button onClick={()=>onSource(m.sourceTurnId)}>查看原文</button></p>)}</details>}
      <details className="character-budget"><summary>人物参考范围</summary><p className="muted">每轮优先提供在场、点名和任务相关人物的详细资料。软性预算不限制人物总数，也不把关注当成剧情亲近。</p><label>详细人物参考数<input aria-label="详细人物参考数" type="number" min={6} max={40} value={budget} onChange={e=>setBudget(+e.target.value)}/></label><button className="outline" disabled={busy} onClick={()=>void run(async()=>{await api('characters/budget',{contextLimit:budget});setNotice('人物参考范围已保存。');})}>保存参考范围</button></details>
    </section>
    <section className="character-detail" aria-label="人物详情">
      {!person?<p className="muted">选择一位人物，查看身份、任职经历与相关原文。</p>:<>
        <button className="person-back" onClick={()=>setSelected(null)}><ArrowLeft size={16}/>返回人物簿</button>
        <div className="person-heading"><div><h2>{person.name}</h2><p>{role(person)}</p></div><button className="outline" disabled={busy||historical} onClick={()=>void run(async()=>{await api('characters/follow',{saveId,branchId,characterId:person.id,followed:!book.followed.includes(person.id)});await load();})}><Star size={15}/>{book.followed.includes(person.id)?'取消关注':'关注人物'}</button></div>
        {!historical&&<details><summary>自定义人物分组</summary><label>分类名称<input aria-label="人物分类名称" maxLength={40} value={groupName} onChange={e=>setGroupName(e.target.value)}/></label><button disabled={busy} onClick={()=>void run(async()=>{await api("characters/group",{saveId,branchId,characterId:person.id,label:groupName});await load();setNotice("分组已保存，只影响人物簿显示。");})}>保存分类</button></details>}<p>已知称呼：{person.aliases.join('、')||'尚无'} · 年龄：{person.age===null?'未知':person.age+'岁'}</p>
        <p>{person.roleInStory}</p><p>所在地：{person.location||'尚未确认'} · {({present:'在场',elsewhere:'别处',unreachable:'暂无法联络',departed:'已离场'})[person.availability]} · {({alive:'在世',deceased:'已故',unknown:'生存状态未确认'})[person.lifeStatus]}</p>
        {scenario?.manifest.relationshipSystem.enabled&&scenario.rules.relationshipStats.some(s=>person.stats?.[s.key]!==undefined)&&<section aria-label="人物数值"><h3>人物数值</h3>{scenario.rules.relationshipStats.filter(s=>person.stats?.[s.key]!==undefined).map(s=><p key={s.key}>{s.displayName}：{person.stats![s.key]}</p>)}</section>}
        {!!person.factions.length&&<p>所属势力：{person.factions.join('、')}</p>}{!!person.conditions.length&&<p>当前处境：{person.conditions.join('、')}</p>}
        {person.legacy&&<p className="muted">旧存档登记：初始身份沿用原设定，早期任职与首次见面的细节未知。</p>}
        {!!person.possibleDuplicates.length&&<p className="character-callout">存在同名档案，尚未合并。请结合来源辨认；下方可登记“认错人／重复人物”更正。</p>}
        <div className="button-row"><button onClick={()=>onSource(person.firstMentionTurnId)}>首次提及原文</button>{person.firstAppearanceTurnId&&<button onClick={()=>onSource(person.firstAppearanceTurnId!)}>首次登场原文</button>}<button onClick={()=>onSource(person.lastInteractionTurnId)}>最近相关原文</button></div>
        <h3>职务与任职进度</h3>{person.offices.length?person.offices.map(o=><article className="office-entry" key={o.id}><strong>{o.title}</strong><span className="tag">{kinds[o.assignmentKind]} · {stages[o.stage]}</span><p>{o.organization}{o.authorityScope.length?' · 职责：'+o.authorityScope.join('、'):''}</p></article>):<p className="muted">暂无已登记职务；身份称呼本身不授予权限。</p>}
        <h3>人物关系</h3>{person.relations.filter(r=>!r.endedByEventId).map(r=><p key={r.id}><span className="tag">{r.category==='objective'?'客观关系':'单向态度'}</span> {displayName(r.fromCharacterId)} → {displayName(r.toCharacterId)}：{r.description}</p>)}{!person.relations.some(r=>!r.endedByEventId)&&<p className="muted">尚无有来源的人际关系记录。</p>}
        <h3>身份与已知线索</h3>{person.notes.map((n,i)=><p key={i}><span className="tag">{certainty[n.certainty]}</span> {fields[n.field]||n.field}：{n.value} <button onClick={()=>onSource(n.sourceTurnId)}>原文</button></p>)}
        {!!person.pendingThreads.length&&<><h3>未完事项与承诺</h3>{person.pendingThreads.map((t,i)=><p key={i}>{t}</p>)}</>}
        <h3>履历</h3><ol className="character-timeline">{[...person.timeline].reverse().map(e=><li key={e.id}><time>{scenario?dateLabel(calendarDate(scenario.calendar,e.gameTime.year,e.gameTime.month,e.gameTime.day,e.gameTime.minuteOfDay)):e.gameTime.year+'年 '+e.gameTime.month+'月'+e.gameTime.day+'日'}</time><strong>{eventLabel(e)}</strong><p>{e.evidence.quote}</p><button onClick={()=>onSource(e.sourceTurnId)}>相关剧情原文</button></li>)}</ol>
        {!person.seedKey&&!historical&&<details><summary>提升人物重要性／开放人物数值</summary><p>明确配置会留下来源记录，保留人物 ID、记忆与承诺。不会改变已发生的剧情或开启恋爱路线。</p><button disabled={busy} onClick={()=>void run(async()=>{const answer=await ask({title:'提升为主要人物',description:'保留原有档案，并将叙事重要性设为主要人物。',confirmLabel:'确认配置'});if(answer===null)return;await api('characters/policy',{saveId,branchId,characterId:person.id,expectedHeadTurnId:atTurnId,clientRequestId:requestId(),romancePolicy:person.romancePolicy,relevance:'recurring',confirmed:true});await onPolicy();})}>提升为主要人物</button>{scenario?.manifest.relationshipSystem.enabled&&<button disabled={busy} onClick={()=>void run(async()=>{const answer=await ask({title:'开放人物数值',description:'采用当前剧本声明的初值：'+scenario.rules.relationshipStats.map(s=>s.displayName+' '+(s.dynamicDefault??s.initial)).join('、')+'。不会重置已有数值。',confirmLabel:'确认开放'});if(answer===null)return;await api('characters/policy',{saveId,branchId,characterId:person.id,expectedHeadTurnId:atTurnId,clientRequestId:requestId(),romancePolicy:person.romancePolicy,relationshipEnabled:true,confirmed:true});await onPolicy();})}>开放人物数值</button>}</details>}
        {scenario?.manifest.romanceSystem&&<details><summary>人物路线设置</summary><p>{person.seedKey?'沿用原有种子人物路线。':person.romancePolicy==='disabled'?'未开放恋爱线；利益与态度仍可随剧情发展。':'已明确开放恋爱线；原有身份、记忆与关系继续保留。'}</p>
          {!person.seedKey&&!historical&&<button className="outline" disabled={busy} onClick={()=>void run(async()=>{
            if(person.romancePolicy==='disabled'&&(person.age===null||person.age<18))throw new Error('年龄未知或未成年的人物不能开放恋爱路线。');
            const next=person.romancePolicy==='disabled'?'available':'disabled';
            const answer=await ask({title:next==='available'?'开放人物恋爱线':'关闭人物恋爱线',description:'这是明确的路线配置，会留下记录，不等于剧情中已接受亲近或改变任何关系数值。人物ID与原有记忆保留。',confirmLabel:'确认配置'});
            if(answer===null)return;
            await api('characters/policy',{saveId,branchId,characterId:person.id,expectedHeadTurnId:atTurnId,clientRequestId:requestId(),romancePolicy:next,confirmed:true});await onPolicy();
          })}>{person.romancePolicy==='disabled'?'明确开放恋爱线':'关闭恋爱线'}</button>}
        </details>}
        <details className="character-correction"><summary>人物资料纠错</summary><p className="muted">留下更正记录，或从来源前另开分支修订。旧原文保留，身份相似不会自动合并。</p>
          <label>纠错类别<select aria-label="人物纠错类别" value={category} onChange={e=>setCategory(e.target.value as CharacterCorrection['category'])}><option value="identity">认错人／重复人物</option><option value="office">职位错误</option><option value="knowledge">不该知道这件事</option><option value="history">遗漏履历</option></select></label>
          <label>来源节点<select aria-label="人物纠错来源" value={source} onChange={e=>setSource(e.target.value)}>{[...new Map(person.timeline.map(e=>[e.sourceTurnId,e])).values()].map(e=><option key={e.sourceTurnId} value={e.sourceTurnId}>{e.gameTime.month}月{e.gameTime.day}日 · {eventLabel(e)}</option>)}</select></label>
          <label>更正说明<textarea aria-label="人物更正说明" value={note} maxLength={600} onChange={e=>setNote(e.target.value)}/></label>
          <div className="button-row"><button className="outline" disabled={busy||!note.trim()} onClick={()=>void run(()=>correct(false))}>记下更正</button><button className="outline" disabled={busy||!note.trim()} onClick={()=>void run(()=>correct(true))}>从来源前分支修订</button></div>
          {book.corrections.filter(c=>c.characterId===person.id).map(c=><p className="annotation" key={c.id}>{c.note}{c.resultBranchId?' · 已建立修订分支':''}</p>)}
        </details>
      </>}
    </section></div>}{dialog}
  </main>;
}
