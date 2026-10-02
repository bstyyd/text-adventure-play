import { z } from 'zod';
import { CharacterIdSchema, CharacterRefSchema, EvidenceSchema } from './identity';
import { dynamicProposalFields } from '../characters/schema';
import type { Character, CharacterEvent, CharacterView } from '../characters/schema';
export { EvidenceSchema } from './identity';
import type { PublicScenario } from '../scenario/schema';

export const NpcIdSchema = CharacterIdSchema;
export type NpcId = z.infer<typeof NpcIdSchema>;
export const ProviderIdSchema = z.enum(['mock','siliconflow','deepseek','google-gemma']);
export type ProviderId = z.infer<typeof ProviderIdSchema>;
export type GameDate = {year:number; month:number; day:number; minuteOfDay:number; absoluteDay:number; period:string; calendarVersion:string;display?:string};
export type Relationship = {values:Record<string,number>; status:string};
export type StoryEvent = {key:string; type:string; npcIds:NpcId[]; status:'eligible'|'queued'|'introduced'|'resolved'|'cancelled'; reason:string; triggerTurnId:string; priority:number; introducedScene?:string};
export type StoryThread = {id:string;type:string;content:string;status:'open'|'resolved';sourceTurnId:string;evidence:Evidence};
export type DynamicLocation = {id:string;name:string;sourceTurnId:string;evidence:Evidence;revealed?:boolean};
export type State = {
  date:GameDate; accessionDay:number; location:string; locationId:string; weather:string; present:NpcId[]; sceneId:string;
  messageCount:number; sceneCount:number; originRegion:null; relationships:Record<NpcId,Relationship>;
  worldStats:Record<string,number>;romancePolicies?:Record<string,'disabled'|'available'>;
  events:StoryEvent[]; eventKeys:string[]; relationshipKeys:string[]; sceneDeltas:Record<string,number>;
  neglect:Record<string,number>; exceptions:Record<string,string[]>; contacted:NpcId[];
  factIds:string[]; pendingThreads:string[]; storyThreads?:StoryThread[]; dynamicLocations?:DynamicLocation[];
};
export type Evidence = z.infer<typeof EvidenceSchema>;
export const FactKindSchema = z.enum(['confirmed_event','claim','rumor','belief','suspicion','promise','order','intent','unresolved']);
export const FactProposalSchema = z.object({
  kind:FactKindSchema, content:z.string().min(1).max(600), subject:z.string().min(1).max(80),
  evidence:EvidenceSchema, knownBy:z.array(CharacterRefSchema).max(64), revealed:z.boolean(),
  importance:z.number().int().min(1).max(5),
}).strict();
export const ExtractionSchema = z.object({
  sceneProposal:z.object({
    minutes:z.number().int().min(0).max(43200),location:z.string().min(1).max(80),
    present:z.array(CharacterRefSchema).max(64),weather:z.string().max(80),evidence:EvidenceSchema,
  }).strict().nullable(),
  facts:z.array(FactProposalSchema).max(20),
  knowledgeProposals:z.array(z.object({npcId:CharacterRefSchema,factIndex:z.number().int().min(0).max(19),path:z.enum(['witness','told','letter','investigation']),evidence:EvidenceSchema}).strict()).max(48),
  worldStatEvidence:z.array(z.object({statKey:z.string().max(80),direction:z.enum(['positive','negative']),reason:z.string().max(300),evidence:EvidenceSchema}).strict()).max(20).optional(),
  relationshipEvidence:z.array(z.object({
    npcId:NpcIdSchema,axis:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/),category:z.string().max(80),
    direction:z.enum(['positive','negative']),reason:z.string().min(1).max(300),evidence:EvidenceSchema,
  }).strict()).max(12),
  eventProposals:z.array(z.object({key:z.string().max(180),status:z.enum(['introduced','resolved','cancelled']),evidence:EvidenceSchema}).strict()).max(3),
  pendingThreads:z.array(z.string().max(300)).max(10),
  proposedStoryThreads:z.array(z.object({threadId:z.uuid().nullable(),type:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/),content:z.string().min(1).max(300),status:z.enum(['open','resolved']),evidence:EvidenceSchema}).strict()).max(10).optional(),
  suggestedActions:z.array(z.string().min(1).max(160)).min(3).max(4),
  validationWarnings:z.array(z.string().max(300)).max(8),
  ...dynamicProposalFields,
}).strict();
export type Extraction = z.infer<typeof ExtractionSchema>;
export type Fact = z.infer<typeof FactProposalSchema> & {id:string; sourceTurnId:string; gameDate:GameDate;createdAt:string;version:number;propagation:string[]};
export type Knowledge = {id:string;npcId:NpcId;factId:string;sourceTurnId:string;path:string;evidence:Evidence};
export type Memory = {id:string;factId:string;sourceTurnId:string;kind:string;content:string;importance:number};
export type Summary = {id:string;sourceTurnIds:string[];cutoffTurnId:string;content:string;version:number};
export type Effects = {facts:Fact[];knowledge:Knowledge[];memories:Memory[];summaries:Summary[];suggestedActions:string[];diagnostics:string[];characters?:Character[];characterEvents?:CharacterEvent[]};
export type Turn = {id:string;saveId:string;parentTurnId:string|null;branchId:string;playerText:string;body:string;createdAt:string;state:State;effects:Effects;provider:ProviderId;model:string;requestId:string;usage:{input:number;output:number};requestCount:number;kind?:'story'|'configuration';memorySource?:'local-review';scenarioSnapshotHash?:string;characterNames?:Record<string,string>;playerName?:string};
export type Branch = {id:string;saveId:string;name:string;parentBranchId:string|null;forkTurnId:string|null;headTurnId:string};
export type Save = {id:string;title:string;createdAt:string;currentBranchId:string;initialConfig:NewGameConfig;canonVersion:string;scenarioPackageId:string;scenarioVersion:string;scenarioSnapshotHash:string;openingStatus?:'pending'|'ready'};
export const NewGameSchema=z.object({title:z.string().trim().min(1).max(80).default('新故事'),scenarioPackageId:z.string().max(80).optional(),scenarioVersion:z.string().max(30).optional(),worldStats:z.record(z.string().max(80),z.number().finite()).optional(),startDate:z.object({year:z.number().int().min(1),month:z.number().int().min(1),day:z.number().int().min(1),minuteOfDay:z.number().int().min(0).max(1439)}).strict().optional(),playerSetup:z.object({name:z.string().trim().min(1).max(100).optional(),description:z.string().max(100000).optional(),choiceId:z.string().max(80).optional()}).strict().optional()}).strict();
export type NewGameConfig = z.infer<typeof NewGameSchema>;
export type Capability = 'supported'|'unsupported'|'unknown';
export type Capabilities = {systemInstruction:Capability;streaming:Capability;jsonObject:Capability;jsonSchema:Capability;thinkingControl:Capability;acceptedParameters:string[];source:'official-docs'|'probe'|'manual';checkedAt:string};
export const ProfileSchema = z.object({
  id:z.string().min(1).max(80),label:z.string().min(1).max(80),provider:ProviderIdSchema,
  model:z.string().max(150).regex(/^[a-zA-Z0-9_./:-]*$/),
  timeoutMs:z.number().int().min(5000).max(300000).default(90000),
  connectTimeoutMs:z.number().int().min(1000).max(60000).default(15000),
  firstTextTimeoutMs:z.number().int().min(1000).max(180000).default(60000),
  maxOutputTokens:z.number().int().min(256).max(16000).default(4096),
  length:z.enum(['short','normal','long']).default('normal'),
}).strict();
export type Profile = z.infer<typeof ProfileSchema>;
export type Draft = {
  id:string;saveId:string;branchId:string;expectedHeadTurnId:string;playerText:string;target:NpcId|null;mode:'story'|'ooc';
  body:string;status:'generating'|'extracting'|'validating'|'failed'|'cancelled'|'committed';error:string|null;createdAt:string;
  profile:Profile;extractProfile:Profile;turnId:string|null;requestCount:number;extraction:Extraction|null;usage:{input:number;output:number};
  bodyComplete?:boolean;bodyFinishReason?:string;failureStage?:'generation'|'extraction'|'validation';failureCode?:string;
  stageStartedAt?:string;updatedAt?:string;
  // Public response only: permits a version-checked local save without exposing extraction secrets.
  localSaveRevision?:string;
  bodyRepair?:{originalBody:string;originalProfile:Profile;candidateBody?:string;startedAt:string;phase:'generating'|'received'|'failed'};
};
export const SuggestedActionsSchema=z.object({actions:z.array(z.string().trim().min(1).max(160)).min(3).max(4)}).strict();
export type SuggestedActions={actions:string[];provider:ProviderId;model:string;headTurnId:string;draftId:string|null;requestCount:number};
export const TurnInputSchema = z.object({
  clientRequestId:z.string().uuid(),saveId:z.string().uuid(),branchId:z.string().uuid(),expectedHeadTurnId:z.string().uuid(),
  playerText:z.string().trim().min(1).max(6000),target:NpcIdSchema.nullable().default(null),mode:z.enum(['story','ooc']).default('story'),
}).strict();
export type TurnInput = z.infer<typeof TurnInputSchema>;
export type Bookmark = {id:string;turnId:string;note:string};
export type Annotation = {id:string;branchId:string;sourceTurnId:string;factId:string;kind:'pin'|'error'|'note';text:string;createdAt:string};
export type OocMessage = {id:string;branchId:string;atTurnId:string;playerText:string;body:string;createdAt:string};
export type View = {save:Save;branches:Branch[];branch:Branch;turns:Turn[];drafts:Draft[];bookmarks:Bookmark[];annotations:Annotation[];ooc:OocMessage[];characters?:CharacterView[];scenario:PublicScenario};
