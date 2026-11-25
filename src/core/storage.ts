import { DatabaseSync } from 'node:sqlite';
import type { Snapshot, TelemetrySample } from './types.js';

export class StorageRepository {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS telemetry_samples (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        cpu_usage_percent REAL NOT NULL,
        memory_used_percent REAL NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_samples_timestamp
        ON telemetry_samples (timestamp);

      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        notes TEXT,
        created_at TEXT NOT NULL,
        sample_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_created_at
        ON snapshots (created_at);
    `);
  }

  saveSample(sample: TelemetrySample): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO telemetry_samples (
        id, timestamp, cpu_usage_percent, memory_used_percent, payload_json
      ) VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      sample.id,
      sample.timestamp,
      sample.cpu.usagePercent,
      sample.memory.usedPercent,
      JSON.stringify(sample),
    );
  }

  pruneOldSamples(retentionHours: number): number {
    const safeHours = Math.max(1, retentionHours);
    const cutoffIso = new Date(Date.now() - safeHours * 60 * 60 * 1000).toISOString();
    const stmt = this.db.prepare('DELETE FROM telemetry_samples WHERE timestamp < ?');
    const result = stmt.run(cutoffIso);
    return Number(result.changes ?? 0);
  }

  getLatestSample(): TelemetrySample | null {
    const stmt = this.db.prepare(
      'SELECT payload_json FROM telemetry_samples ORDER BY timestamp DESC LIMIT 1',
    );
    const row = stmt.get() as { payload_json?: string } | undefined;
    if (!row?.payload_json) {
      return null;
    }
    return JSON.parse(row.payload_json) as TelemetrySample;
  }

  getRecentSamples(limit = 50): TelemetrySample[] {
    const safeLimit = Math.max(1, Math.min(1000, limit));
    const stmt = this.db.prepare(
      'SELECT payload_json FROM telemetry_samples ORDER BY timestamp DESC LIMIT ?',
    );
    const rows = stmt.all(safeLimit) as Array<{ payload_json: string }>;
    return rows.map((r) => JSON.parse(r.payload_json) as TelemetrySample).reverse();
  }

  saveSnapshot(snapshot: Snapshot): void {
    const stmt = this.db.prepare(`
      INSERT INTO snapshots (id, name, notes, created_at, sample_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      snapshot.id,
      snapshot.name,
      snapshot.notes ?? null,
      snapshot.createdAt,
      JSON.stringify(snapshot.sample),
    );
  }

  getSnapshotByName(name: string): Snapshot | null {
    const stmt = this.db.prepare(
      'SELECT id, name, notes, created_at, sample_json FROM snapshots WHERE name = ?',
    );
    const row = stmt.get(name) as
      | {
          id: string;
          name: string;
          notes: string | null;
          created_at: string;
          sample_json: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const snapshot: Snapshot = {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      sample: JSON.parse(row.sample_json) as TelemetrySample,
    };
    if (row.notes !== null) {
      snapshot.notes = row.notes;
    }
    return snapshot;
  }

  listSnapshots(): Snapshot[] {
    const stmt = this.db.prepare(
      'SELECT id, name, notes, created_at, sample_json FROM snapshots ORDER BY created_at DESC',
    );
    const rows = stmt.all() as Array<{
      id: string;
      name: string;
      notes: string | null;
      created_at: string;
      sample_json: string;
    }>;

    return rows.map((row) => {
      const snapshot: Snapshot = {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        sample: JSON.parse(row.sample_json) as TelemetrySample,
      };
      if (row.notes !== null) {
        snapshot.notes = row.notes;
      }
      return snapshot;
    });
  }

  close(): void {
    this.db.close();
  }
}