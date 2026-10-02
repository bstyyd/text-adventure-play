'use client';
import { useRef, useState } from 'react';
import type { Draft, Profile } from '../domain/types';
import { storyBodyIssues } from '../domain/story-body';
import { BodyIssues } from './BodyIssues';
import { Modal } from './Modal';

export function DraftEditor({draft,profile,close,save}:{draft:Draft;profile:Profile;close:()=>void;save:(body:string)=>Promise<void>}){
  const [text,setText]=useState(draft.body),[pending,setPending]=useState(false),[error,setError]=useState('');
  const editor=useRef<HTMLTextAreaElement>(null),issues=storyBodyIssues(draft.playerText,text);
  return <Modal title="修订未提交正文" close={()=>{if(!pending)close();}}>
    <p>原输入：{draft.playerText}</p>
    <p>正文由你决定，可以保留或修改。点一次保存后，系统会整理记忆并保存；参考提示不阻止提交。</p>
    <BodyIssues issues={issues} locate={issue=>{editor.current?.focus();editor.current?.setSelectionRange(issue.start,issue.end);editor.current?.scrollIntoView({block:'center'});}}/>
    <form onSubmit={async e=>{e.preventDefault();if(pending||!text.trim())return;setPending(true);setError('');try{await save(text);}catch(e){setError((e as Error).message);}finally{setPending(false);}}}>
      <textarea ref={editor} aria-label="核对草稿正文" className="draft-editor" maxLength={100000} value={text} onChange={e=>setText(e.target.value)} disabled={pending}/>
      <p className="muted">此次记忆整理：{profile.model}。{profile.provider==='mock'?'本地 Mock，无网络请求。':'真实服务可能计费。'}若原文被截断，请先补全这一节。</p>
      {error&&<p className="error-text" role="alert">{error}</p>}
      <p role="status">{issues.length?'有 '+issues.length+' 处参考提示，可直接保存。':'正文可以保存。'}记忆的来源、人物权限和存档版本仍会核对。</p>
      <button className="primary" disabled={pending||!text.trim()} type="submit">{pending?'正在提交…':'保存修改并自动整理'}</button>
    </form>
  </Modal>;
}
