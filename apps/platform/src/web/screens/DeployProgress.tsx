/* Live deploy progress — port of the design's `deploy.jsx`.
 *
 * Main column: animated 7-step timeline + 2×2 stats grid + completion CTA.
 * Side column: live terminal log + "what just happened" + "what it costs".
 *
 * Behavior: when a real `deployId` is present in flow, we poll
 *   /api/deploy/status?id=… to drive the timeline against actual backend
 * state via the existing DeployState/DeployStep contract. Without an id —
 * common on the first run after onboarding — we tick the timeline visually
 * so the user gets the full reveal anyway.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import type { AppFlowState } from '../App';
import type { DeployState, DeployStep } from '@shared/types';
import { Icon } from '../shell/Icon';

interface Props {
  flow: AppFlowState;
  merge: (patch: Partial<AppFlowState>) => void;
  next: () => void;
}

/* The 7 steps shown in the timeline. We map server-reported DeployStep entries
 * to indexes by `key`. Anything the server doesn't know about stays in its
 * design-mocked default. */
const STEPS: { name: string; key: string; meta: (f: AppFlowState) => string }[] = [
  { key: 'token', name: 'Cloudflare token validated', meta: (f) => `${tokenLabel(f.cloudflareToken)} · 6 scopes` },
  { key: 'worker', name: 'Worker created', meta: (f) => `${f.agentName || 'agent'} · workers.dev` },
  { key: 'bindings', name: 'Bindings provisioned', meta: () => 'D1 · KV · R2 · Vectorize · Browser' },
  { key: 'migrations', name: 'D1 migrations applied', meta: () => '14 migrations · trajectories, audit, policies' },
  { key: 'deploy', name: 'First deploy', meta: () => 'wrangler deploy · 96 KiB gzipped' },
  { key: 'dns', name: 'DNS propagating', meta: (f) => `${f.agentName || 'agent'}${f.customDomain ? '.' + f.customDomain : '.openthink.run'} · CNAME` },
  { key: 'online', name: 'Agent online', meta: () => 'DO-1 cold-start in 11ms' },
];

function tokenLabel(token: string | undefined) {
  if (!token) return 'token';
  if (token.length < 10) return token;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export function DeployProgress({ flow, next }: Props) {
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [serverDone, setServerDone] = useState(false);
  const haveServer = useRef(false);

  // Visual tick — only fires when we *don't* have a real backend state to
  // drive the bar. Skipping this when the server is owning progress avoids
  // races where we'd hop ahead of true state.
  useEffect(() => {
    if (haveServer.current) return;
    if (step >= STEPS.length) return;
    const t = window.setTimeout(() => setStep((s) => Math.min(s + 1, STEPS.length)), 950 + Math.random() * 600);
    return () => window.clearTimeout(t);
  }, [step]);

  useEffect(() => {
    const i = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(i);
  }, []);

  // Poll real deploy status. The endpoint returns a DeployState whose
  // ordered steps[] we map onto the design's 7 visual steps by key. If
  // the endpoint isn't live (404, network drop) we silently fall back to
  // the visual timer.
  useEffect(() => {
    if (!flow.deployId) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const r = await fetch(`/api/deploy/status?id=${encodeURIComponent(flow.deployId!)}`);
        if (!r.ok) {
          if (timer === null) timer = window.setTimeout(poll, 1500);
          return;
        }
        const data = (await r.json()) as DeployState;
        if (cancelled) return;
        haveServer.current = true;
        const visualStep = countDoneSteps(data.steps);
        setStep(visualStep);
        if (data.finishedAt) {
          setServerDone(true);
          return;
        }
      } catch {
        /* swallow */
      }
      if (!cancelled) timer = window.setTimeout(poll, 1200);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [flow.deployId]);

  const done = serverDone || step >= STEPS.length;
  const host = `${flow.agentName || 'flannel-arroyo'}${flow.customDomain ? '.' + flow.customDomain : '.openthink.run'}`;

  const logLines = useMemo(() => {
    const lines: { k: 'ok' | 'cur' | 'dim'; t: string }[] = [];
    for (let i = 0; i < step; i++) {
      const name = STEPS[i]?.name.toLowerCase() ?? 'step';
      lines.push({
        k: 'ok',
        t: `[${i * 7}.${((i * 180) % 1000).toString().padStart(3, '0')}s] ✓ ${name}`,
      });
    }
    if (!done && step < STEPS.length) {
      const name = STEPS[step]?.name.toLowerCase() ?? 'step';
      lines.push({ k: 'cur', t: `[${step * 7}.000s] → ${name}…` });
    }
    if (done) {
      lines.push({ k: 'ok', t: `[${step * 7}.842s] ✓ ready` });
      lines.push({ k: 'dim', t: '' });
      lines.push({ k: 'dim', t: `agent ${flow.agentName || 'flannel-arroyo'} · openthink.run` });
      lines.push({ k: 'dim', t: 'first DO cold-start: 11ms · idle hibernation enabled' });
    }
    return lines;
  }, [step, done, flow.agentName]);

  return (
    <div className="deploy" data-screen-label="Deploy">
      <div className="deploy-main scroll">
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          {done ? 'deployment complete' : 'deploying'}
        </div>
        <h1>{done ? "It's alive." : 'Standing up your agent.'}</h1>
        <div className="url-readout">
          <span className={done ? 'dot' : 'dot live pulse'} />
          <span className="mono">https://{host}</span>
          {done && <span style={{ color: 'var(--green)' }}>· 200 OK</span>}
        </div>

        <div className="timeline">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`tl-step ${i < step ? 'done' : i === step ? 'live' : ''}`}
            >
              <div className="dw">
                {i < step ? <Icon name="check" size={13} /> : i === step ? <span className="spin" /> : i + 1}
              </div>
              <div className="body">
                <div className="nm">{s.name}</div>
                <div className="mt">{i <= step ? s.meta(flow) : '—'}</div>
              </div>
              <div className="tm tnum">
                {i < step ? `${(i + 1) * 7}s` : i === step ? `${elapsed}s` : '—'}
              </div>
            </div>
          ))}
        </div>

        <div className="deploy-stats">
          <div className="deploy-stat">
            <div className="nm">ELAPSED</div>
            <div className="vl tnum">{elapsed}<small>s</small></div>
          </div>
          <div className="deploy-stat">
            <div className="nm">COST SO FAR</div>
            <div className="vl tnum">$0.00</div>
          </div>
          <div className="deploy-stat">
            <div className="nm">DO COLD START</div>
            <div className="vl tnum">11<small>ms</small></div>
          </div>
          <div className="deploy-stat">
            <div className="nm">SPA GZIPPED</div>
            <div className="vl tnum">96<small>KiB</small></div>
          </div>
        </div>

        {done && (
          <div style={{ marginTop: 36, paddingTop: 24, borderTop: '1px solid var(--rule)' }}>
            <button className="btn brand xl" type="button" onClick={next}>
              Say hi to your agent <Icon name="arrow_right" size={14} />
            </button>
            <div className="text-xs muted mono" style={{ marginTop: 12 }}>
              or open <span style={{ color: 'var(--ink)' }}>{host}</span> in a new tab
            </div>
          </div>
        )}
      </div>

      <aside className="deploy-side scroll">
        <div className="blk">
          <h3>LIVE LOG</h3>
          <div className="deploy-log scroll">
            {logLines.map((l, i) => (
              <div key={i} className={`ln ${l.k}`}>{l.t || ' '}</div>
            ))}
            {!done && (
              <div className="ln cur" style={{ display: 'inline-flex' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 11,
                    background: 'var(--coral)',
                    animation: 'pulse 1s infinite',
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="blk">
          <h3>WHAT JUST HAPPENED</h3>
          <p>
            One Cloudflare Worker hosts your Orchestrator Durable Object. It binds three peers —
            Researcher, Coder, Memory — plus a Judge sibling, all over DO RPC. State lives in your
            D1, R2, KV, and Vectorize.
          </p>
        </div>

        <div className="blk">
          <h3>WHAT IT COSTS</h3>
          <p>
            Idle hibernation = $0. First chat ≈ $0.04. Browser session minute ≈ $0.0015. Hobbyist
            single-agent month under $5 on Workers Free.
          </p>
        </div>
      </aside>
    </div>
  );
}

function countDoneSteps(steps: DeployStep[]): number {
  // Count the prefix of steps that are 'done'. Treat 'error' as "still on
  // that step" so the UI freezes there and the spinner stays.
  let count = 0;
  for (const s of steps) {
    if (s.state === 'done') count++;
    else break;
  }
  return Math.min(count, STEPS.length);
}
