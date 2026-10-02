import type Database from 'better-sqlite3';
import { StorageConflict, validateChanges, validateRecordKey } from './contracts';
import type { RecordChange, RecordKey, StorageAdapter, StoredRecord } from './contracts';

/** Phase 2 adapter for isolated platform records; does not migrate the existing game library. */
export class SQLiteStorageAdapter implements StorageAdapter {
  readonly kind = 'sqlite' as const;
  constructor(private db: Database.Database) {
    db.exec('CREATE TABLE IF NOT EXISTS platform_records (owner_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), payload TEXT NOT NULL, PRIMARY KEY(owner_id,collection,id))');
  }
  async read<T>(key: RecordKey): Promise<StoredRecord<T> | null> {
    validateRecordKey(key);
    const row = this.db.prepare('SELECT revision,payload FROM platform_records WHERE owner_id=? AND collection=? AND id=?').get(key.ownerId, key.collection, key.id) as { revision: number; payload: string } | undefined;
    return row ? { ...key, revision: row.revision, value: JSON.parse(row.payload) } : null;
  }
  async list<T>(ownerId: string, collection: string): Promise<StoredRecord<T>[]> {
    validateRecordKey({ownerId,collection,id:'list'});
    const rows = this.db.prepare('SELECT id,revision,payload FROM platform_records WHERE owner_id=? AND collection=? ORDER BY id').all(ownerId, collection) as { id: string; revision: number; payload: string }[];
    return rows.map(row => ({ownerId,collection,id:row.id,revision:row.revision,value:JSON.parse(row.payload)}));
  }
  async atomic(changes: RecordChange[]): Promise<void> {
    validateChanges(changes);
    this.db.transaction(() => {
      for (const c of changes) {
        const old = this.db.prepare('SELECT revision FROM platform_records WHERE owner_id=? AND collection=? AND id=?').get(c.ownerId,c.collection,c.id) as {revision:number} | undefined;
        if ((old?.revision ?? null) !== c.expectedRevision) throw new StorageConflict();
      }
      for (const c of changes) this.db.prepare('INSERT INTO platform_records VALUES (?,?,?,?,?) ON CONFLICT(owner_id,collection,id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(c.ownerId,c.collection,c.id,(c.expectedRevision ?? 0)+1,JSON.stringify(c.value));
    })();
  }
}
