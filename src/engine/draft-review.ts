import { createHash } from 'node:crypto';
import type { Draft, Extraction, Turn } from '../domain/types';
import type { DraftReview } from '../domain/draft-review';
import { characterWorld } from '../characters/world';
import { ValidationError } from './errors';
import { CharacterIdSchema } from '../domain/identity';

export const draftRevision=(draft:Draft)=>createHash('sha256').update(JSON.stringify(draft)).digest('hex');

export function reviewedExtraction(draft:Draft,review:DraftReview,history:Turn[]):Extraction{
  const fail=(text:string):never=>{throw new ValidationError(text);};
  const previous=history.at(-1)!.state,stored=draft.extraction;
  if(stored&&[stored.proposedCharacterChanges,stored.proposedOfficeChanges,stored.proposedRelationshipChanges,stored.proposedKnowledgeChanges,stored.unresolvedMentions,stored.relationshipEvidence,stored.eventProposals,stored.knowledgeProposals].some(items=>items?.length))
    fail('这份草稿已有身份、关系或消息传播提案，请修订正文并使用模型整理，以免遗漏履历。');
  if(/任命|罢免|兼任|代理.{0,12}(?:官|职|使|令)|封为|免去|革去|赐封|授予|拘押|杖责|处死|改名|更名|真名|真实身份|认作.{0,8}(?:父|母|兄|弟|姐|妹)|结盟|绝交/.test(review.body+'\n'+draft.playerText))
    fail('本地简要审阅不处理任免、身份或关系履历变更，请使用模型整理这些事件。');
  const visible=new Set(characterWorld(history).map(c=>c.id));
  const newRefs=new Set(review.characters.map(c=>c.draftRef));
  const known=(id:string)=>visible.has(id)||newRefs.has(id);
  if(review.present.some(id=>!known(id))||review.facts.some(f=>f.knownBy.some(id=>!known(id))||((f.subject.startsWith('new:')||CharacterIdSchema.safeParse(f.subject).success)&&!known(f.subject)))||review.characters.some(c=>c.knownBy.some(id=>!visible.has(id))))
    fail('只能使用当前节点已知人物或本次明确登记的人物。');
  if(stored?.proposedCharacterCreations?.some(c=>!review.characters.some(r=>r.name===c.name||r.name===c.referenceName)))
    fail('此前整理发现了新人物，请补齐人物登记，或继续使用模型整理。');
  if(/离开|前往|走到|去往|移步|启程|赶路|睡到|等到|过夜/.test(draft.playerText))
    fail('本地简要审阅保持当前时间与地点；涉及转场或时间推进时请使用模型整理。');
  if(review.facts.some(f=>!f.revealed))fail('本地审阅只登记玩家已经看到的原文，不能补写隐藏秘密。');
  return {
    sceneProposal:{minutes:0,location:previous.location,weather:previous.weather,present:review.present,evidence:review.sceneEvidence},
    facts:review.facts,knowledgeProposals:[],relationshipEvidence:[],eventProposals:[],pendingThreads:[],suggestedActions:[],validationWarnings:[],
    proposedCharacterCreations:review.characters.map(c=>({
      ...c,referenceName:c.name,motivation:null,relevance:'supporting',
      presence:review.present.includes(c.draftRef)?'present':'mentioned',
      location:review.present.includes(c.draftRef)?previous.location:null,revealed:true,
    })),
  };
}
