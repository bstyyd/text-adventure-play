import type { Profile, TurnInput } from '../domain/types';

export type Principal = { id: string; kind: 'player' | 'service' };
export type RecordKey = { ownerId: string; collection: string; id: string };
export type StoredRecord<T> = RecordKey & { revision: number; value: T };
export type RecordChange = RecordKey & { expectedRevision: number | null; value: unknown };

/** All checks and changes succeed together, or none are written. Missing = revision null. */
export interface StorageAdapter {
  readonly kind: 'sqlite' | 'sites-d1' | 'postgres';
  read<T>(key: RecordKey): Promise<StoredRecord<T> | null>;
  list<T>(ownerId: string, collection: string): Promise<StoredRecord<T>[]>;
  atomic(changes: RecordChange[]): Promise<void>;
}

export interface SecretProvider {
  resolve(profile: Profile): Promise<string>;
  configured(profile: Profile): Promise<boolean>;
}

export interface AuthProvider {
  requirePrincipal(request: Request, route: string): Promise<Principal>;
}

export const JOB_STATUSES = ['queued', 'building_context', 'generating_story', 'extracting_memory', 'validating', 'committing', 'completed', 'failed', 'cancelled'] as const;
export type JobStatus = typeof JOB_STATUSES[number];
export type GenerationJob = {
  jobId: string;
  clientRequestId: string;
  ownerId: string;
  saveId: string;
  branchId: string;
  expectedHeadTurnId: string;
  provider: Profile['provider'];
  model: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  input: TurnInput;
  turnId: string | null;
  error?: { code: string; message: string };
};

/** Scheduling is explicit; querying a job must never repeat an upstream request. */
export interface JobRunner {
  readonly kind: 'request-lifetime-probe' | 'database-worker';
  schedule(jobId: string, work: () => Promise<void>): void;
}

export class StorageConflict extends Error {
  constructor() { super('服务端版本已变化；保留输入，请刷新或从旧节点创建分支。'); }
}

export function validateRecordKey(key: RecordKey) {
  if (!key.ownerId || key.ownerId.length > 200 || !/^[a-z][a-z0-9_-]{0,79}$/.test(key.collection) || !key.id || key.id.length > 200) throw new Error('存储范围或记录标识无效。');
}

export function validateChanges(changes: RecordChange[]) {
  if (!changes.length || changes.length > 100) throw new Error('原子写入数量无效。');
  const keys = new Set<string>();
  for (const change of changes) {
    validateRecordKey(change);
    const key = JSON.stringify([change.ownerId, change.collection, change.id]);
    if (keys.has(key) || (change.expectedRevision !== null && (!Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 1))) throw new Error('重复记录或无效版本。');
    keys.add(key);
    if (JSON.stringify(change.value) === undefined) throw new Error('记录内容不可保存。');
  }
}
