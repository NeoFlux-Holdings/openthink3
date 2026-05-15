import { useState } from 'react';
import './Settings.css';

interface Props {
  agentName: string;
  email: string;
}

type SettingsTab =
  | 'general'
  | 'automation'
  | 'spending'
  | 'models'
  | 'cloudflare'
  | 'access'
  | 'skills'
  | 'sync'
  | 'danger';

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'automation', label: 'Automation' },
  { id: 'spending', label: 'Spending' },
  { id: 'models', label: 'Models' },
  { id: 'cloudflare', label: 'Cloudflare' },
  { id: 'access', label: 'Access' },
  { id: 'skills', label: 'Skills' },
  { id: 'sync', label: 'Sync' },
  { id: 'danger', label: 'Danger zone' },
];

export function Settings({ agentName, email }: Props) {
  const [tab, setTab] = useState<SettingsTab>('automation');

  return (
    <div className="settings">
      <aside className="settings__nav">
        <h2>Settings</h2>
        <ul>
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                className={`settings__tab${tab === t.id ? ' settings__tab--active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="settings__main">
        {tab === 'general' && <General agentName={agentName} email={email} />}
        {tab === 'automation' && <Automation />}
        {tab === 'spending' && <Spending />}
        {tab === 'models' && <Models />}
        {tab === 'cloudflare' && <Cloudflare />}
        {tab === 'access' && <Access email={email} />}
        {tab === 'skills' && <SkillsTab />}
        {tab === 'sync' && <Sync />}
        {tab === 'danger' && <DangerZone agentName={agentName} />}
      </section>
    </div>
  );
}

function General({ agentName, email }: { agentName: string; email: string }) {
  return (
    <SettingsPane title="General" lede="Identity, language, time zone.">
      <Field label="Agent name" value={agentName} />
      <Field label="Owner email" value={email} />
      <Field label="Time zone" value={Intl.DateTimeFormat().resolvedOptions().timeZone} />
    </SettingsPane>
  );
}

function Automation() {
  const [mode, setMode] = useState<'full_auto' | 'smart_auto' | 'manual'>('smart_auto');
  return (
    <SettingsPane title="Automation" lede="How much rope the agent gets.">
      <div className="settings__mode-picker">
        <ModeOption
          name="full_auto"
          title="Full Auto"
          subtitle="Execute every tool unless the spend cap stops it."
          active={mode === 'full_auto'}
          onPick={() => setMode('full_auto')}
        />
        <ModeOption
          name="smart_auto"
          title="Smart Auto"
          subtitle="Read-only is automatic. Side-effect calls prompt for approval."
          active={mode === 'smart_auto'}
          onPick={() => setMode('smart_auto')}
          recommended
        />
        <ModeOption
          name="manual"
          title="Manual"
          subtitle="Always prompt. Best for critical-infrastructure agents."
          active={mode === 'manual'}
          onPick={() => setMode('manual')}
        />
      </div>
      <div className="settings__overrides">
        <h4>Per-skill overrides</h4>
        <p className="ot-micro">
          Override the global mode on a per-skill basis (e.g. <code>pack:gstack</code> Full
          Auto, <code>stripe-payments</code> Manual).
        </p>
        <table className="settings__overrides-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Mode</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>cloudflare-workers</td>
              <td>
                <select defaultValue="smart_auto" className="ot-input">
                  <option value="full_auto">Full Auto</option>
                  <option value="smart_auto">Smart Auto</option>
                  <option value="manual">Manual</option>
                </select>
              </td>
            </tr>
            <tr>
              <td>stripe-payments</td>
              <td>
                <select defaultValue="manual" className="ot-input">
                  <option value="full_auto">Full Auto</option>
                  <option value="smart_auto">Smart Auto</option>
                  <option value="manual">Manual</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SettingsPane>
  );
}

function Spending() {
  const [cap, setCap] = useState(5);
  return (
    <SettingsPane title="Spending" lede="Hard cap — overrides every approval mode.">
      <Field label="Daily cap" value={`$${cap.toFixed(2)}`} />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={cap}
        onChange={(e) => setCap(Number(e.target.value))}
        className="settings__slider"
        aria-label="Daily spend cap"
      />
      <div className="settings__spent">
        <span className="ot-label">Spent today</span>
        <div className="settings__spent-bar">
          <div className="settings__spent-fill" style={{ width: '34%' }} />
        </div>
        <div className="settings__spent-row">
          <span>$1.71 / ${cap.toFixed(2)}</span>
          <span className="ot-micro">resets at midnight local</span>
        </div>
      </div>
      <div>
        <h4>Per-tool caps</h4>
        <p className="ot-micro">e.g. <code>github</code> OK, <code>domains</code> capped at $25/year.</p>
      </div>
    </SettingsPane>
  );
}

function Models() {
  return (
    <SettingsPane title="Models" lede="Which model the orchestrator + judge use.">
      <Field label="Orchestrator" value="workers-ai/@cf/meta/llama-3.1-70b-instruct" />
      <Field label="Judge" value="workers-ai/@cf/meta/llama-3.1-70b-instruct" />
      <Field label="Code Mode" value="Smart — agent decides per turn" />
      <div className="settings__model-toggle">
        <p className="ot-micro">Swap providers any time. Configure keys in <code>Settings → Cloudflare</code>.</p>
      </div>
    </SettingsPane>
  );
}

function Cloudflare() {
  return (
    <SettingsPane title="Cloudflare" lede="Token, account, hostname, providers.">
      <Field label="Account" value="acct_••••2c79" />
      <Field label="API token" value="••••••••••••••••••••s9x4" />
      <Field label="Hostname" value="copper-onion.workers.dev" />
      <button className="ot-btn ot-btn--ghost">Rotate token</button>
    </SettingsPane>
  );
}

function Access({ email }: { email: string }) {
  return (
    <SettingsPane title="Access" lede="Who can talk to this agent.">
      <Field label="Method" value="Cloudflare Access · OTP" />
      <h4>Allowed emails</h4>
      <ul className="settings__access-list">
        <li>
          <span>{email}</span>
          <span className="ot-pill">owner</span>
        </li>
      </ul>
      <input className="ot-input" placeholder="add email…" />
    </SettingsPane>
  );
}

function SkillsTab() {
  return (
    <SettingsPane title="Skills" lede="Manage packs and per-skill behavior.">
      <p>
        See the dedicated <a href="#/skills">Skills page</a> for toggles, when-to-use
        descriptions, and pack management.
      </p>
    </SettingsPane>
  );
}

function Sync() {
  return (
    <SettingsPane title="Sync" lede="Pull upstream changes, contribute back.">
      <div className="settings__sync-status">
        <span className="ot-pill ot-pill--good">up to date</span>
        <span>You are on the latest version of <code>openthink3</code>.</span>
      </div>
      <h4>Recent contributions</h4>
      <ul className="settings__sync-list">
        <li>No PRs opened yet.</li>
      </ul>
    </SettingsPane>
  );
}

function DangerZone({ agentName }: { agentName: string }) {
  return (
    <SettingsPane title="Danger zone" lede="Irreversible operations.">
      <div className="settings__danger-row">
        <div>
          <h4>Reset memories</h4>
          <p className="ot-micro">Clears every memory {agentName} has accumulated.</p>
        </div>
        <button className="ot-btn ot-btn--ghost">Reset</button>
      </div>
      <div className="settings__danger-row">
        <div>
          <h4>Delete this agent</h4>
          <p className="ot-micro">Tears down the Worker, drops the DOs, deletes the data.</p>
        </div>
        <button className="ot-btn ot-btn--ghost">Delete agent</button>
      </div>
    </SettingsPane>
  );
}

function SettingsPane({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-pane">
      <header>
        <h3>{title}</h3>
        <p className="settings-pane__lede">{lede}</p>
      </header>
      <div className="settings-pane__body">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings__field">
      <span className="ot-label">{label}</span>
      <div className="settings__field-value">{value}</div>
    </div>
  );
}

function ModeOption({
  name,
  title,
  subtitle,
  active,
  onPick,
  recommended,
}: {
  name: string;
  title: string;
  subtitle: string;
  active: boolean;
  onPick: () => void;
  recommended?: boolean;
}) {
  return (
    <button
      type="button"
      className={`mode-option${active ? ' mode-option--active' : ''}`}
      onClick={onPick}
      data-name={name}
    >
      <div className="mode-option__head">
        <span className="mode-option__title">{title}</span>
        {recommended && <span className="ot-pill ot-pill--accent">recommended</span>}
      </div>
      <p>{subtitle}</p>
    </button>
  );
}
