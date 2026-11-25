import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { collectTelemetrySample } from '../core/collector.js';
import { evaluateRules } from '../core/rules.js';
import type { StorageRepository } from '../core/storage.js';
import type { PulseDeckConfig } from '../core/types.js';

export async function createPulseDeckServer(
  config: PulseDeckConfig,
  storage: StorageRepository,
  webDistDir = path.resolve(process.cwd(), 'web/dist'),
) {
  const app = Fastify({ logger: false });

  app.get('/api/health', async () => {
    return {
      status: 'ok',
      service: 'pulsedeck',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/api/metrics/latest', async () => {
    const latest = storage.getLatestSample() ?? (await collectTelemetrySample(true));
    return { sample: latest };
  });

  app.get('/api/metrics/history', async (request) => {
    const query = request.query as { limit?: string };
    const parsedLimit = query.limit ? Number(query.limit) : 50;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
    return { samples: storage.getRecentSamples(limit) };
  });

  app.get('/api/snapshots', async () => {
    return { snapshots: storage.listSnapshots() };
  });

  app.get('/api/rules', async () => {
    const latest = storage.getLatestSample() ?? (await collectTelemetrySample(false));
    const evaluations = evaluateRules(config.rules, latest);
    return { evaluations };
  });

  if (fs.existsSync(webDistDir)) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      prefix: '/',
    });
  } else {
    app.get('/', async (_request, reply) => {
      reply.type('text/html; charset=utf-8');
      return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PulseDeck Local Telemetry</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; background: #0f172a; color: #e2e8f0; }
      code { background: #1e293b; padding: 0.2rem 0.4rem; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>PulseDeck Local API Active</h1>
    <p>Endpoints available at <code>/api/metrics/latest</code>, <code>/api/metrics/history</code>, <code>/api/snapshots</code>, and <code>/api/rules</code>.</p>
    <p>Build the React dashboard with <code>npm run build:web</code> to serve the full UI here.</p>
  </body>
</html>`;
    });
  }

  return app;
}