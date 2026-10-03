'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { BookOpen, BookMarked, Feather, History, Users, Settings, ChevronRight, ChevronDown, ArrowUp, Square, Plus, X, Search, Bookmark as BookmarkIcon, GitBranch, Download, Upload, Menu, Moon, Sun, Check, AlertCircle, PanelLeftClose, PanelRightClose, Eye, Database, Pin } from 'lucide-react';
import type { Draft, Fact, NpcId, Profile, Save, SuggestedActions, Turn, View } from '../domain/types';
import {ScenarioLibrary} from './ScenarioLibrary';
import {ScenarioUpgrade} from './ScenarioUpgrade';
import {NewScenarioGame} from './NewScenarioGame';
import {dayKey} from '../domain/calendar';
import { dateLabel } from '../domain/calendar';
import { readingExport } from '../domain/reading-export';
import { DEFAULT_PROFILES } from '../llm/config';
import { Modal } from './Modal';
import { useAppDialog } from './useAppDialog';
import { DraftProgress } from './DraftProgress';
import { ActionSuggestions } from './ActionSuggestions';
import { CharacterBook } from './CharacterBook';
import { DraftRecovery } from './DraftRecovery';
import { DraftReview } from './DraftReview';
import { DraftEditor } from './DraftEditor';
import { StoryNotes } from './StoryNotes';
import { PwaTools } from './PwaTools';
import { api, apiResponse, ApiError, isOffline, reconnect, setOffline } from '../client/api';
import {browserEdition} from '../client/site-path';
import { readLocal, writeLocal, requestId, storageError } from '../client/storage';
import { useVisualViewport } from '../client/viewport';
import { usePwa } from '../client/pwa';
import { localDateKey } from '../client/history';
import type { Bootstrap as Boot, LocalDraft, ReadingPlace, OfflineCopy, PendingRequest } from '../domain/offline';
type Npc={id:NpcId;name:string;role:string;age:number|null;description:string};
const statusText={generating:'正在生成正文',extracting:'正在整理记忆 · 随后自动保存',validating:'正在校验并自动保存',failed:'自动保存未完成 · 草稿保留',cancelled:'已停止 · 草稿保留',committed:'已保存到主存档'};
export default function NovelApp(){
  const {ask,dialog}=useAppDialog();
  useVisualViewport();
  const pwa=usePwa();
  const [offline,setOfflineState]=useState(false),[loginRequired,setLoginRequired]=useState(false),[password,setPassword]=useState('');
  const [pending,setPending]=useState<PendingRequest|null>(null),[sending,setSending]=useState(false),[unreceived,setUnreceived]=useState(false),[conflict,setConflict]=useState(false);
  const [readPage,setReadPage]=useState(0),[historyPage,setHistoryPage]=useState(0),[newContent,setNewContent]=useState(false),[eyeCare,setEyeCare]=useState(false);
  const sendingRef=useRef(false),positions=useRef<Record<string,ReadingPlace>>({}),pageRef=useRef(0);
  const pageSize=20;
  const [boot,setBoot]=useState<Boot|null>(null),[view,setView]=useState<View|null>(null),[historicalView,setHistoricalView]=useState<View|null>(null);
  const [tab,setTab]=useState<'read'|'history'|'memory'|'characters'|'settings'|'library'>('read');
  const [input,setInput]=useState(''),[target,setTarget]=useState<NpcId|null>(null),[ooc,setOoc]=useState(false),[draft,setDraft]=useState<Draft|null>(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[left,setLeft]=useState(false),[right,setRight]=useState(false);
  const [saveModal,setSaveModal]=useState(false),[newPackageId,setNewPackageId]=useState<string|undefined>(),[newPackageVersion,setNewPackageVersion]=useState<string|undefined>();
  const [deletingSave,setDeletingSave]=useState<string|null>(null);
  const [contact,setContact]=useState<Npc|null>(null);
  const [bookScope,setBookScope]=useState<{branchId:string;turn:Turn}|null>(null);
  const [snapshot,setSnapshot]=useState<Turn|null>(null),[preview,setPreview]=useState<unknown|null>(null),[editor,setEditor]=useState<Draft|null>(null);
  const [revision,setRevision]=useState<{turn:Turn;text:string;player:string;mode:'prose'|'input'}|null>(null);
  const [localReview,setLocalReview]=useState<string|null>(null);
  const [size,setSize]=useState(18),[line,setLine]=useState(2),[width,setWidth]=useState(720),[dark,setDark]=useState(false),[themeChosen,setThemeChosen]=useState(false);
  const [history,setHistory]=useState({from:'',to:'',inclusive:true,realFrom:'',realTo:'',npc:'',location:'',keyword:'',bookmarked:false});
  const [settings,setSettings]=useState<Profile|null>(null),[key,setKey]=useState(''),[rememberKey,setRememberKey]=useState(true),[modelList,setModelList]=useState<string[]>([]),[testing,setTesting]=useState(false);
  const [narrator,setNarrator]=useState('mock'),[extractor,setExtractor]=useState('same'),[style,setStyle]=useState('克制，留白，以对白与动作推进。');
  const reader=useRef<HTMLDivElement>(null),composer=useRef<HTMLTextAreaElement>(null),nearBottom=useRef(false),loadedRoute=useRef('');
  const busy=!!draft&&['generating','extracting','validating'].includes(draft.status);
  const routeId=view?view.save.id+':'+view.branch.id:'';
  const composerSnapshot=useRef<{route:string;value:LocalDraft}|null>(null),loadSequence=useRef(0),navigationSequence=useRef<number|null>(null);
  useLayoutEffect(()=>{composerSnapshot.current=routeId?{route:routeId,value:{text:input,target,ooc}}:null;},[routeId,input,target,ooc]);
  const flushInput=useCallback(async()=>{const snapshot=composerSnapshot.current;if(snapshot)await writeLocal('input:'+snapshot.route,snapshot.value);},[]);
  const head=view?.turns.at(-1),state=head?.state,selected=boot?.profiles.find(p=>p.id===boot.selected.narrator);
  const settingsKeyProfile=boot?.profiles.find(p=>p.id===settings?.id&&p.provider===settings.provider);
  const suggestionDraft=draft&&draft.mode==='story'&&draft.status!=='committed'&&draft.body?draft:null;
  const suggestionKey=[view?.save.id,view?.branch.id,head?.id,selected?.id,selected?.provider,selected?.model,suggestionDraft?.id,suggestionDraft?.updatedAt||suggestionDraft?.body,suggestionDraft?.status].join('|');
  const npcName=(id:string)=>view?.characters?.find(n=>n.id===id)?.name||boot?.npcs.find(n=>n.id===id)?.name||'身份未明';
  const residents=view?.scenario.characters.filter(n=>view.scenario.ui.pinnedCharacters.includes(n.stableId)).map(n=>({id:n.stableId,name:n.displayName,role:n.roles.map(r=>r.title).join('、'),age:n.age,description:n.description})).map(n=>{const c=view?.characters?.find(c=>c.id===n.id);return c?{...n,name:c.name,role:c.offices.filter(o=>['active','arrived'].includes(o.stage)).map(o=>o.title).join('、')||(c.offices.length?'暂无生效职务':c.identity)}:n;})||[];
  const playerName=view?.scenario.player.name||'玩家角色';
  const worldDefinitions=view?.scenario.rules.worldStats||[],relationshipDefinitions=view?.scenario.rules.relationshipStats||[];
  const run=async(fn:()=>Promise<unknown>)=>{setError('');try{await fn();}catch(e){setError((e as Error).message);}};
  const loadBoot=useCallback(async()=>{const b=await api<Boot>('bootstrap');setBoot(b);setNarrator(b.selected.narrator);setExtractor(b.selected.extractor);setStyle(b.style);return b;},[]);
  const load=useCallback(async(id:string,branch?:string,background=false)=>{
    // A completion poll cannot supersede a volume the player is opening.
    if(background&&(navigationSequence.current!==null||loadedRoute.current!==id+':'+branch))return;
    const sequence=++loadSequence.current;
    if(!background)navigationSequence.current=sequence;
    try{
    const v=await api<View>('saves/'+id+(branch?'?branch='+branch:''));
    const route=id+':'+v.branch.id;
    let latest=v.drafts.filter(d=>d.status!=='cancelled').at(-1)||null;
    if(isOffline())latest=await readLocal<Draft>('branch-draft:'+route)||latest;
    if(sequence!==loadSequence.current)return v;
    if(loadedRoute.current!==route){
      // Switching routes must not cancel the debounce and lose the last keystrokes.
      await flushInput();
      const [stored,place,request]=await Promise.all([readLocal<LocalDraft>('input:'+route),readLocal<ReadingPlace>('place:'+route),readLocal<PendingRequest>('pending:'+route)]).catch(e=>{setError(storageError(e));return [undefined,undefined,undefined] as const;});
      if(sequence!==loadSequence.current)return v;
      loadedRoute.current=route;setHistoricalView(null);setBookScope(null);nearBottom.current=false;setConflict(false);setUnreceived(false);
      setInput(stored?.text||'');setOoc(stored?.ooc||false);setTarget(stored?.target||null);setPending(request||null);
      if(place)positions.current[route]=place;
      setReadPage(Math.min(place?.page??Math.floor((v.turns.length-1)/pageSize),Math.floor((v.turns.length-1)/pageSize)));
      void writeLocal('last-route',{saveId:id,branchId:v.branch.id}).catch(e=>setError(storageError(e)));
    }
    setView(v);setDraft(latest);return v;
    }finally{if(navigationSequence.current===sequence)navigationSequence.current=null;}
  },[flushInput]);
  const initialize=useCallback(async()=>{
    const session=await reconnect();setOfflineState(isOffline());setLoginRequired(session.loginRequired&&!session.authenticated);
    if(session.loginRequired&&!session.authenticated)return;
    const b=await loadBoot();const last=await readLocal<{saveId:string;branchId:string}>('last-route').catch(()=>undefined);
    const save=b.saves.find(s=>s.id===last?.saveId)||b.saves[0];if(save)await load(save.id,save.id===last?.saveId?last.branchId:undefined);
  },[load,loadBoot]);
  useEffect(()=>{
    setLeft(window.innerWidth>1023);void initialize().catch(e=>setError(e.message));
    void readLocal<{size:number;line:number;width:number;dark:boolean;eyeCare:boolean}>('reading').then(p=>{if(!p)try{p=JSON.parse(localStorage.getItem('dayao-reading')||'null')||undefined;}catch{}if(p){setThemeChosen(true);setSize(p.size||18);setLine(p.line||2);setWidth(p.width||720);setDark(!!p.dark);setEyeCare(!!p.eyeCare);}}).catch(e=>setError(storageError(e)));
    const connectivity=()=>setOfflineState(isOffline()),lost=()=>setOffline(true),login=()=>setLoginRequired(true);
    window.addEventListener('dayao-connectivity',connectivity);window.addEventListener('offline',lost);window.addEventListener('dayao-login',login);
    return()=>{window.removeEventListener('dayao-connectivity',connectivity);window.removeEventListener('offline',lost);window.removeEventListener('dayao-login',login);};
  },[initialize]);
  useEffect(()=>{
    if(!routeId)return;const route=routeId;
    const save=()=>void writeLocal('input:'+route,{text:input,target,ooc}).catch(e=>setError(storageError(e)));
    const timer=setTimeout(save,120);const hidden=()=>{if(document.visibilityState==='hidden')save();};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',save);
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',save);};
  },[input,target,ooc,routeId]);
  useEffect(()=>{if(!draft)return;void Promise.all([writeLocal('received:'+draft.id,draft),writeLocal('branch-draft:'+draft.saveId+':'+draft.branchId,draft)]).catch(e=>setError(storageError(e)));},[draft]);
  const checkOriginal=useCallback(async()=>{
    if(!pending)return;
    const result=await api<{draft:Draft|null}>('requests/'+pending.clientRequestId);
    if(loadedRoute.current!==pending.saveId+':'+pending.branchId)return;
    if(result.draft){setDraft(result.draft);setPending(null);setUnreceived(false);setInput(current=>current===pending.playerText?'':current);await writeLocal('pending:'+pending.saveId+':'+pending.branchId,undefined);}
    else{setUnreceived(true);setNotice('服务端尚未收到原请求。可手动重发同一个请求 ID；不会自动续写。');}
  },[pending]);
  useEffect(()=>{if(pending&&!offline&&!sending)void checkOriginal().catch(e=>setError(e.message));},[pending,offline,sending,checkOriginal]);
  useEffect(()=>{
    const resume=()=>{if(document.visibilityState==='hidden'||!navigator.onLine)return;void reconnect().then(session=>{
      if(session.loginRequired&&!session.authenticated){setLoginRequired(true);return;}
      // Recovery only performs GETs. The generation POST is never replayed here.
      if(pending)return checkOriginal();
      if(view&&draft)return api<Draft|null>('drafts/'+draft.id).then(d=>{if(d&&loadedRoute.current===d.saveId+':'+d.branchId)setDraft(d);}).catch(()=>undefined);
    }).catch(e=>setError(e.message));};
    window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
    return()=>{window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);};
  },[pending,checkOriginal,view,draft]);
  useEffect(()=>{if(!busy||!draft||offline)return;let stopped=false;const poll=async()=>{try{const d=await api<Draft>('drafts/'+draft.id);if(stopped)return;setDraft(d);if(d.status==='committed'){await load(d.saveId,d.branchId,true);setNotice(d.mode==='ooc'?'OOC 已单独保存，剧情状态未改变。':'正文与记忆已一起保存。');return;}if(['failed','cancelled'].includes(d.status))return;timer=setTimeout(poll,450);}catch(e){setError((e as Error).message);timer=setTimeout(poll,1800);}};let timer=setTimeout(poll,250);return()=>{stopped=true;clearTimeout(timer);};},[busy,draft?.id,load,offline]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    if(!reader.current||tab!=='read')return;
    if(nearBottom.current){setReadPage(Math.floor(((view?.turns.length||1)-1)/pageSize));requestAnimationFrame(()=>{if(reader.current)reader.current.scrollTop=reader.current.scrollHeight;});}
    else if(draft?.body)setNewContent(true);
  },[head?.id,draft?.body]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{pageRef.current=readPage;if(tab!=='read'||!routeId)return;const place=positions.current[routeId];requestAnimationFrame(()=>{
    const el=reader.current;if(!el)return;const anchor=place?.page===readPage&&place.turnId?document.getElementById('turn-'+place.turnId):null;
    el.scrollTop=anchor?anchor.offsetTop-el.offsetTop+(place?.offset||0):place?.page===readPage?place.scrollTop:0;
  });},[tab,readPage,routeId]);
  useEffect(()=>{setHistoryPage(0);},[history,historicalView?.branch.id]);
  function recordPlace(){
    const el=reader.current;if(!el||!view)return;
    nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;
    if(nearBottom.current)setNewContent(false);
    const article=[...el.querySelectorAll<HTMLElement>('.story-turn')].find(a=>a.getBoundingClientRect().bottom>el.getBoundingClientRect().top);
    const place:ReadingPlace={turnId:article?.id.slice(5),offset:article?el.scrollTop-(article.offsetTop-el.offsetTop):0,scrollTop:el.scrollTop,page:pageRef.current};
    positions.current[view.save.id+':'+view.branch.id]=place;
    void writeLocal('place:'+view.save.id+':'+view.branch.id,place).catch(e=>setError(storageError(e)));
  }
  function latest(){setReadPage(Math.floor(((view?.turns.length||1)-1)/pageSize));nearBottom.current=true;setNewContent(false);requestAnimationFrame(()=>requestAnimationFrame(()=>{if(reader.current)reader.current.scrollTop=reader.current.scrollHeight;}));}

  useEffect(()=>{
    if(draft?.status!=='committed'||loadedRoute.current!==draft.saveId+':'+draft.branchId)return;
    void load(draft.saveId,draft.branchId,true).then(()=>setNotice(draft.mode==='ooc'?'OOC 已单独保存，剧情状态未改变。':'正文与记忆已一起保存。')).catch(e=>setError(e.message));
  },[draft,load]);
  function prefs(next:{size?:number;line?:number;width?:number;dark?:boolean;eyeCare?:boolean}){
    if(next.dark!==undefined||next.eyeCare!==undefined)setThemeChosen(true);const p={size,line,width,dark,eyeCare,...next};setSize(p.size);setLine(p.line);setWidth(p.width);setDark(p.dark);setEyeCare(p.eyeCare);void writeLocal('reading',p).catch(e=>setError(storageError(e)));
  }
  async function send(text=input,retry?:PendingRequest){
    if(!view||!head||busy||!text.trim()||sendingRef.current||offline||pending&&!retry)return;
    sendingRef.current=true;setSending(true);
    const request:PendingRequest=retry||{clientRequestId:requestId(),saveId:view.save.id,branchId:view.branch.id,expectedHeadTurnId:head.id,playerText:text,target,mode:ooc?'ooc' as const:'story' as const};
    const pendingKey='pending:'+request.saveId+':'+request.branchId;
    try{
      await writeLocal(pendingKey,request);
      setPending(request);setUnreceived(false);
      const {revisionBody,...inputRequest}=request;
      const d=await api<Draft>(revisionBody===undefined?'turns':'turns/revise',revisionBody===undefined?inputRequest:{input:inputRequest,body:revisionBody});
      // A mobile user may change volumes before the response arrives. Leave that
      // route's request ID on disk for recovery rather than replacing the new view.
      if(loadedRoute.current!==request.saveId+':'+request.branchId)return;
      setDraft(d);setInput(current=>current===request.playerText?'':current);setNotice('');setPending(null);setConflict(false);
      await writeLocal(pendingKey,undefined);
      if(nearBottom.current)latest();
    }catch(e){
      if(e instanceof ApiError&&[400,403,409,429].includes(e.status)){if(loadedRoute.current===request.saveId+':'+request.branchId){setPending(null);if(e.status===409)setConflict(true);}await writeLocal(pendingKey,undefined);}
      throw e;
    }finally{sendingRef.current=false;setSending(false);}
  }
  async function submitRevision(){
    if(!revision||!view||sendingRef.current||busy||offline||!revision.player.trim()||(revision.mode==='prose'&&!revision.text.trim()))return;
    const saved=revision;
    sendingRef.current=true;setSending(true);
    try{
      const b=await api<{id:string}>('saves/'+view.save.id+'/fork',{branchId:view.branch.id,turnId:saved.turn.parentTurnId,name:((saved.mode==='input'?'重写':'修订')+' · '+view.branch.name).slice(0,80)});
      await load(view.save.id,b.id);setRevision(null);setTab('read');setInput(saved.player);sendingRef.current=false;
      await send(saved.player,{clientRequestId:requestId(),saveId:view.save.id,branchId:b.id,expectedHeadTurnId:saved.turn.parentTurnId!,playerText:saved.player,target:null,mode:'story',...(saved.mode==='prose'?{revisionBody:saved.text}:{})});
    }finally{sendingRef.current=false;setSending(false);}
  }
  function editTurn(turn:Turn,mode:'prose'|'input'='prose'){setRevision({turn,text:turn.body,player:turn.playerText,mode});}
  async function fork(turn:Turn){
    if(!view)return;
    const point=turn.id;
    const name=await ask({
      title:'另开分支',label:'新分支名称',
      description:'从选定位置开始另一条故事线，原分支完整保留。',
      defaultValue:'另一种可能',required:true,maxLength:80,confirmLabel:'创建分支',
    });
    if(!name?.trim())return;
    const b=await api<{id:string}>('saves/'+view.save.id+'/fork',{branchId:tab==='history'&&historicalView?historicalView.branch.id:view.branch.id,turnId:point,name});
    await load(view.save.id,b.id);setTab('read');setSaveModal(false);setInput('');setTarget(null);setOoc(false);
    setNotice('已另开分支，旧分支完整保留。');
    requestAnimationFrame(()=>composer.current?.focus());
  }
  async function renameSave(save:Save){
    const title=await ask({title:'重命名卷册',label:'卷册名称',defaultValue:save.title,required:true,maxLength:80,confirmLabel:'保存名称'});
    if(!title?.trim())return;
    await api('saves/'+save.id+'/rename',{title});await loadBoot();if(view?.save.id===save.id)await load(save.id);
  }
  async function deleteSave(save:Save){
    const confirmation=await ask({
      title:'删除卷册',description:'删除前会为'+(browserEdition()?'此浏览器':'本机')+'书库创建完整备份。请输入「'+save.title+'」确认删除此卷册及其分支。',
      label:'完整卷册名',expectedValue:save.title,required:true,maxLength:80,confirmLabel:'备份并删除',
    });
    if(confirmation===null)return;
    setDeletingSave(save.id);
    try{
      await api('saves/'+save.id+'/delete',{confirmation});await loadBoot();
      if(view?.save.id===save.id){setView(null);setHistoricalView(null);setDraft(null);setInput('');setTarget(null);}
      setNotice('卷册已删除，删除前的完整备份已保存在'+(browserEdition()?'此浏览器':'本机')+'。');
    }finally{setDeletingSave(null);}
  }
  async function download(format:'json'|'md'|'txt'){
    if(!view)return;
    const params=new URLSearchParams({branch:tab==='history'&&historicalView?historicalView.branch.id:view.branch.id,format,from:history.from,to:history.to,inclusive:String(history.inclusive)});
    let blob:Blob;
    if(offline&&!browserEdition()){
      const copy=await readLocal<OfflineCopy>('copy:'+view.save.id);if(!copy)throw new Error('此存档尚未完整下载，无法离线导出。');
      const source=copy.views[params.get('branch')!];
      const content=format==='json'?JSON.stringify(copy.archive,null,2):readingExport(copy.title,source.turns.filter(t=>{const from=parseDay(history.from),to=parseDay(history.to);return (from===undefined||t.state.date.absoluteDay>=from)&&(to===undefined||(history.inclusive?t.state.date.absoluteDay<=to:t.state.date.absoluteDay<to));}),format);
      blob=new Blob([content],{type:format==='json'?'application/json':'text/plain;charset=utf-8'});
    }else{const res=await apiResponse('saves/'+view.save.id+'/export?'+params);if(!res.ok)throw new Error((await res.json()).error);blob=await res.blob();}
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=view.save.title+'.'+format;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function jump(turnId:string){const index=view?.turns.findIndex(t=>t.id===turnId)??-1;const inCurrent=index>=0;if(inCurrent)setReadPage(Math.floor(index/pageSize));else setHistoryPage(Math.floor(Math.max(0,(historicalView?.turns||[]).findIndex(t=>t.id===turnId))/pageSize));if(!inCurrent)setHistory({from:'',to:'',inclusive:true,realFrom:'',realTo:'',npc:'',location:'',keyword:'',bookmarked:false});setTab(inCurrent?'read':'history');setSnapshot(null);setTimeout(()=>document.getElementById((inCurrent?'turn-':'history-')+turnId)?.scrollIntoView({behavior:'smooth',block:'start'}),60);}
  function selectNpc(n:Npc){if(state?.present.includes(n.id)){setTarget(n.id);composer.current?.focus();}else setContact(n);}
  const parseDay=(value:string)=>{try{return dayKey(value,(historicalView||view)?.scenario.calendar);}catch{return undefined;}};
  const historySource=historicalView||view;
  const historyPeople=[...new Map((historySource?.turns||[]).filter(t=>{const to=parseDay(history.to);return to===undefined||(history.inclusive?t.state.date.absoluteDay<=to:t.state.date.absoluteDay<to);}).flatMap(t=>Object.entries(t.characterNames||{}))).entries()].map(([id,name])=>({id,name}));
  const filtered=historySource?.turns.filter(t=>{
    const f=parseDay(history.from),to=parseDay(history.to),d=t.state.date.absoluteDay,npc=historyPeople.find(n=>n.id===history.npc),text=t.playerText+'\n'+t.body,realDate=localDateKey(t.createdAt);
    return !(f!==undefined&&d<f)&&!(to!==undefined&&(history.inclusive?d>to:d>=to))&&(!history.realFrom||realDate>=history.realFrom)&&(!history.realTo||realDate<=history.realTo)&&(!npc||t.state.present.includes(npc.id)||text.includes(npc.name))&&(!history.location||t.state.location.includes(history.location))&&(!history.keyword||text.includes(history.keyword))&&(!history.bookmarked||historySource.bookmarks.some(b=>b.turnId===t.id));
  })||[];
  async function annotate(f:Fact,kind:AnnotationKind){
    if(!view)return;
    const text=kind==='pin'?'重要记忆':await ask({title:kind==='error'?'纠错标注':'记忆笔记',description:'标注独立保存，不改变正史；修订事实请另开分支。',label:kind==='error'?'错误说明':'笔记内容',multiline:true,required:true,maxLength:600,confirmLabel:'保存标注'});
    if(text===null)return;
    await api('saves/'+view.save.id+'/annotate',{branchId:view.branch.id,sourceTurnId:f.sourceTurnId,factId:f.id,kind,text});await load(view.save.id);
  }
  const readingDark=dark||(!themeChosen&&view?.scenario.ui.theme.backgroundPreset==='night');
  const styles={ '--scenario-accent':view?.scenario.ui.theme.accent||'#9b493b','--reading-size':size+'px','--reading-line':line,'--reading-width':width+'px'} as CSSProperties;
  if(loginRequired)return <main className="loading login"><div className="seal">书</div><h1>个人书库</h1><p>请输入部署时设置的登录口令。</p><form onSubmit={e=>{e.preventDefault();const secret=password;setPassword('');void run(async()=>{await api('login',{password:secret});setLoginRequired(false);await initialize();});}}><label>登录口令<input aria-label="登录口令" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary" type="submit" disabled={!password}>登录</button></form>{error&&<p role="alert">{error}</p>}</main>;
  if(!boot)return <main className="loading"><div className="seal">书</div><p>{error||(browserEdition()?'正在打开此浏览器的书库…':'正在打开本机书库…')}</p>{error&&<button onClick={()=>location.reload()}>重新打开</button>}</main>;
  return <div className={'app '+(readingDark?'dark':eyeCare?'eye-care':'')+' font-'+(view?.scenario.ui.theme.fontPreset||'serif')+' preset-'+(themeChosen?'paper':view?.scenario.ui.theme.backgroundPreset||'paper')} style={styles}>
    <header className="topbar"><Link className="brand" href="/" aria-label={(view?.scenario.manifest.title||'互动小说')+'首页'}><span className="seal">{view?.scenario.manifest.title.slice(0,1)||'书'}</span><span>{view?.scenario.manifest.title||'互动小说'}<small>一部由你执笔的长篇故事</small></span></Link>
      <nav aria-label="主导航">{([{id:'library',name:'剧本库',icon:BookMarked},{id:'read',name:'故事',icon:BookOpen},{id:'history',name:'往事',icon:History},{id:'memory',name:'记忆',icon:BookMarked},{id:'characters',name:'人物簿',icon:Users},{id:'settings',name:'设置',icon:Settings}] as const).map(n=><button key={n.id} aria-label={n.name} className={tab===n.id?'nav active':'nav'} onClick={()=>{recordPlace();if(n.id==='characters')setBookScope(null);setTab(n.id);}}><n.icon size={17}/><span>{n.name}</span></button>)}</nav>
      <div className="top-actions"><span className="local"><i/>{offline?'离线阅读':browserEdition()?'此浏览器存档':'主存档服务'}</span><button className="icon" title="切换明暗" aria-label="切换明暗" onClick={()=>prefs({dark:!readingDark})}>{readingDark?<Sun size={18}/>:<Moon size={18}/>}</button><button className="outline small" aria-label="存档" onClick={()=>setSaveModal(true)}><GitBranch size={15}/><span>存档</span></button></div>
    </header>
    {pwa.available&&tab!=='settings'&&<div className="connection-banner" role="status">应用可更新，故事和输入已保留。<button onClick={()=>{recordPlace();setTab('settings');}}>查看更新</button></div>}
    {offline&&<div className="connection-banner" role="status">当前离线，联网后才能生成新内容。<button onClick={()=>void run(async()=>{await initialize();if(!isOffline())setNotice(browserEdition()?'已恢复网络；输入草稿保留，未自动调用模型。':'已连接主存档；离线副本没有上传，输入草稿保留。');})}>检查连接</button></div>}
    {error&&<div role="alert" className="alert"><AlertCircle size={17}/>{error}<button onClick={()=>setError('')} aria-label="关闭错误"><X size={16}/></button></div>}
    {notice&&<div className="notice" role="status"><Check size={15}/>{notice}<button onClick={()=>setNotice('')} aria-label="关闭提示"><X size={14}/></button></div>}
    {tab==='library'?<ScenarioLibrary scenarios={boot.scenarios||[]} api={api} onChanged={loadBoot} offline={offline} onStart={(id,version)=>{setNewPackageId(id);setNewPackageVersion(version);setSaveModal(true);}}/>:!view&&tab!=='settings'?<main className="welcome"><div className="eyebrow">互动小说 · 文字冒险</div><h1>故事，由你展开</h1><div className="red-rule"/><p className="lead">选择一个世界，开始一部属于这一局的小说。</p><p>导入世界、人物与开场，或从内置示例开始。<br/>你的输入推动故事，人物记忆与分支保存在卷册中。</p><button className="outline" onClick={()=>setTab('library')}>打开剧本库</button><button className="primary" onClick={()=>setSaveModal(true)}><Feather size={18}/>翻开新篇</button><div className="welcome-notes"><span>自由交谈</span><span>人物记得往事</span><span>多条命运分支</span></div><small>无需密钥即可阅读序章与使用离线演练。真实续写在设置中连接你的模型。</small></main>:
    tab==='read'&&view&&state?<div className={'workspace '+(!left?'left-closed ':'')+(!right?'right-closed':'')}>
      <aside className={'left-panel '+(left?'open':'')}><div className="panel-title"><span>卷册</span><button className="icon" aria-label="收起卷册" onClick={()=>setLeft(false)}><PanelLeftClose size={16}/></button></div><button className="save-title" onClick={()=>setSaveModal(true)}><BookOpen size={20}/><span>{view.save.title}<small>{view.branch.name}</small></span><ChevronDown size={14}/></button>
        <div className="section-label">故事时间线 <span>{view.turns.length} 节</span></div><div className="timeline">{view.turns.filter((t,i,a)=>i===0||t.state.sceneId!==a[i-1].state.sceneId).map((t,i)=><button key={t.id} onClick={()=>jump(t.id)}><span className="timeline-dot"/><small>第 {String(i+1).padStart(2,'0')} 场</small><strong>{t.state.location}</strong><span>{t.state.date.month}月{t.state.date.day}日 · {t.state.date.period}</span></button>)}</div>
        <div className="section-label">折角书签 <BookmarkIcon size={12}/></div>{view.bookmarks.length?view.bookmarks.map(b=><button className="bookmark-row" key={b.id} onClick={()=>jump(b.turnId)}>{b.note||'此处留一折角'}<ChevronRight size={13}/></button>):<p className="muted panel-note">在喜欢的段落旁留下书签，<br/>随时回到那一刻。</p>}
        <button className="sidebar-foot" onClick={()=>setTab('history')}><History size={16}/>按日期翻阅往事<ChevronRight size={14}/></button>
      </aside>
      <main className="reading-space"><div className="reading-toolbar"><div><button className="icon" title="打开卷册" aria-label="打开卷册" onClick={()=>setLeft(!left)}><Menu size={18}/></button><span>{dateLabel(state.date)}</span><span className="dot-separator">/</span><span>{state.location}</span></div><div><details className="type-settings"><summary>字</summary><div><label>字号<input aria-label="字号" type="range" min="15" max="26" value={size} onChange={e=>prefs({size:+e.target.value})}/></label><label>行距<input aria-label="行距" type="range" min="1.5" max="2.5" step=".1" value={line} onChange={e=>prefs({line:+e.target.value})}/></label><label>阅读主题<select aria-label="阅读主题" value={readingDark?'dark':eyeCare?'eye':'light'} onChange={e=>prefs({dark:e.target.value==='dark',eyeCare:e.target.value==='eye'})}><option value="light">浅色</option><option value="dark">深色</option><option value="eye">护眼</option></select></label><label>栏宽<input aria-label="栏宽" type="range" min="560" max="920" step="40" value={width} onChange={e=>prefs({width:+e.target.value})}/></label></div></details><button className="icon" title={'人物与'+(view.scenario.ui.worldStatsTitle||'世界状态')} aria-label={'人物与'+(view.scenario.ui.worldStatsTitle||'世界状态')} onClick={()=>setRight(!right)}><Users size={18}/></button></div></div>
        <div className="reader" ref={reader} onScroll={recordPlace}>
          <div className="chapter-heading"><div className="eyebrow">卷一 · 新朝</div><h1>{view.save.title}</h1><p>山河初定，长夜未央</p><span>◆</span></div>
          {selected?.provider==='mock'&&<div className="mock-note">离线演练 · Mock 以有限示例验证交互与存档；连接模型后开始自由续写。</div>}
          <div className="reading-pagination"><button disabled={readPage===0} onClick={()=>setReadPage(p=>p-1)}>上一组章节</button><span>第 {readPage+1} / {Math.max(1,Math.ceil(view.turns.length/pageSize))} 组 · 每组最多 {pageSize} 节</span><button disabled={(readPage+1)*pageSize>=view.turns.length} onClick={()=>setReadPage(p=>p+1)}>下一组章节</button></div>
          {view.save.openingStatus==='pending'&&<button className="primary" disabled={busy||offline||!!pending} onClick={()=>void run(()=>send('请根据剧本开局条件生成第一幕，并保留玩家回应空间。'))}>生成第一幕</button>}{view.turns.slice(readPage*pageSize,(readPage+1)*pageSize).map((t,j)=>{const i=readPage*pageSize+j;return <article className="story-turn" id={'turn-'+t.id} key={t.id}>
            {(i===0||t.state.sceneId!==view.turns[i-1].state.sceneId)&&<div className="scene-label"><span>{t.state.location}</span><span>{dateLabel(t.state.date)}</span><span>在场：{t.playerName||playerName}{t.state.present.length?'、'+t.state.present.map(id=>t.characterNames?.[id]||npcName(id)).join('、'):'一人'}</span></div>}
            {t.playerText&&<div className="player-line"><span>{t.playerName||playerName} · 你的原文</span><p>{t.playerText}</p></div>}
            {t.kind==='configuration'?<p className="character-config-note">人物路线配置记录 · 未推进剧情、时间或关系数值</p>:<div className="prose">{t.body.split(/\n\s*\n/).map((p,j)=><p key={j}>{p}</p>)}</div>}
            {i>0&&t.kind!=='configuration'&&<StoryNotes input={t.playerText} body={t.body} diagnostics={t.effects.diagnostics}/>}
            <div className="turn-tools"><span>{i===0?'固定序章 · 无 API 调用':t.provider+' / '+t.model+' · '+(t.memorySource==='local-review'?'记忆经本地审阅 · ':'')+'已保存'}</span>{i>0&&t.kind!=='configuration'&&<button aria-label={'修改第'+i+'节'} disabled={busy||sending||offline} onClick={()=>editTurn(t)}><Feather size={14}/>修改</button>}<button title="留下书签" aria-label={'书签第'+i+'节'} onClick={()=>run(async()=>{const note=await ask({title:'书签与非正史笔记',label:'书签笔记',defaultValue:'此处留一折角',multiline:true,maxLength:600,confirmLabel:'保存书签'});if(note===null)return;await api('saves/'+view.save.id+'/bookmark',{turnId:t.id,note});await load(view.save.id);})}><BookmarkIcon size={14}/></button><button title="查看当时状态" onClick={()=>setSnapshot(t)}><Eye size={14}/><span>当时</span></button><details><summary>···</summary><div className="turn-menu"><button onClick={()=>run(()=>fork(t))}>从此处另开分支</button>{i>0&&t.kind!=='configuration'&&<><button disabled={busy||sending||offline} onClick={()=>editTurn(t,'input')}>编辑输入 / 重写此节</button><button disabled={busy||sending||offline} onClick={()=>editTurn(t)}>编辑正文并分支</button><button disabled={busy||sending||offline} onClick={()=>editTurn(t)}>这不是我的行动</button><button disabled={busy||sending||offline} onClick={()=>editTurn(t,'input')}>人物忘记前情</button><button disabled={busy||sending||offline} onClick={()=>editTurn(t)}>时间跳太快</button></>}</div></details></div>
          </article>;})}
          {readPage===Math.floor((view.turns.length-1)/pageSize)&&draft&&draft.status!=='committed'&&<article className="draft-card"><div className="draft-label"><Feather size={15}/>{draft.status==='generating'&&draft.bodyRepair?.phase==='generating'?'正在修正文 · 原稿保留':statusText[draft.status]}<span>请求 {draft.requestCount} 次</span></div><div className="prose">{draft.body||'灯下，故事正在酝酿…'}</div><DraftProgress draft={draft}/>{draft.error&&<p className="error-text">{draft.error}</p>}{!busy&&<DraftRecovery key={draft.id} draft={draft} profiles={boot.profiles} narrator={selected||boot.profiles[0]} currentId={boot.selected.extractor==='same'?boot.selected.narrator:boot.selected.extractor} retry={async options=>setDraft(await api<Draft>('drafts/'+draft.id+'/retry',options))} repair={async()=>setDraft(await api<Draft>('drafts/'+draft.id+'/repair',{}))} saveLocal={async()=>setDraft(await api<Draft>('drafts/'+draft.id+'/save',{revision:draft.localSaveRevision}))} review={()=>setLocalReview(draft.id)} edit={()=>{setNotice('');setEditor(draft);}} hide={()=>void run(async()=>{await api('drafts/'+draft.id+'/cancel',{});setDraft(null);})}/>}</article>}
          <div className="end-mark">未完，待你落笔</div>
        </div>
        {(newContent||readPage<Math.floor((view.turns.length-1)/pageSize))&&<button className="latest-button" onClick={latest}>{newContent?'有新内容 · ':''}回到最新</button>}
        <div className="composer-wrap">{conflict&&<div className="request-recovery" role="alert">主存档进度已有变化；输入保留。可刷新阅读后重新决定，或从旧节点菜单另开分支。<button onClick={()=>void run(async()=>{await load(view.save.id,view.branch.id);setConflict(false);setError('');})}>刷新当前分支</button></div>}{pending&&<div className="request-recovery" role="status">请求 {pending.clientRequestId.slice(0,8)} · 等待确认保存状态。<button disabled={offline||sending} onClick={()=>void run(checkOriginal)}>查询原请求状态</button>{unreceived&&<button disabled={offline||sending} onClick={()=>void run(()=>send(pending.playerText,pending))}>手动重发原请求</button>}</div>}<div className="composer-meta"><label className={ooc?'ooc-mode':''}><input type="checkbox" checked={ooc} onChange={e=>setOoc(e.target.checked)}/>OOC · 出戏</label><label>交谈对象<select aria-label="交谈对象" value={target||''} onChange={e=>setTarget(e.target.value as NpcId||null)}><option value="">当前场景</option>{state.present.map(id=><option key={id} value={id}>{npcName(id)}</option>)}</select></label><button onClick={()=>run(async()=>setPreview(await api('saves/'+view.save.id+'/context?'+new URLSearchParams({branch:view.branch.id,input,target:target||''}))))}><BookMarked size={13}/>本轮记忆</button></div>
          <div className="composer"><textarea ref={composer} aria-label="自由输入" placeholder={ooc?'讨论规则或文风，不推进剧情…':'说一句话，做一件事，或只是静静等待…'} value={input} disabled={busy&&!offline} maxLength={6000} onChange={e=>setInput(e.target.value)}/>{busy?<button className="send stop" title="停止生成" aria-label="停止生成" onClick={()=>run(async()=>setDraft(await api<Draft>('drafts/'+draft!.id+'/cancel',{})))}><Square size={17}/></button>:<button className="send" title="发送" aria-label="发送" disabled={!input.trim()||offline||sending||!!pending} onClick={()=>run(()=>send())}><ArrowUp size={22}/></button>}</div>
          <div className="composer-foot"><ActionSuggestions key={suggestionKey} providerLabel={selected?.label||'当前模型'} hasDraft={!!suggestionDraft} disabled={busy||offline} generate={signal=>api<SuggestedActions>('suggestions',{saveId:view.save.id,branchId:view.branch.id,expectedHeadTurnId:head!.id,...(suggestionDraft?{draftId:suggestionDraft.id}:{}),authorizeNetwork:true},signal)} onChoose={text=>{setInput(text);setOoc(false);setTarget(null);composer.current?.focus();}}/><span>{offline?'当前离线，联网后才能生成新内容':busy?statusText[draft!.status]:selected?.provider==='mock'?(browserEdition()?'此浏览器保存 · Mock 无云端请求':'主存档保存在服务端 · Mock 无云端请求'):'本轮选定内容发送到 '+(selected?.label||'模型') }<i/></span></div>
        </div>
      </main>
      <aside className={'right-panel '+(right?'open':'')}><div className="panel-title"><span>人物与此刻</span><button className="icon" aria-label="收起人物" onClick={()=>setRight(false)}><PanelRightClose size={16}/></button></div><p className="section-label">本剧本的常驻人物</p>{residents.map((n,i)=><button className="npc-card" key={n.id} onClick={()=>selectNpc(n)}><span className={'avatar avatar-'+i}>{n.name.slice(0,1)}</span><span><strong>{n.name}</strong><small>{n.role}</small></span><span className={state.present.includes(n.id)?'presence':'absent'}>{state.present.includes(n.id)?'在场':'联络'}</span></button>)}
        <button className="outline" onClick={()=>{setBookScope(null);setTab('characters');}}>打开人物簿</button><details className="court"><summary>{view.scenario.ui.worldStatsTitle} <ChevronDown size={14}/></summary><p>数值采用本剧本的定义与初值。</p>{worldDefinitions.map(d=><div key={d.key}><span>{d.displayName}</span><b>{state.worldStats[d.key]}</b></div>)}{residents.map(n=><div key={n.id}><span>{n.name}</span><small>{relationshipDefinitions.filter(d=>state.relationships[n.id]?.values[d.key]!==undefined).map(d=>d.displayName+' '+state.relationships[n.id].values[d.key]).join(' · ')}</small></div>)}</details><div className="section-label">尚待回应</div>{state.pendingThreads.slice(-5).map((p,i)=><p className="pending" key={i}>{p}</p>)}<small className="panel-note">秘密只属于知情者。<br/>人物卡只展示已知资料。</small>
      </aside>
    </div>:
    tab==='characters'&&view&&head?<CharacterBook scenario={view?.scenario} key={view.save.id+(bookScope?.branchId||view.branch.id)+(bookScope?.turn.id||head.id)} saveId={view.save.id} branchId={bookScope?.branchId||view.branch.id} atTurnId={bookScope?.turn.id||head.id} atLabel={dateLabel((bookScope?.turn||head).state.date)} historical={!!bookScope} api={api} onSource={id=>jump(id)} onFork={async(branch,text)=>{await load(view.save.id,branch.id);setInput(text);setTab('read');setNotice('已从来源前另开纠错分支，原文与旧分支保留。');}} onPolicy={async()=>{await load(view.save.id,view.branch.id);setNotice('人物路线配置已保存，原有记忆保留。');}}/>:
    tab==='history'&&view?<main className="page history-page"><div className="page-heading"><div><div className="eyebrow">不让往事只剩摘要</div><h1>翻阅往事</h1><p>阅读完整原文，停在你想回到的那一天。</p></div><button className="outline" onClick={()=>run(()=>download('md'))}><Download size={16}/>导出阅读版</button></div>
      <section className="filter-card"><div className="search-input"><Search size={17}/><input aria-label="搜索原文" placeholder="搜索原文、两字人名或一句话…" value={history.keyword} onChange={e=>setHistory({...history,keyword:e.target.value})}/></div><div className="filter-grid"><label>游戏日期起<input placeholder="年-月-日；相对历使用 1-1-天数" aria-label="游戏日期起" value={history.from} onChange={e=>setHistory({...history,from:e.target.value})}/></label><label>游戏日期止<input placeholder="年-月-日；相对历使用 1-1-天数" aria-label="游戏日期止" value={history.to} onChange={e=>setHistory({...history,to:e.target.value})}/></label><label>截止边界<select value={String(history.inclusive)} onChange={e=>setHistory({...history,inclusive:e.target.value==='true'})}><option value="true">截至当天（含）</option><option value="false">之前（不含当天）</option></select></label><label>人物<select value={history.npc} onChange={e=>setHistory({...history,npc:e.target.value})}><option value="">所有人物</option>{historyPeople.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label><label>地点<input placeholder="输入地点名称" value={history.location} onChange={e=>setHistory({...history,location:e.target.value})}/></label><label>回看分支<select value={historySource?.branch.id||view.branch.id} onChange={e=>run(async()=>setHistoricalView(await api<View>('saves/'+view.save.id+'?branch='+e.target.value)))}>{view.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div><details><summary>现实游玩日期与书签筛选</summary><div className="button-row"><label>从<input type="date" value={history.realFrom} onChange={e=>setHistory({...history,realFrom:e.target.value})}/></label><label>到<input type="date" value={history.realTo} onChange={e=>setHistory({...history,realTo:e.target.value})}/></label><label><input type="checkbox" checked={history.bookmarked} onChange={e=>setHistory({...history,bookmarked:e.target.checked})}/>仅书签</label></div></details></section>
      <div className="result-label">{filtered.length} 节原文 · 浏览不会改变当前进度<button onClick={()=>setPreview({note:'仅当前筛选范围的事实摘录，不补写剧情。',sources:filtered.map(t=>({id:t.id,date:dateLabel(t.state.date),facts:t.effects.facts.map(f=>f.kind+'：'+f.content)}))})}>截至筛选日期回顾</button></div>
      {filtered.slice(historyPage*pageSize,(historyPage+1)*pageSize).map((t,i)=><article className="history-card" id={'history-'+t.id} key={t.id}><header><span>{dateLabel(t.state.date)} · {t.state.location}</span><small>{new Date(t.createdAt).toLocaleString('zh-CN')}</small></header><h3>{t.kind==='configuration'?'人物路线配置 · 不推进剧情':t.playerText||'作者开场'}</h3><div className="prose">{t.body.split(/\n\s*\n/).map((p,j)=><p key={j}>{p}</p>)}</div><div className="button-row"><button onClick={()=>jump(t.id)}>定位原文</button><button onClick={()=>setSnapshot(t)}>查看当时状态</button><button onClick={()=>run(()=>fork(t))}><GitBranch size={14}/>从此处另开分支</button><span className="muted">第 {i+1} 节</span></div></article>)}
      <div className="reading-pagination"><button disabled={historyPage===0} onClick={()=>setHistoryPage(p=>p-1)}>上一页往事</button><span>第 {historyPage+1} / {Math.max(1,Math.ceil(filtered.length/pageSize))} 页</span><button disabled={(historyPage+1)*pageSize>=filtered.length} onClick={()=>setHistoryPage(p=>p+1)}>下一页往事</button></div>
    </main>:
    tab==='memory'&&view?<main className="page"><div className="page-heading"><div><div className="eyebrow">一字一句，皆有来处</div><h1>记忆笺</h1><p>事实、说法与计划分别留存；每条记忆都能回到原文。</p></div><span className="tag">{view.branch.name}</span></div><div className="memory-grid">{view.turns.flatMap(t=>t.effects.facts).map(f=><article className="memory-card" key={f.id}><header><span className="tag">{({confirmed_event:'已发生',claim:'说法',rumor:'传闻',belief:'认知',suspicion:'怀疑',promise:'承诺',order:'命令',intent:'计划',unresolved:'未决'})[f.kind]}</span><small>{f.gameDate.month}月{f.gameDate.day}日</small></header><h3>{f.content}</h3><blockquote>{f.evidence.quote}</blockquote><p className="muted">知情者：{[...new Set([...f.knownBy,...view.turns.flatMap(t=>t.effects.knowledge).filter(k=>k.factId===f.id).map(k=>k.npcId)])].map(npcName).join('、')||'尚无 NPC 获知'}</p>{view.annotations.filter(a=>a.factId===f.id).map(a=><p className="annotation" key={a.id}>{a.kind==='pin'?'已钉住':a.kind==='error'?'纠错标注':'笔记'}：{a.text}</p>)}<footer><button onClick={()=>jump(f.sourceTurnId)}>原文来源 <ChevronRight size={13}/></button><button aria-label="钉住记忆" onClick={()=>run(()=>annotate(f,'pin'))}><Pin size={14}/></button><button onClick={()=>run(()=>annotate(f,'error'))}>纠错</button><button onClick={()=>run(()=>annotate(f,'note'))}>笔记</button></footer></article>)}</div><section className="ooc-list"><h2>OOC · 出戏手记</h2><p className="muted">这些讨论独立保存，不进入人物记忆。</p>{view.ooc.map(o=><article key={o.id}><strong>{o.playerText}</strong><p>{o.body}</p></article>)}{!view.ooc.length&&<p>尚无出戏讨论。</p>}</section></main>:
    <main className="page settings-page"><div className="page-heading"><div><div className="eyebrow">笔墨与书库</div><h1>设置</h1><p>{browserEdition()?'主存档保存在当前浏览器 IndexedDB，不支持自动跨设备同步。':'主存档位于提供服务的电脑或服务器。'}只有本轮选定上下文会发送至你选择的模型。</p></div></div><div className="settings-grid"><section className="settings-card"><h2>叙事模型</h2><button className="outline" onClick={()=>setTab('memory')}>查看记忆笺与 OOC 手记</button><label>正文配置<select value={narrator} onChange={e=>setNarrator(e.target.value)}>{boot.profiles.map(p=><option key={p.id} value={p.id}>{p.label} · {p.model||'未选模型'}</option>)}</select></label><label>记忆整理配置<select value={extractor} onChange={e=>setExtractor(e.target.value)}><option value="same">与正文相同</option>{boot.profiles.map(p=><option key={p.id} value={p.id}>{p.label} · {p.model||'未选模型'}</option>)}</select></label><label>文风偏好<select value={style} onChange={e=>setStyle(e.target.value)}>{['克制，留白，以对白与动作推进。','对白更短，允许平静闲聊。','细写环境与停顿，保留回应空间。'].map(s=><option key={s}>{s}</option>)}</select></label><button className="primary" onClick={()=>run(async()=>{await api('settings',{narrator,extractor,style});await loadBoot();setNotice('设置已保存；只作用于下一轮请求。');})}>保存选择</button><p className="muted">通常每轮一次正文请求、一次记忆整理。最多一次格式修复；不会自动换供应商。</p></section>
      <section className="settings-card"><h2>供应商配置</h2>{boot.deployment?<><p>本站模型由站长统一提供，无需填写 API Key。</p>{boot.profiles.map(p=><p key={p.id}>{p.label} · {p.provider} / {p.model} · {p.hasKey?'已配置':'尚未配置'}</p>)}<p>每次请求输出最多 {boot.deployment.maxOutputTokens} tokens；个人每天最多 {boot.deployment.playerDailyRequests} 次模型请求。正文、记忆和重试分别计数。</p><p className="muted">上次刷新时已用 {boot.deployment.usedRequests} 次；UTC 零点重置。达到个人或全站预算后暂停调用，已存剧情保留。</p><button onClick={()=>void run(loadBoot)}>刷新额度</button></>:<>{boot.profiles.map(p=><button className="profile-row" key={p.id} onClick={()=>{setSettings({...p});setKey('');setRememberKey(browserEdition()&&(p.rememberKeyPreference??true));setModelList([]);}}><span><strong>{p.label}</strong><small>{p.model||'请手动选择完整模型 ID'}</small></span><span>{p.provider==='mock'?'离线':p.hasKey?(p.keyRemembered?'已记住密钥':browserEdition()?'本页密钥已配置':'密钥已配置'):'未配置密钥'} <ChevronRight size={14}/></span></button>)}<button onClick={()=>{setSettings({...boot.profiles[0],id:requestId(),label:'新的模型配置'});setKey('');setRememberKey(browserEdition());setModelList([]);}}><Plus size={15}/>增加配置</button></>}{boot.keyStorageWarning&&<p className="error-text">{boot.keyStorageWarning}</p>}{boot.lastError&&<p className="error-text">{boot.lastError}</p>}</section>
      <section className="settings-card"><h2><Database size={18}/>主存档数据</h2><p className="path">{boot.dataDir}</p>{boot.backupError&&<p className="error-text">{boot.backupError}</p>}<p>{browserEdition()?'浏览器内 SQLite 自动保存到 IndexedDB，保留上一版本及最近的自动／手动备份。浏览器可能清理数据，请定期导出完整 JSON。':'SQLite 自动保存。每 10 个正式节点在线备份，保留最近 10 份自动备份；手动备份独立保留。'}</p><div className="button-row">{!boot.deployment&&<button className="outline" onClick={()=>run(async()=>{const r=await api<{path:string}>('backup',{});setNotice('完整数据库备份：'+r.path);})}>立即安全备份</button>}<button className="outline" onClick={()=>setSaveModal(true)}>导入 / 导出存档</button></div><p className="muted">{browserEdition()?'导出完整 JSON 可恢复正文、记忆、人物及分支；换设备或清理浏览器前请另存文件。导入创建新卷册，不覆盖已有数据。':boot.deployment?'导出完整 JSON 可恢复正文、记忆、人物及分支。整站数据库备份由站长管理。':'恢复完整数据库请停止服务，运行 pnpm restore 备份路径 新数据目录，再以 APP_DATA_DIR 指向新目录。不会覆盖原库。'}</p></section>
      <PwaTools saveId={view?.save.id} offline={offline} busy={busy||sending||!!pending||testing} typing={!!input.trim()||!!key||!!revision||!!editor||!!localReview||!!settings||narrator!==boot.selected.narrator||extractor!==boot.selected.extractor||style!==boot.style} pwa={pwa} beforeUpdate={flushInput} report={setNotice}/>
      {boot.deployment&&<section className="settings-card"><h2>你的独立书库</h2><p>正式剧情保存在服务器，按此浏览器的匿名身份隔离。刷新和重新打开可继续；清除 Cookie 或换浏览器会建立新身份。</p><p>当前没有账号跨设备同步。请通过“导入 / 导出存档”保存完整 JSON，换设备时导入继续。仅输入草稿和主动下载的离线副本保存在浏览器。</p></section>}
      {!browserEdition()&&boot.accessMode!=='local'&&(!boot.deployment||boot.deployment.loginRequired)&&<section className="settings-card"><h2>个人访问保护</h2><p>接口需要登录；已下载的离线副本在此设备上仍可阅读。共用设备请先移除离线副本。</p><button onClick={()=>void run(async()=>{await api('logout',{});setLoginRequired(true);setBoot(null);setView(null);setKey('');})}>退出登录</button></section>}
      <section className="settings-card"><h2>写法参考</h2><p>仅参考写法，不导入剧情。TXT / MD 会隔离保存，仅提炼固定风格标签，不会把独有事件发给模型。</p><label className="file-button"><Upload size={16}/>导入参考文本<input type="file" accept=".txt,.md" onChange={e=>{const file=e.target.files?.[0];if(file)void run(async()=>{if(file.size>500000)throw new Error('参考文本限500KB');const r=await api<{note:string}>('references',{filename:file.name,content:await file.text()});setNotice(r.note);await loadBoot();});e.target.value='';}}/></label><p className="muted">模型自然语言仍可能越权或忘记细节。可从正文菜单标记问题并另开分支，原文始终保留。</p></section></div></main>}
    {saveModal&&<Modal title="你的卷册" close={()=>setSaveModal(false)}><div className="save-list">{boot.saves.map(s=><div key={s.id}><button onClick={()=>run(async()=>{await load(s.id);setTab('read');setSaveModal(false);})}><BookOpen size={18}/><span><strong>{s.title}</strong><small>{new Date(s.createdAt).toLocaleDateString('zh-CN')}</small></span><ChevronRight size={17}/></button><button onClick={()=>run(()=>renameSave(s))}>改名</button><button className="danger" disabled={deletingSave!==null} onClick={()=>run(()=>deleteSave(s))}>{deletingSave===s.id?'备份并删除中…':'删除'}</button></div>)}</div>{view&&<div className="branch-box"><ScenarioUpgrade view={view} scenarios={boot.scenarios||[]} api={api} disabled={offline||busy||!!pending} onChanged={async()=>{await loadBoot();await load(view.save.id,view.branch.id);}}/><p className="muted">可恢复 JSON 包含后台隐藏资料及完整人物履历；阅读版只含已显示的剧情原文。</p><label>当前分支<select value={view.branch.id} onChange={e=>run(async()=>{if(!offline)await api('saves/'+view.save.id+'/switch',{branchId:e.target.value});await load(view.save.id,e.target.value);})}>{view.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button onClick={()=>run(()=>fork(head!))}>保存为命名分支</button><div className="button-row"><button onClick={()=>run(()=>download('json'))}>可恢复 JSON</button><button onClick={()=>run(()=>download('md'))}>阅读版 MD</button><button onClick={()=>run(()=>download('txt'))}>阅读版 TXT</button></div></div>}<h3>翻开新篇</h3><NewScenarioGame scenarios={boot.scenarios||[]} api={api} initialPackageId={newPackageId} initialVersion={newPackageVersion} onStarted={async s=>{await loadBoot();await load(s.id);setTab('read');setSaveModal(false);}}/><label className="file-button"><Upload size={16}/>导入可恢复 JSON（创建新档）<input type="file" accept=".json" onChange={e=>{const file=e.target.files?.[0];if(file)void run(async()=>{if(file.size>20*1024*1024)throw new Error('JSON限20MB，不接受ZIP。');const s=await api<Save>('saves/import',{archive:await file.text()});await loadBoot();await load(s.id);setSaveModal(false);setTab('read');setNotice('已创建导入存档，原档未改动。');});e.target.value='';}}/></label></Modal>}
    {contact&&<Modal title={'联络'+contact.name} close={()=>setContact(null)}><p>{contact.description}</p><p>{state?.relationships[contact.id]?.status||view?.characters?.find(c=>c.id===contact.id)?.location||"地点尚未确认"}</p><p>此人当前不在场。联络只是填入下一条输入，不会立即改变人物位置。</p><div className="button-row">{(view?.scenario.characters.find(c=>c.stableId===contact.id)?.contactModes||['summon','visit','letter']).map(action=><button className="outline" key={action} onClick={()=>{setInput(action==='summon'?'请'+contact.name+'来'+(state?.location||'这里')+'。':action==='visit'?'前往拜访'+contact.name+'。':action==='locate'?'派人打听'+contact.name+'的行踪。':'写信给'+contact.name+'：');setContact(null);setTab('read');composer.current?.focus();}}>{({summon:'召见',visit:'前往',letter:'书信',locate:'寻访'})[action]}</button>)}</div></Modal>}
    {snapshot&&<Modal title="那一刻的人物与世界" close={()=>setSnapshot(null)}><p>{dateLabel(snapshot.state.date)} · {snapshot.state.location}</p><p className="muted">读取此节点保存的快照，不是最新状态。</p>{residents.map(n=><div className="snapshot-row" key={n.id}><strong>{snapshot.characterNames?.[n.id]||n.name}</strong><span>{relationshipDefinitions.filter(d=>snapshot.state.relationships[n.id]?.values[d.key]!==undefined).map(d=>d.displayName+' '+snapshot.state.relationships[n.id].values[d.key]).join(' · ')}</span></div>)}<p>在场：{snapshot.playerName||playerName}{snapshot.state.present.map(id=>'、'+(snapshot.characterNames?.[id]||npcName(id)))}</p><p>消息 {snapshot.state.messageCount} · 场景 {snapshot.state.sceneCount}</p><p>{snapshot.state.weather}</p><p>{worldDefinitions.map(d=>d.displayName+' '+snapshot.state.worldStats[d.key]).join(' · ')}</p><div className="button-row"><button onClick={()=>jump(snapshot.id)}>回到原文</button><button onClick={()=>{setBookScope({branchId:tab==='history'&&historicalView?historicalView.branch.id:view!.branch.id,turn:snapshot});setSnapshot(null);setTab('characters');}}>查看当时人物簿</button><button onClick={()=>run(async()=>{await fork(snapshot);setSnapshot(null);})}>从这里续写分支</button></div></Modal>}
    {preview!==null&&<Modal title="记忆与来源预览" close={()=>setPreview(null)}><p className="muted">展示本轮可见资料，不包含密钥、隐藏人物背景或模型思考。来源均限当前分支与截点。</p><pre className="preview">{JSON.stringify(preview,null,2)}</pre></Modal>}
    {localReview&&<DraftReview id={localReview} api={api} close={()=>setLocalReview(null)} saved={d=>{setLocalReview(null);setDraft(d);}}/>}
    {editor&&<DraftEditor draft={editor} profile={boot.profiles.find(p=>p.id===(boot.selected.extractor==='same'?boot.selected.narrator:boot.selected.extractor))||boot.profiles[0]} close={()=>setEditor(null)} save={async body=>{setDraft(await api<Draft>('drafts/'+editor.id+'/retry',{extractOnly:true,body,extractProfileId:boot.selected.extractor==='same'?boot.selected.narrator:boot.selected.extractor}));setEditor(null);}}/>}
    {revision&&view&&<Modal title="修改这一节" close={()=>setRevision(null)}><p>保存时自动建立修订分支，原文和原来的后续剧情都会保留。记忆与人物状态按修改后的内容重新整理。</p><div className="button-row"><button aria-pressed={revision.mode==='prose'} onClick={()=>setRevision({...revision,mode:'prose'})}>修改正文</button><button aria-pressed={revision.mode==='input'} onClick={()=>setRevision({...revision,mode:'input'})}>改写输入</button></div><form onSubmit={e=>{e.preventDefault();void run(submitRevision);}}><label>你的输入<textarea required aria-label="修订玩家输入" maxLength={6000} value={revision.player} onChange={e=>setRevision({...revision,player:e.target.value})}/></label>{revision.mode==='prose'?<label>正文<textarea required aria-label="修订正式正文" className="draft-editor" maxLength={100000} value={revision.text} onChange={e=>setRevision({...revision,text:e.target.value})}/></label>:<p className="muted">按新输入重新生成这一节，完成后自动保存。不会带入原节点之后的故事与人物记忆。</p>}<p className="muted">使用当前模型设置，真实服务可能计费。</p><div className="button-row"><button className="primary" type="submit" disabled={busy||sending||offline||!revision.player.trim()||(revision.mode==='prose'&&!revision.text.trim())}>{revision.mode==='prose'?'保存修改':'重新生成并保存'}</button><button type="button" onClick={()=>setRevision(null)}>取消</button></div></form></Modal>}
    {settings&&<Modal title="编辑模型配置" close={()=>{setSettings(null);setKey('');}}><label>配置名称<input value={settings.label} onChange={e=>setSettings({...settings,label:e.target.value})}/></label><label>供应商<select value={settings.provider} onChange={e=>{const p=boot.profiles.find(p=>p.provider===e.target.value)||DEFAULT_PROFILES.find(p=>p.provider===e.target.value)!;setSettings({...p,id:settings.id,label:settings.label});setKey('');setModelList([]);}}><option value="mock">Mock · 离线</option><option value="siliconflow">硅基流动</option><option value="deepseek">DeepSeek 官方</option><option value="google-gemma">Google AI · Gemma 原生</option></select></label><label>模型 ID<input list="model-ids" aria-label="模型 ID" value={settings.model} onChange={e=>setSettings({...settings,model:e.target.value})}/><datalist id="model-ids">{modelList.map(m=><option key={m} value={m}/>)}</datalist></label>{settings.provider==='google-gemma'&&<p className="muted">默认 gemma-4-26b-a4b-it · Google 原生适配器 · 无需 OpenAI Key</p>}{settings.provider!=='mock'&&<label>{browserEdition()?'API Key（可在此设备记住）':'API Key（只存服务端进程内存）'}<input type="password" autoComplete="off" aria-label="API Key" placeholder={settingsKeyProfile?.hasKey?'已配置；输入新密钥可替换':''} value={key} onChange={e=>setKey(e.target.value)}/></label>}{browserEdition()&&settings.provider!=='mock'&&<><label><input type="checkbox" checked={rememberKey} onChange={e=>setRememberKey(e.target.checked)}/>在此设备记住 API Key</label><p className="muted">{settingsKeyProfile?.hasKey?(settingsKeyProfile.keyRemembered?'已记住密钥；刷新或重新打开会自动使用。':'此密钥仅供本次页面使用。'):'尚未配置密钥。'} 输入框留空会沿用已配置的密钥。取消勾选并保存，将移除本机记忆，仅供本次页面使用。</p>{settingsKeyProfile?.hasKey&&<button disabled={testing} onClick={()=>run(async()=>{await api('profiles/forget-key',{profileId:settings.id});setKey('');await loadBoot();setNotice('已清除这项配置的本机密钥。');})}>清除这项密钥</button>}</>}<div className="filter-grid"><label>请求超时 / 秒<input type="number" min="5" max="300" value={settings.timeoutMs/1000} onChange={e=>setSettings({...settings,timeoutMs:+e.target.value*1000})}/></label><label>流式首字等待 / 秒<input type="number" min="1" max="180" value={settings.firstTextTimeoutMs/1000} onChange={e=>setSettings({...settings,firstTextTimeoutMs:+e.target.value*1000})}/></label><label>输出上限 / tokens<input type="number" min="256" max="16000" value={settings.maxOutputTokens} onChange={e=>setSettings({...settings,maxOutputTokens:+e.target.value})}/></label><label>篇幅目标<select value={settings.length} onChange={e=>setSettings({...settings,length:e.target.value as Profile['length']})}><option value="short">短对白 100–350字</option><option value="normal">普通段落 300–700字</option><option value="long">关键场景 600–1200字</option></select></label></div><p className="muted">篇幅是写作目标，token 上限是硬限制。正文和记忆整理各使用一次请求超时；重试同一模型时会采用最新的等待时间和输出上限。</p><p className="muted">{browserEdition()?'勾选后，密钥只保存在当前浏览器本地，浏览器直接调用供应商。不随存档导出、不上传仓库、不自动同步到其他设备。共用设备可取消勾选；清除网站数据也会清除已记住的密钥。':'提交后清空浏览器密钥表单。重启需重填，或使用本机明文 .env.local；密钥不进入存档与导出。'}</p><button className="primary" onClick={()=>run(async()=>{const {id,label,provider,model,timeoutMs,connectTimeoutMs,firstTextTimeoutMs,maxOutputTokens,length}=settings;const secret=key;await api('profiles',{profile:{id,label,provider,model,timeoutMs,connectTimeoutMs,firstTextTimeoutMs,maxOutputTokens,length},key:secret,rememberKey:browserEdition()?rememberKey:undefined});setKey('');await loadBoot();setNotice('模型配置已保存。');})}>保存配置与密钥</button><div className="button-row">{[['models','获取模型列表'],['test','测试连接'],['structured','测试 JSON 能力']].map(([action,label])=><button disabled={testing} key={action} onClick={()=>run(async()=>{if(settings.provider!=='mock'&&(await ask({title:'确认模型请求',description:'将向'+settings.provider+'发送'+(action==='models'?'模型列表查询':'不含剧情的小额测试请求')+'，可能产生费用。使用已保存的配置与密钥。',confirmLabel:'确认发送'}))===null)return;setTesting(true);try{const r=await api<{models?:{id:string}[]}>('providers/'+(action==='models'?'models':'test'),{profileId:settings.id,authorizeNetwork:true,structured:action==='structured'});if(r.models)setModelList(r.models.map(m=>m.id));else setPreview(r);await loadBoot();}finally{setTesting(false);}})}>{label}</button>)}</div><p className="muted">高级能力按 endpoint + model 分别记录。未知时仅用普通文本整理；未核实的采样/思考参数不发送。</p><pre className="capabilities">{JSON.stringify(boot.profiles.find(p=>p.id===settings.id)?.capabilities||{},null,2)}</pre></Modal>}
    {dialog}
  </div>;
}
type AnnotationKind='pin'|'error'|'note';
