'use client';
import { requestId } from '../client/storage';
import { useEffect, useId, useRef, useState } from 'react';
import type { Draft, Evidence, Extraction } from '../domain/types';
import type { DraftReview as Review, DraftReviewContext } from '../domain/draft-review';
import { Modal } from './Modal';
import { storyBodyIssues } from '../domain/story-body';
import { BodyIssues } from './BodyIssues';
type Api=<T>(path:string,data?:unknown)=>Promise<T>;
const kinds:Record<Extraction['facts'][number]['kind'],string>={confirmed_event:'已发生的事件',claim:'人物说法（未证实）',rumor:'传闻',belief:'个人相信',suspicion:'怀疑',promise:'承诺',order:'明确命令',intent:'意图或计划',unresolved:'待核实事项'};

export function DraftReview({id,api,close,saved}:{id:string;api:Api;close:()=>void;saved:(draft:Draft)=>void}){
  const [context,setContext]=useState<DraftReviewContext|null>(null),[error,setError]=useState('');
  useEffect(()=>{let live=true;api<DraftReviewContext>('drafts/'+id+'/review').then(c=>{if(live)setContext(c);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[id,api]);
  return <Modal title="本地审阅并保存" close={close}>{error?<p role="alert" className="error-text">{error}</p>:context?<ReviewForm context={context} submit={async review=>saved(await api<Draft>('drafts/'+id+'/review',review))}/>:<p>正在读取原节点…</p>}</Modal>;
}

function ReviewForm({context,submit}:{context:DraftReviewContext;submit:(review:Review)=>Promise<void>}){
  const [body,setBody]=useState(context.body),[present,setPresent]=useState(context.present),[characters,setCharacters]=useState<Review['characters']>([]);
  const [facts,setFacts]=useState<Review['facts']>([]),[pending,setPending]=useState(false),[error,setError]=useState('');
  const saveStatusId=useId(),memoryToFocus=useRef<number|null>(null),bodyEditor=useRef<HTMLTextAreaElement>(null);
  const issues=storyBodyIssues(context.playerText,body);
  const missingRequirements=[
    !body.trim()&&'请填写正文',
    !facts.length&&'请点击“添加记忆”，至少记录一项本节进展',
    facts.some(f=>!f.content.trim())&&'请填写每项记忆的内容',
  ].filter(Boolean);
  const canSubmit=!pending&&!missingRequirements.length;
  const sources:Record<string,string>={player:context.playerText,...Object.fromEntries(body.split(/\n\s*\n/).filter(Boolean).map((s,i)=>['b'+i,s]))};
  const firstSource=()=>{const blockId=Object.keys(sources).find(k=>k!=='player')||'player';return {blockId,quote:sources[blockId].slice(0,500)};};
  const [sceneEvidence,setSceneEvidence]=useState<Evidence>(()=>({blockId:'player',quote:context.playerText.slice(0,500)}));
  const people=[...context.characters,...characters.map(c=>({id:c.draftRef,name:c.name||'尚未填写姓名',identity:c.identity}))];
  const patchFact=(i:number,p:Partial<Review['facts'][number]>)=>setFacts(facts.map((f,index)=>index===i?{...f,...p}:f));
  const patchCharacter=(i:number,p:Partial<Review['characters'][number]>)=>setCharacters(characters.map((c,index)=>index===i?{...c,...p}:c));
  function evidencePicker(label:string,value:Evidence,change:(v:Evidence)=>void){return <div className="review-evidence"><label>{label}<select aria-label={label} value={value.blockId} onChange={e=>change({blockId:e.target.value,quote:sources[e.target.value].slice(0,500)})}>
    {Object.entries(sources).map(([id,text])=><option key={id} value={id}>{id==='player'?'玩家原文':'正文第'+(Number(id.slice(1))+1)+'段'} · {text.slice(0,35)}</option>)}
  </select></label><label>逐字引文<textarea aria-label={label+'逐字引文'} maxLength={500} rows={3} value={value.quote} onChange={e=>change({...value,quote:e.target.value})}/></label></div>;}
  return <form className="draft-review-form" onSubmit={async e=>{e.preventDefault();if(!canSubmit)return;setPending(true);setError('');try{await submit({revision:context.revision,body,present,sceneEvidence,facts,characters,confirmed:true});}catch(error){setError((error as Error).message);}finally{setPending(false);}}}>
    <p>此方式由你整理记忆，不调用 API。适用于当前场景的交流、明确行动和人物登场；时间、地点保持原样。任免、身份揭露、关系变化及远方人物获知消息，请使用模型整理。</p>
    <p className="muted">原输入：{context.playerText}</p>
    <BodyIssues issues={issues} locate={issue=>{bodyEditor.current?.focus();bodyEditor.current?.setSelectionRange(issue.start,issue.end);bodyEditor.current?.scrollIntoView({block:'center'});}}/>
    <label>核对正式正文<textarea ref={bodyEditor} className="draft-editor" aria-label="本地审阅正文" value={body} maxLength={100000} onChange={e=>setBody(e.target.value)}/></label>
    <p className="muted">是否保留正文措辞由你决定。记忆中的命令、任免和人物知情仍须有来源依据，不能用模型补写的对白作为玩家授权。</p>
    <h3>在场人物 · {context.location}</h3>
    <p className="muted">只勾选确实登场的人。被提及或仍在门外的人不算在场。</p>
    <div className="review-checks">{people.map(p=><label key={p.id}><input type="checkbox" aria-label={'在场：'+p.name} checked={present.includes(p.id)} onChange={e=>setPresent(e.target.checked?[...present,p.id]:present.filter(id=>id!==p.id))}/>{p.name}</label>)}</div>
    {evidencePicker('场景来源',sceneEvidence,setSceneEvidence)}
    <details className="review-new-people"><summary>正文中出现了尚未登记的新人物</summary><p className="muted">改名或换身份仍是原来的人，不在这里另建。无关群体不建档。</p>
      {characters.map((c,i)=><fieldset key={c.draftRef}><legend>新人物 {i+1}</legend><label>姓名或原文暂称<input required value={c.name} maxLength={80} onChange={e=>patchCharacter(i,{name:e.target.value})}/></label><label>已知身份<input required value={c.identity} maxLength={300} onChange={e=>patchCharacter(i,{identity:e.target.value})}/></label><label>身份依据<select value={c.identityStatus} onChange={e=>patchCharacter(i,{identityStatus:e.target.value as 'claim'|'confirmed'})}><option value="claim">自称／尚未确认</option><option value="confirmed">原文已确认</option></select></label><label>剧情作用<input required value={c.roleInStory} maxLength={300} onChange={e=>patchCharacter(i,{roleInStory:e.target.value})}/></label>{evidencePicker('人物来源',c.evidence,evidence=>patchCharacter(i,{evidence}))}<p className="muted">除玩家外，还有谁确实获知这项身份信息：</p><div className="review-checks">{context.characters.filter(p=>present.includes(p.id)).map(p=><label key={p.id}><input type="checkbox" checked={c.knownBy.includes(p.id)} onChange={e=>patchCharacter(i,{knownBy:e.target.checked?[...c.knownBy,p.id]:c.knownBy.filter(id=>id!==p.id)})}/>{p.name}</label>)}</div><button type="button" onClick={()=>{setCharacters(characters.filter((_,n)=>n!==i));setPresent(present.filter(id=>id!==c.draftRef));}}>移除此登记</button></fieldset>)}
      <button type="button" disabled={characters.length>=16} onClick={()=>setCharacters([...characters,{draftRef:'new:review_'+requestId().replaceAll('-',''),name:'',identity:'身份未明',identityStatus:'claim',roleInStory:'',evidence:firstSource(),knownBy:[]}])}>登记新人物</button>
    </details>
    <h3>本节记忆</h3><p className="muted">至少记录一项本节的新进展。人物说法不等于已证实的事实；只有确实听见或获知的人才勾选。</p>
    {facts.map((f,i)=><fieldset key={i}><legend>记忆 {i+1}</legend><label>记忆内容<textarea required aria-label={'记忆内容 '+(i+1)} ref={node=>{if(node&&memoryToFocus.current===i){node.focus();memoryToFocus.current=null;}}} rows={3} maxLength={600} value={f.content} onChange={e=>patchFact(i,{content:e.target.value})}/></label><div className="recovery-settings"><label>性质<select aria-label={'记忆性质 '+(i+1)} value={f.kind} onChange={e=>patchFact(i,{kind:e.target.value as typeof f.kind})}>{Object.entries(kinds).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>涉及对象<select aria-label={'记忆对象 '+(i+1)} value={f.subject} onChange={e=>patchFact(i,{subject:e.target.value})}><option value="当前场景">当前场景／事项</option><option value="player">{context.playerName||'玩家角色'}</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>{evidencePicker('记忆 '+(i+1)+' 来源',f.evidence,evidence=>patchFact(i,{evidence}))}<p className="muted">除玩家外，谁实际知道这件事：</p><div className="review-checks">{people.filter(p=>present.includes(p.id)).map(p=><label key={p.id}><input type="checkbox" aria-label={'记忆 '+(i+1)+' 知情：'+p.name} checked={f.knownBy.includes(p.id)} onChange={e=>patchFact(i,{knownBy:e.target.checked?[...f.knownBy,p.id]:f.knownBy.filter(id=>id!==p.id)})}/>{p.name}</label>)}</div><button type="button" onClick={()=>setFacts(facts.filter((_,n)=>n!==i))}>移除此记忆</button></fieldset>)}
    <button type="button" disabled={facts.length>=20} onClick={()=>{const evidence=firstSource();memoryToFocus.current=facts.length;setFacts([...facts,{kind:'claim',content:'',subject:'当前场景',evidence,knownBy:[],revealed:true,importance:3}]);}}>添加记忆</button>
    <p className="muted">填写后直接保存即可，无需另行勾选确认。系统会核对原文来源与玩家决定权；保存成功后仍可修改。</p>
    {error&&<p role="alert" className="error-text">{error}</p>}
    <div className="review-evidence" id={saveStatusId} role="status" aria-live="polite"><p>{pending?'正在校验正文、记忆与原文来源…':missingRequirements.length?'还不能保存：'+missingRequirements.join('；')+'。':'保存时会一起校验正文、记忆和原文来源。'}</p></div>
    <button className="primary" type="submit" aria-describedby={saveStatusId} disabled={!canSubmit}>{pending?'正在本地校验…':'校验并保存为正式剧情'}</button>
  </form>;
}
