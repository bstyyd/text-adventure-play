import type { Extraction, State } from '../domain/types';
import { blocks } from '../memory/context';

// Only these fixed notices may be projected to the browser. Model warnings can contain secrets.
export const MEMORY_NOTICES={
  writing:'整理模型提出了正文参考意见；是否修改由你决定，不影响保存。',
  weather:'天气摘要未提供新的明确依据，已沿用上一节天气。',
  events:'未匹配到既有事件编号的提案未改变事件队列；相关剧情按有来源的记忆保存。',
  threads:'未决事项已沿用已有记录，并从本节有来源的计划、命令、承诺和疑点中整理。',
  player:'主角已从 NPC 名单中分离；正文、来源与人物记忆继续按原规则校验。',
} as const;

// Correct optional summary fields, never invent evidence or drop character/authority changes.
export function normalizeExtraction(previous:State,input:string,body:string,raw:Extraction){
  const extraction=structuredClone(raw),diagnostics:string[]=[];
  // `player` is a reserved protagonist/evidence identifier, not an NPC. These
  // two lists describe NPC witnesses only; player visibility is `revealed`.
  // Never remove unknown NPCs, evidence, knowledge changes or authority checks.
  if(extraction.sceneProposal?.present.includes('player')||extraction.facts.some(f=>f.revealed&&f.knownBy.includes('player'))){
    if(extraction.sceneProposal)extraction.sceneProposal.present=extraction.sceneProposal.present.filter(id=>id!=='player');
    for(const fact of extraction.facts)if(fact.revealed)fact.knownBy=fact.knownBy.filter(id=>id!=='player');
    diagnostics.push(MEMORY_NOTICES.player);
  }
  if(extraction.validationWarnings.length)diagnostics.push(MEMORY_NOTICES.writing);
  const scene=extraction.sceneProposal;
  if(scene&&scene.weather!==previous.weather){
    const weather=scene.weather.trim();
    const compact=(s:string)=>s.replace(/[\s，,。；;]/g,'');
    const shortened=!!weather&&compact(previous.weather).includes(compact(weather));
    if(!weather||shortened||!Object.values({player:input,...blocks(body)}).some(s=>s.includes(weather))){
      scene.weather=previous.weather;diagnostics.push(MEMORY_NOTICES.weather);
    }
  }
  const existingEvents=new Set(previous.events.map(e=>e.key));
  const events=extraction.eventProposals.filter(e=>existingEvents.has(e.key));
  if(events.length!==extraction.eventProposals.length)diagnostics.push(MEMORY_NOTICES.events);
  extraction.eventProposals=events;
  const sourceThreads=new Set([...previous.pendingThreads,...extraction.facts.map(f=>f.content)]);
  const threads=extraction.pendingThreads.filter(t=>sourceThreads.has(t));
  if(threads.length!==extraction.pendingThreads.length)diagnostics.push(MEMORY_NOTICES.threads);
  extraction.pendingThreads=threads;
  return {extraction,diagnostics};
}
