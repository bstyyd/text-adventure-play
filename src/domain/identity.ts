import {z} from 'zod';
export const CharacterIdSchema=z.union([z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/),z.uuid()]);
export const SeedIdSchema=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
export type SeedId=z.infer<typeof SeedIdSchema>;
export const CharacterRefSchema=z.union([CharacterIdSchema,z.string().regex(/^new:[a-zA-Z0-9_-]{1,48}$/)]);
export const PersonRefSchema=z.union([CharacterRefSchema,z.literal('player')]);
export const EvidenceSchema=z.object({blockId:z.string().max(80),quote:z.string().min(1).max(500)}).strict();
