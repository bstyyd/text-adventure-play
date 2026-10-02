'use client';
import type { StoryBodyIssue } from '../domain/story-body';

export function BodyIssues({issues,locate}:{issues:StoryBodyIssue[];locate?:(issue:StoryBodyIssue)=>void}){
  if(!issues.length)return null;
  return <section className="body-issues" aria-label="正文参考提示">
    <p>以下是措辞参考提示，是否修改由你决定：</p>
    {issues.map((issue,i)=><div key={issue.start}><blockquote>{issue.quote}</blockquote><p className="muted">{issue.reason}。{locate&&<button type="button" onClick={()=>locate(issue)}>定位第 {i+1} 处</button>}</p></div>)}
    <p className="muted">提示可能误判，不阻止保存，也不要求逐条确认。你可以保留原文，或随时修改。</p>
  </section>;
}
