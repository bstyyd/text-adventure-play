'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { SuggestedActions } from '../domain/types';

export function ActionSuggestions({providerLabel,hasDraft,disabled,generate,onChoose}:{
  providerLabel:string;hasDraft:boolean;disabled:boolean;
  generate:(signal:AbortSignal)=>Promise<SuggestedActions>;onChoose:(text:string)=>void;
}){
  const [result,setResult]=useState<SuggestedActions|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('');
  const controller=useRef<AbortController|null>(null),details=useRef<HTMLDetailsElement>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function request(){
    if(pending||disabled)return;
    const requestController=new AbortController();controller.current=requestController;setPending(true);setError('');
    try{const next=await generate(requestController.signal);if(!requestController.signal.aborted)setResult(next);}
    catch(e){if(!requestController.signal.aborted)setError((e as Error).message);}
    finally{if(!requestController.signal.aborted)setPending(false);}
  }
  return <details className="suggestions" ref={details}>
    <summary>无从落笔？看看行动建议 <ChevronDown size={12}/></summary>
    <div className="suggestion-panel" aria-label="当前段落行动建议">
      <p>根据{hasDraft?'上方未保存的草稿':'当前段落'}，由{providerLabel}生成。选中后只填入输入框，可改写后再发送。</p>
      {hasDraft&&<p className="muted">草稿只是参考。继续剧情前，请先整理或收起草稿。</p>}
      {result&&<div className="suggestion-options">{result.actions.map((action,i)=><button key={i} type="button" disabled={disabled||pending} onClick={()=>{onChoose(action);if(details.current)details.current.open=false;}}>{action}</button>)}</div>}
      {error&&<p className="error-text">{error}</p>}
      <div className="suggestion-controls">
        <button type="button" className="outline" disabled={disabled||pending} onClick={()=>void request()}>{pending?'正在根据上文生成…':result?'重新生成建议':'生成本段建议'}</button>
        {pending&&<button type="button" onClick={()=>{controller.current?.abort();setPending(false);}}>停止等待</button>}
      </div>
      {disabled&&<p className="muted">请等待当前段落生成与整理结束。</p>}
    </div>
  </details>;
}
