#!/usr/bin/env node
import { Command } from 'commander';
import { collectTelemetrySample } from '../core/collector.js';
import { loadConfig } from '../core/config.js';
import { applyRuleOverrides, evaluateRules, hasBreachedRules } from '../core/rules.js';
import {
  captureAndStoreSnapshot,
  computeSnapshotDiff,
  formatSnapshotDiffMarkdown,
} from '../core/snapshot.js';
import { StorageRepository } from '../core/storage.js';
import { createPulseDeckServer } from '../server/app.js';

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

async function runCli(): Promise<void> {
  const program = new Command();

  program
    .name('pulsedeck')
    .description('Local-first system & service telemetry inspector')
    .version('0.1.0')
    .option('--data-dir <path>', 'Custom local data directory');

  program
    .command('status')
    .description('Collect and display current host telemetry')
    .option('--json', 'Output raw JSON')
    .action(async (opts: { json?: boolean }) => {
      const globalOpts = program.opts<{ dataDir?: string }>();
      const config = loadConfig(globalOpts.dataDir);
      const storage = new StorageRepository(config.dbPath);

      try {
        const sample = await collectTelemetrySample(true);
        storage.saveSample(sample);
        storage.pruneOldSamples(config.retentionHours);

        if (opts.json) {
          console.log(JSON.stringify(sample, null, 2));
          return;
        }

        console.log(`Host: ${sample.hostname} (${sample.platform}/${sample.arch})`);
        console.log(`Uptime: ${sample.uptimeSeconds}s | Timestamp: ${sample.timestamp}`);
        console.log(
          `CPU: ${sample.cpu.usagePercent}% (${sample.cpu.coreCount} cores, load ${sample.cpu.loadAvg.join(', ')})`,
        );
        console.log(
          `Memory: ${sample.memory.usedPercent}% (${formatBytes(sample.memory.usedBytes)} / ${formatBytes(sample.memory.totalBytes)})`,
        );
        if (sample.processes.length > 0) {
          console.log('Top Processes (by memory):');
          for (const proc of sample.processes.slice(0, 5)) {
            console.log(`  - PID ${proc.pid}: ${proc.name} (${formatBytes(proc.memoryBytes ?? 0)})`);
          }
        }
      } finally {
        storage.close();
      }
    });

  program
    .command('watch')
    .description('Continuously sample and display host telemetry')
    .option('--interval <seconds>', 'Sampling interval in seconds', (v) => Number(v), 2)
    .option('--count <number>', 'Stop after N samples (default: run until Ctrl+C)', (v) => Number(v))
    .option('--json', 'Emit each sample as a single JSON line')
    .action(async (opts: { interval: number; count?: number; json?: boolean }) => {
      const globalOpts = program.opts<{ dataDir?: string }>();
      const config = loadConfig(globalOpts.dataDir);
      const storage = new StorageRepository(config.dbPath);

      const intervalMs =
        Number.isFinite(opts.interval) && opts.interval >= 0.5 ? opts.interval * 1000 : 2000;
      const maxSamples =
        typeof opts.count === 'number' && Number.isInteger(opts.count) && opts.count > 0
          ? opts.count
          : Infinity;

      let iterations = 0;
      let stopped = false;

      const onSignal = () => {
        stopped = true;
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);

      try {
        while (!stopped && iterations < maxSamples) {
          const sample = await collectTelemetrySample(false);
          storage.saveSample(sample);
          storage.pruneOldSamples(config.retentionHours);
          iterations += 1;

          if (opts.json) {
            console.log(JSON.stringify(sample));
          } else {
            console.log(
              `[${sample.timestamp}] CPU: ${sample.cpu.usagePercent}% | Mem: ${sample.memory.usedPercent}% (${formatBytes(sample.memory.usedBytes)} / ${formatBytes(sample.memory.totalBytes)})`,
            );
          }

          if (stopped || iterations >= maxSamples) {
            break;
          }

          await new Promise<void>((resolve) => {
            setTimeout(resolve, intervalMs);
          });
        }
      } finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        storage.close();
      }
    });

  const snapshotCmd = program.command('snapshot').description('Manage point-in-time telemetry snapshots');

  snapshotCmd
    .command('create <name>')
    .description('Capture a named telemetry snapshot')
    .option('--notes <text>', 'Optional note for this snapshot')
    .option('--json', 'Output JSON')
    .action(async (name: string, opts: { notes?: string; json?: boolean }) => {
      const globalOpts = program.opts<{ dataDir?: string }>();
      const config = loadConfig(globalOpts.dataDir);
      const storage = new StorageRepository(config.dbPath);

      try {
        const sample = await collectTelemetrySample(true);
        storage.saveSample(sample);
        const snap = captureAndStoreSnapshot(storage, name, sample, opts.notes);

        if (opts.json) {
          console.log(JSON.stringify(snap, null, 2));
          return;
        }
        console.log(`Snapshot "${snap.name}" saved at ${snap.createdAt}`);
      } finally {
        storage.close();
      }
    });

  snapshotCmd
    .command('list')
    .description('List saved snapshots')
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      const globalOpts = program.opts<{ dataDir?: string }>();
      const config = loadConfig(globalOpts.dataDir);
      const storage = new StorageRepository(config.dbPath);

      try {
        const snapshots = storage.listSnapshots();
        if (opts.json) {
          console.log(JSON.stringify(snapshots, null, 2));
          return;
        }
        if (snapshots.length === 0) {
          console.log('No snapshots found.');
          return;
        }
        for (const s of snapshots) {
          console.log(
            `- ${s.name} (${s.createdAt}) | CPU: ${s.sample.cpu.usagePercent}% | Mem: ${s.sample.memory.usedPercent}%`,
          );
        }
      } finally {
        storage.close();
      }
    });

  snapshotCmd
    .command('delete <name>')
    .description('Delete a saved snapshot by name')
    .option('--json', 'Output JSON')
    .action((name: string, opts: { json?: boolean }) => {
      const globalOpts = program.opts<{ dataDir?: string }>();
      const config = loadConfig(globalOpts.dataDir);
      const storage = new StorageRepository(config.dbPath);

      try {
        const trimmed = name.trim();
        const deleted = storage.deleteSnapshotByName(trimmed);
        if (!deleted) {
          throw new Error(`Snapshot "${trimmed}" not found.`);
        }

        if (opts.json) {
          console.log(JSON.stringify({ deleted: true, name: trimmed }, null, 2));
          return;
        }
        console.log(`Snapshot "${trimmed}" deleted.`);
      } finally {
        storage.close();
      }
    });

  snapshotCmd
    .command('diff <base> <target>')
    .description('Compare two saved snapshots')
    .option('--format <mode>', 'Output format: text, json, or markdown', 'text')
    .option('--json', 'Output raw JSON (shorthand for --format json)')
    .action(
      async (baseName: string, targetName: string, opts: { format?: string; json?: boolean }) => {
        const globalOpts = program.opts<{ dataDir?: string }>();
        const config = loadConfig(globalOpts.dataDir);
        const storage = new StorageRepository(config.dbPath);

        try {
          const base = storage.getSnapshotByName(baseName);
          const target = storage.getSnapshotByName(targetName);
          if (!base) {
            throw new Error(`Snapshot "${baseName}" not found.`);
          }
          if (!target) {
            throw new Error(`Snapshot "${targetName}" not found.`);
          }

          const diff = computeSnapshotDiff(base, target);
          const mode = opts.json ? 'json' : (opts.format ?? 'text').toLowerCase();

          if (mode === 'json') {
            console.log(JSON.stringify(diff, null, 2));
            return;
          }
          if (mode === 'markdown' || mode === 'md') {
            console.log(formatSnapshotDiffMarkdown(diff));
            return;
          }
          if (mode !== 'text') {
            throw new Error(`Unsupported diff format "${opts.format}". Use text, json, or markdown.`);
          }

          console.log(`Diff: ${diff.baseName} -> ${diff.targetName}`);
          console.log(
            `  CPU Delta: ${diff.cpuUsageDeltaPercent >= 0 ? '+' : ''}${diff.cpuUsageDeltaPercent}%`,
          );
          console.log(
            `  Memory % Delta: ${diff.memoryUsedPercentDelta >= 0 ? '+' : ''}${diff.memoryUsedPercentDelta}% (${diff.memoryUsedBytesDelta >= 0 ? '+' : ''}${formatBytes(diff.memoryUsedBytesDelta)})`,
          );
          console.log(
            `  Uptime Delta: ${diff.uptimeDeltaSeconds >= 0 ? '+' : ''}${diff.uptimeDeltaSeconds}s`,
          );
        } finally {
          storage.close();
        }
      },
    );
  
  snapshotCmd
    .command('show <name>')
    .description('Display full details of a saved snapshot')
    .option('--json', 'Output JSON')
    .action((name: string, opts: { json?: boolean }) => {
      const globalOpts = program.opts<{ dataDir?: string }>();
      const config = loadConfig(globalOpts.dataDir);
      const storage = new StorageRepository(config.dbPath);

      try {
        const trimmed = name.trim();
        const snap = storage.getSnapshotByName(trimmed);
        if (!snap) {
          throw new Error(`Snapshot "${trimmed}" not found.`);
        }

        if (opts.json) {
          console.log(JSON.stringify(snap, null, 2));
          return;
        }

        console.log(`Snapshot: ${snap.name}`);
        console.log(`Created:  ${snap.createdAt}`);
        if (snap.notes) {
          console.log(`Notes:    ${snap.notes}`);
        }
        console.log(
          `Host:     ${snap.sample.hostname} (${snap.sample.platform}/${snap.sample.arch})`,
        );
        console.log(`Uptime:   ${snap.sample.uptimeSeconds}s`);
        console.log(
          `CPU:      ${snap.sample.cpu.usagePercent}% (${snap.sample.cpu.coreCount} cores, load ${snap.sample.cpu.loadAvg.join(', ')})`,
        );
        console.log(
          `Memory:   ${snap.sample.memory.usedPercent}% (${formatBytes(snap.sample.memory.usedBytes)} / ${formatBytes(snap.sample.memory.totalBytes)})`,
        );
        if (snap.sample.processes.length > 0) {
          console.log('Top Processes (by memory):');
          for (const proc of snap.sample.processes.slice(0, 5)) {
            console.log(`  - PID ${proc.pid}: ${proc.name} (${formatBytes(proc.memoryBytes ?? 0)})`);
          }
        }
      } finally {
        storage.close();
      }
    });
    
  const rulesCmd = program.command('rules').description('Evaluate threshold rules');

  rulesCmd
    .command('check')
    .description('Evaluate configured threshold rules against current telemetry')
    .option('--warn <number>', 'Override warning threshold (0-100)', (v) => Number(v))
    .option('--critical <number>', 'Override critical threshold (0-100)', (v) => Number(v))
    .option('--json', 'Output JSON')
    .action(async (opts: { warn?: number; critical?: number; json?: boolean }) => {
      const globalOpts = program.opts<{ dataDir?: string }>();
      const config = loadConfig(globalOpts.dataDir);
      const storage = new StorageRepository(config.dbPath);

      try {
        const activeRules = applyRuleOverrides(config.rules, {
          ...(opts.warn !== undefined ? { warn: opts.warn } : {}),
          ...(opts.critical !== undefined ? { critical: opts.critical } : {}),
        });
        const sample = await collectTelemetrySample(false);
        storage.saveSample(sample);
        const evaluations = evaluateRules(activeRules, sample);
        const breached = hasBreachedRules(evaluations);

        if (opts.json) {
          console.log(JSON.stringify({ breached, evaluations }, null, 2));
        } else {
          for (const ev of evaluations) {
            console.log(`[${ev.status.toUpperCase()}] ${ev.message}`);
          }
        }

        if (breached) {
          process.exitCode = 2;
        }
      } finally {
        storage.close();
      }
    });

  program
    .command('serve')
    .description('Start the local HTTP API and web dashboard')
    .option('--port <number>', 'Port number', (v) => Number(v))
    .action(async (opts: { port?: number }) => {
      const globalOpts = program.opts<{ dataDir?: string }>();
      const config = loadConfig(globalOpts.dataDir);
      const port = opts.port && Number.isInteger(opts.port) ? opts.port : config.port;
      const storage = new StorageRepository(config.dbPath);
      const server = await createPulseDeckServer({ ...config, port }, storage);

      const address = await server.listen({ host: config.host, port });
      console.log(`PulseDeck server listening on ${address}`);

      const shutdown = async () => {
        await server.close();
        storage.close();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });

  await program.parseAsync(process.argv);
}

runCli().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});