# Threshold Rules Guide

PulseDeck evaluates threshold rules against telemetry samples to detect elevated CPU or memory usage.

## Supported Metrics & Operators
- **Metrics:** `cpu.usagePercent`, `memory.usedPercent`
- **Operators:** `gt` (`>`), `gte` (`>=`), `lt` (`<`), `lte` (`<=`)
- **Statuses:** `ok`, `warn`, `critical`

## Example Configuration (`~/.pulsedeck/config.json`)
```json
{
  "host": "127.0.0.1",
  "port": 4310,
  "retentionHours": 24,
  "rules": [
    {
      "id": "cpu-high",
      "name": "CPU Utilization",
      "metric": "cpu.usagePercent",
      "operator": "gte",
      "warn": 75,
      "critical": 90,
      "enabled": true
    },
    {
      "id": "mem-high",
      "name": "Memory Utilization",
      "metric": "memory.usedPercent",
      "operator": "gte",
      "warn": 80,
      "critical": 92,
      "enabled": true
    }
  ]
}