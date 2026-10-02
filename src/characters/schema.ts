import { z } from 'zod';
import { CharacterIdSchema, CharacterRefSchema, PersonRefSchema, SeedIdSchema, EvidenceSchema } from '../domain/identity';

const text = z.string().trim().min(1).max(300);
const ref = z.string().min(1).max(80);
const visibility = {revealed:z.boolean(), knownBy:z.array(PersonRefSchema).max(64), evidence:EvidenceSchema};
export const CertaintySchema = z.enum(['confirmed','claim','rumor','suspicion']);
export const CharacterFieldSchema = z.enum(['name','alias','identity','background','personality','motivation','faction','location','condition','lifeStatus','availability','age']);
export const CreationSchema = z.object({
  draftRef:z.string().regex(/^new:[a-zA-Z0-9_-]{1,48}$/), name:text.nullable(), referenceName:text,
  identity:text, identityStatus:CertaintySchema, roleInStory:text, motivation:text.nullable(),
  relevance:z.enum(['recurring','supporting','incidental']), presence:z.enum(['mentioned','present','elsewhere','hidden']),
  location:text.nullable(), ...visibility,
}).strict();
export const CharacterChangeSchema = z.object({
  ref, characterId:CharacterRefSchema, field:CharacterFieldSchema, value:text,
  operation:z.enum(['set','add','remove']), certainty:CertaintySchema,
  actorId:PersonRefSchema.nullable(), reason:text, ...visibility,
  authorization:z.object({sourceTurnId:z.uuid().nullable(),evidence:EvidenceSchema}).strict().nullable().optional(),
}).strict();
export const RoleTypeSchema=z.enum(['office','job','rank','title','organization_role','temporary_role']);
export const OfficeKindSchema = z.enum(['substantive','concurrent','acting','commission','honorary']);
export const OfficeStageSchema = z.enum(['proposed','ordered','active','arrived','ended']);
export const AuthorizationSchema = z.object({sourceTurnId:z.uuid().nullable(),evidence:EvidenceSchema}).strict();
export const OfficeChangeSchema = z.object({
  ref, characterId:CharacterRefSchema, assignmentRef:ref, title:text, organization:text,
  assignmentKind:OfficeKindSchema,roleType:RoleTypeSchema.optional(), stage:OfficeStageSchema, authorityScope:z.array(text).max(12),
  actorId:PersonRefSchema, reason:text, authorization:AuthorizationSchema.nullable(),
  authorityEventId:z.uuid().nullable(), ...visibility,
}).strict();
export const RelationshipChangeSchema = z.object({
  ref, fromCharacterId:PersonRefSchema, toCharacterId:PersonRefSchema,
  relationshipRef:ref, category:z.enum(['objective','attitude']),
  relationshipType:z.enum(['superior','subordinate','family','ally','rival','creditor','debtor','acquaintance','other']),
  description:text, operation:z.enum(['establish','end']), ...visibility,
}).strict();
export const CharacterKnowledgeChangeSchema = z.object({
  ref, knowerId:PersonRefSchema, aboutCharacterId:CharacterRefSchema, informationEventRef:ref,
  certainty:z.enum(['known','believed','suspected']), path:z.enum(['witness','told','letter','investigation','self']),
  ...visibility,
}).strict();
export const MentionSchema = z.object({ref,label:text,candidates:z.array(CharacterRefSchema).max(8),...visibility}).strict();
export const dynamicProposalFields = {
  proposedCharacterCreations:z.array(CreationSchema).max(16).optional(),
  proposedCharacterChanges:z.array(CharacterChangeSchema).max(32).optional(),
  proposedOfficeChanges:z.array(OfficeChangeSchema).max(24).optional(),
  proposedRelationshipChanges:z.array(RelationshipChangeSchema).max(24).optional(),
  proposedKnowledgeChanges:z.array(CharacterKnowledgeChangeSchema).max(48).optional(),
  unresolvedMentions:z.array(MentionSchema).max(16).optional(),
};
export const CharacterSchema = z.object({
  id:CharacterIdSchema,saveId:z.uuid(),seedKey:SeedIdSchema.nullable(),createdByEventId:z.uuid(),
  createdAtTurnId:z.uuid(),schemaVersion:z.literal(1),
}).strict();
export type Character = z.infer<typeof CharacterSchema>;
export const ProfileDataSchema = CreationSchema.omit({draftRef:true,evidence:true,knownBy:true,revealed:true}).extend({
  romancePolicy:z.enum(['disabled','available']),age:z.number().int().min(0).max(150).nullable(),legacy:z.boolean(),
}).strict();
export const OfficeAssignmentSchema = z.object({
  id:z.uuid(),characterId:CharacterIdSchema,title:text,organization:text,assignmentKind:OfficeKindSchema,roleType:RoleTypeSchema.optional(),
  stage:OfficeStageSchema,authorityScope:z.array(text).max(12),sourceEventId:z.uuid(),
  validFromEventId:z.uuid().nullable(),validUntilEventId:z.uuid().nullable(),arrivedByEventId:z.uuid().nullable(),
}).strict();
export const CharacterRelationSchema = z.object({
  id:z.uuid(),fromCharacterId:PersonRefSchema,toCharacterId:PersonRefSchema,category:z.enum(['objective','attitude']),
  relationshipType:RelationshipChangeSchema.shape.relationshipType,description:text,
  establishedByEventId:z.uuid(),endedByEventId:z.uuid().nullable(),
}).strict();
const eventBase=z.object({
  id:z.uuid(),saveId:z.uuid(),branchId:z.uuid(),sourceTurnId:z.uuid(),characterId:CharacterIdSchema,
  actorId:PersonRefSchema.nullable(),before:z.record(z.string(),z.unknown()).nullable(),
  gameTime:z.object({year:z.number().int(),month:z.number().int(),day:z.number().int(),minuteOfDay:z.number().int()}).strict(),
  recordedAt:z.iso.datetime(),revealed:z.boolean(),knownBy:z.array(PersonRefSchema).max(64),
  evidence:EvidenceSchema,sourceKind:z.enum(['story','canon','legacy','configuration']),
});
export const CharacterEventSchema=z.discriminatedUnion('kind',[
  eventBase.extend({kind:z.literal('created'),data:ProfileDataSchema}).strict(),
  eventBase.extend({kind:z.literal('profile'),data:CharacterChangeSchema.pick({field:true,value:true,operation:true,certainty:true,reason:true})}).strict(),
  eventBase.extend({kind:z.literal('office'),data:OfficeAssignmentSchema}).strict(),
  eventBase.extend({kind:z.literal('relationship'),data:CharacterRelationSchema}).strict(),
  eventBase.extend({kind:z.literal('knowledge'),data:z.object({knowerId:PersonRefSchema,informationEventId:z.uuid(),certainty:CharacterKnowledgeChangeSchema.shape.certainty,path:CharacterKnowledgeChangeSchema.shape.path}).strict()}).strict(),
  eventBase.extend({kind:z.literal('mention'),data:z.object({label:text,candidates:z.array(CharacterIdSchema).max(8)}).strict()}).strict(),
  eventBase.extend({kind:z.literal('policy'),data:z.object({romancePolicy:z.enum(['disabled','available']),relevance:z.enum(['recurring','supporting','incidental']).optional(),relationshipEnabled:z.boolean().optional()}).strict()}).strict(),
]);
export type CharacterEvent=z.infer<typeof CharacterEventSchema>;
export type RoleAssignment=z.infer<typeof OfficeAssignmentSchema>;
export type OfficeAssignment=z.infer<typeof OfficeAssignmentSchema>;
export type CharacterRelation=z.infer<typeof CharacterRelationSchema>;
export type CharacterNote={field:string;value:string;certainty:z.infer<typeof CertaintySchema>;sourceEventId:string;sourceTurnId:string};
export type CharacterView={
  id:string;seedKey:string|null;name:string;canonicalName:string|null;aliases:string[];identity:string;roleInStory:string;
  relevance:'recurring'|'supporting'|'incidental';visibility:'mentioned'|'known'|'hidden';
  availability:'present'|'elsewhere'|'unreachable'|'departed';lifeStatus:'alive'|'deceased'|'unknown';
  location:string|null;locationId?:string|null;age:number|null;romancePolicy:'disabled'|'available';factions:string[];factionIds?:string[];conditions:string[];
  firstMentionTurnId:string;firstAppearanceTurnId:string|null;lastInteractionTurnId:string;
  notes:CharacterNote[];offices:OfficeAssignment[];relations:CharacterRelation[];stats?:Record<string,number>;
  timeline:CharacterEvent[];pendingThreads:string[];legacy:boolean;possibleDuplicates:string[];
};
export const CharacterCorrectionSchema=z.object({id:z.uuid(),saveId:z.uuid(),branchId:z.uuid(),sourceTurnId:z.uuid(),recordedAtTurnId:z.uuid(),characterId:CharacterIdSchema,
  category:z.enum(['identity','office','knowledge','history']),note:z.string().trim().min(1).max(600),createdAt:z.iso.datetime(),resultBranchId:z.uuid().nullable()}).strict();
export type CharacterCorrection=z.infer<typeof CharacterCorrectionSchema>;
export type CharacterBook={saveId:string;branchId:string;atTurnId:string;characters:CharacterView[];unresolvedMentions:{label:string;candidates:string[];sourceTurnId:string}[];followed:string[];groups?:Record<string,string>;corrections:CharacterCorrection[];contextLimit:number};
