import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../src/core/config.js';
import { StorageRepository } from '../src/core/storage.js';
import type { PulseDeckConfig } from '../src/core/types.js';
import { createPulseDeckServer } from '../src/server/app.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('PulseDeck HTTP API', () => {
  it('serves health, metrics, rules, and snapshots endpoints', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsedeck-api-'));
    tempDirs.push(dir);

    const config: PulseDeckConfig = {
      dataDir: dir,
      dbPath: path.join(dir, 'api.db'),
      host: '127.0.0.1',
      port: 0,
      retentionHours: 24,
      rules: DEFAULT_RULES,
    };

    const storage = new StorageRepository(config.dbPath);
    const app = await createPulseDeckServer(config, storage, path.join(dir, 'nonexistent-web'));

    try {
      const healthRes = await app.inject({ method: 'GET', url: '/api/health' });
      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json()).toMatchObject({ status: 'ok', service: 'pulsedeck' });

      const rulesRes = await app.inject({ method: 'GET', url: '/api/rules' });
      expect(rulesRes.statusCode).toBe(200);
      expect(Array.isArray(rulesRes.json().evaluations)).toBe(true);
    } finally {
      await app.close();
      storage.close();
    }
  });
});