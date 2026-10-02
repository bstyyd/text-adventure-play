'use client';
import { storyBodyIssues } from '../domain/story-body';
import { BodyIssues } from './BodyIssues';

export function StoryNotes({input,body,diagnostics}:{input:string;body:string;diagnostics:string[]}){
  const issues=storyBodyIssues(input,body);
  if(!issues.length&&!diagnostics.length)return null;
  return <details className="story-notes"><summary>本节提示 · 已保存，修改由你决定</summary>
    <BodyIssues issues={issues}/>{diagnostics.map((note,i)=><p className="muted" key={i}>{note}</p>)}
  </details>;
}
