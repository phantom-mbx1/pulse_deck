# PulseDeck

Local-first system & service telemetry inspector with point-in-time snapshots, threshold rules, and a local web dashboard—with zero cloud dependencies.

## Why PulseDeck
- **Local-First & Private:** Stores samples and snapshots in local SQLite (`~/.pulsedeck/pulsedeck.db`) and binds the HTTP API/dashboard to `127.0.0.1` by default.
- **Snapshots & Diffs:** Capture named telemetry snapshots (`baseline`, `before-load`, `after-deploy`) and compare CPU, memory, and uptime deltas.
- **Rule Checks:** Evaluate warning and critical thresholds for CI checks, scripts, or local health monitoring (`exit code 2` on breach).
- **CLI + Web UI:** Inspect current status, stream live samples with `watch`, or open the local React dashboard via `pulsedeck serve`.

## Quick Start

```bash
npm install
npm run typecheck
npm run build
npm run build:web