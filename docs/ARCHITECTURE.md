# PulseDeck Architecture

PulseDeck is built around a modular core engine with two local interfaces (**CLI** and **Fastify HTTP API + React Web UI**) and **SQLite** storage.

## Modules
- `src/core/types.ts`: Shared TypeScript interfaces for telemetry samples, snapshots, diffs, threshold rules, and configuration.
- `src/core/config.ts`: Resolves the local data directory (`~/.pulsedeck` or `PULSEDECK_DATA_DIR`), reads/initializes `config.json`, and enforces loopback-first defaults (`127.0.0.1`).
- `src/core/collector.ts`: Collects CPU usage/cores/load, memory usage, uptime, and sanitized top processes with safe fallbacks across platforms.
- `src/core/storage.ts`: Persists rolling telemetry samples and named snapshots in SQLite (`node:sqlite`), including timestamp indexing and retention pruning.
- `src/core/snapshot.ts`: Validates snapshot names, stores snapshots, and calculates resource deltas (`computeSnapshotDiff`).
- `src/core/rules.ts`: Evaluates warning and critical thresholds deterministically and reports breach status.
- `src/server/app.ts`: Exposes local REST endpoints (`/api/health`, `/api/metrics/latest`, `/api/metrics/history`, `/api/snapshots`, `/api/rules`) and serves the built `web/dist` dashboard when available.
- `src/cli/index.ts`: Implements `status`, `watch`, `snapshot create/list/diff`, `rules check`, and `serve`.