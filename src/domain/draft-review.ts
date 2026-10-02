import { z } from 'zod';
import { CharacterIdSchema, CharacterRefSchema, EvidenceSchema } from './identity';
import { FactProposalSchema } from './types';

// This is a deliberately small human review form, not a replacement model extractor.
export const DraftReviewSchema=z.object({
  revision:z.string().min(1).max(100),
  body:z.string().min(1).max(100000).refine(s=>s.trim().length>0,'正文不能为空'),
  confirmed:z.literal(true),
  present:z.array(CharacterRefSchema).max(64),
  sceneEvidence:EvidenceSchema,
  facts:z.array(FactProposalSchema).min(1).max(20),
  characters:z.array(z.object({
    draftRef:z.string().regex(/^new:[a-zA-Z0-9_-]{1,48}$/),
    name:z.string().trim().min(1).max(80),
    identity:z.string().trim().min(1).max(300),
    identityStatus:z.enum(['claim','confirmed']),
    roleInStory:z.string().trim().min(1).max(300),
    evidence:EvidenceSchema,
    knownBy:z.array(CharacterIdSchema).max(64),
  }).strict()).max(16),
}).strict();
export type DraftReview=z.infer<typeof DraftReviewSchema>;
export type DraftReviewContext={playerName?:string;revision:string;body:string;playerText:string;location:string;present:string[];characters:{id:string;name:string;identity:string}[]};
