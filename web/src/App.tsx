import { useEffect, useState } from 'react';

interface TelemetrySample {
  id: string;
  timestamp: string;
  hostname: string;
  platform: string;
  uptimeSeconds: number;
  cpu: { usagePercent: number; coreCount: number };
  memory: { usedPercent: number; usedBytes: number; totalBytes: number };
}

interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  actualValue: number;
  status: 'ok' | 'warn' | 'critical';
  message: string;
}

interface Snapshot {
  id: string;
  name: string;
  createdAt: string;
  sample: TelemetrySample;
}

function formatGiB(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function App() {
  const [latest, setLatest] = useState<TelemetrySample | null>(null);
  const [history, setHistory] = useState<TelemetrySample[]>([]);
  const [rules, setRules] = useState<RuleEvaluationResult[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refreshAll() {
    try {
      const [latestRes, historyRes, rulesRes, snapsRes] = await Promise.all([
        fetch('/api/metrics/latest'),
        fetch('/api/metrics/history?limit=24'),
        fetch('/api/rules'),
        fetch('/api/snapshots'),
      ]);

      if (!latestRes.ok || !historyRes.ok || !rulesRes.ok || !snapsRes.ok) {
        throw new Error('Failed to load telemetry endpoints from PulseDeck API.');
      }

      const latestData = (await latestRes.json()) as { sample: TelemetrySample };
      const historyData = (await historyRes.json()) as { samples: TelemetrySample[] };
      const rulesData = (await rulesRes.json()) as { evaluations: RuleEvaluationResult[] };
      const snapsData = (await snapsRes.json()) as { snapshots: Snapshot[] };

      setLatest(latestData.sample);
      setHistory(historyData.samples);
      setRules(rulesData.evaluations);
      setSnapshots(snapsData.snapshots);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  useEffect(() => {
    void refreshAll();
    const timer = window.setInterval(() => {
      void refreshAll();
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="container">
      <header>
        <div>
          <h1>PulseDeck</h1>
          <div className="muted">Local-first telemetry & snapshot inspector</div>
        </div>
        <div className="muted">
          {latest ? `${latest.hostname} (${latest.platform}) • Uptime ${latest.uptimeSeconds}s` : 'Connecting...'}
        </div>
      </header>

      {error && <div className="card">Error: {error}</div>}

      <div className="grid">
        <div className="card">
          <div className="card-label">CPU Utilization</div>
          <div className="card-value">{latest ? `${latest.cpu.usagePercent}%` : '--'}</div>
          <div className="muted">{latest ? `${latest.cpu.coreCount} cores` : ''}</div>
        </div>
        <div className="card">
          <div className="card-label">Memory Usage</div>
          <div className="card-value">{latest ? `${latest.memory.usedPercent}%` : '--'}</div>
          <div className="muted">
            {latest ? `${formatGiB(latest.memory.usedBytes)} / ${formatGiB(latest.memory.totalBytes)}` : ''}
          </div>
        </div>
        <div className="card">
          <div className="card-label">Saved Snapshots</div>
          <div className="card-value">{snapshots.length}</div>
          <div className="muted">Local SQLite store</div>
        </div>
      </div>

      <div className="grid section">
        <div className="card">
          <h2>Recent CPU History ({history.length} samples)</h2>
          <div className="bars" aria-label="Recent CPU utilization history">
            {history.length === 0 ? (
              <div className="muted">No samples yet. Run `pulsedeck status` or `pulsedeck watch`.</div>
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  className="bar-col"
                  title={`${item.timestamp}: ${item.cpu.usagePercent}%`}
                >
                  <div
                    className="bar"
                    style={{ height: `${Math.max(4, Math.min(100, item.cpu.usagePercent))}%` }}
                    aria-label={`CPU ${item.cpu.usagePercent}% at ${item.timestamp}`}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <h2>Recent Memory History ({history.length} samples)</h2>
          <div className="bars" aria-label="Recent memory utilization history">
            {history.length === 0 ? (
              <div className="muted">No samples yet. Run `pulsedeck status` or `pulsedeck watch`.</div>
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  className="bar-col"
                  title={`${item.timestamp}: ${item.memory.usedPercent}%`}
                >
                  <div
                    className="bar bar-memory"
                    style={{ height: `${Math.max(4, Math.min(100, item.memory.usedPercent))}%` }}
                    aria-label={`Memory ${item.memory.usedPercent}% at ${item.timestamp}`}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid section">
        <div className="card">
          <h2>Threshold Rules</h2>
          {rules.length === 0 ? (
            <div className="muted">No rules configured.</div>
          ) : (
            rules.map((r) => (
              <div key={r.ruleId} className="rule-row">
                <span>{r.message}</span>
                <span className={`badge badge-${r.status}`}>{r.status}</span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <h2>Snapshots</h2>
          {snapshots.length === 0 ? (
            <div className="muted">No snapshots captured yet.</div>
          ) : (
            snapshots.map((s) => (
              <div key={s.id} className="snap-row">
                <div>
                  <strong>{s.name}</strong>
                  <div className="muted">{s.createdAt}</div>
                </div>
                <div className="muted">
                  CPU {s.sample.cpu.usagePercent}% • Mem {s.sample.memory.usedPercent}%
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}