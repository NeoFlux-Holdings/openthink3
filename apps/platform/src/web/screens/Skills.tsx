import { useEffect, useMemo, useRef, useState } from 'react';
import type { Skill } from '@shared/types';
import { showToast } from '../shell/Toast';
import './Skills.css';

interface Props {
  agentName: string;
}

const PACKS: Array<{
  id: string;
  source: Skill['source'] | 'multiple';
  title: string;
  description: string;
  defaultEnabled: boolean;
}> = [
  {
    id: 'pack:cloudflare',
    source: 'cloudflare',
    title: 'Cloudflare',
    description: 'Workers, DOs, Sandbox, Wrangler, Web Perf, MCP builders, plus the bundled CF MCP servers.',
    defaultEnabled: true,
  },
  {
    id: 'pack:anthropic-core',
    source: 'anthropic',
    title: 'Anthropic core',
    description: 'skill-creator, mcp-builder, webapp-testing, frontend-design, docx/pdf/xlsx/pptx, brand-guidelines.',
    defaultEnabled: false,
  },
  {
    id: 'pack:openai-core',
    source: 'openai',
    title: 'OpenAI core',
    description: 'skill-creator, cloudflare-deploy, gh-address-comments, gh-fix-ci, imagegen, jupyter-notebook.',
    defaultEnabled: false,
  },
  {
    id: 'pack:aihero',
    source: 'aihero',
    title: 'aihero',
    description: '/grill-me, /domain-model, /to-prd, /to-issues, /tdd, /triage, /handoff, /prototype, /review.',
    defaultEnabled: false,
  },
  {
    id: 'pack:gstack',
    source: 'gstack',
    title: 'gstack',
    description: '23 slash commands + 8 power tools simulating an engineering team.',
    defaultEnabled: false,
  },
  {
    id: 'pack:gbrain',
    source: 'gbrain',
    title: 'gbrain',
    description: 'Persistent knowledge base + 34 skills + dispatcher. Hybrid vector + graph.',
    defaultEnabled: false,
  },
];

export function Skills({ agentName }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activePack, setActivePack] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  useEffect(() => {
    void fetch('/api/skills')
      .then((r) => r.json())
      .then((data: { skills: Skill[] }) => setSkills(data.skills))
      .catch(() => undefined);
  }, []);

  const toggleSkill = async (id: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    );
    void fetch(`/api/skills/${id}/toggle`, { method: 'POST' }).catch(() => undefined);
  };

  // Bulk toggle every skill matching a predicate to a target state.
  // Used by the "Enable all visible" / "Disable all visible" actions in
  // the filter row. Fans out POSTs in cohorts of 6 so we don't slam
  // the worker if the user just enabled a 40-skill pack.
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkSetEnabled = async (
    predicate: (s: Skill) => boolean,
    target: boolean,
  ) => {
    const candidates = skills.filter((s) => predicate(s) && s.enabled !== target);
    if (candidates.length === 0) return;
    setBulkBusy(true);
    // Optimistic local flip.
    const snapshot = skills;
    setSkills((prev) =>
      prev.map((s) =>
        predicate(s) && s.enabled !== target ? { ...s, enabled: target } : s,
      ),
    );
    try {
      const ids = candidates.map((s) => s.id);
      const cohort = 6;
      for (let i = 0; i < ids.length; i += cohort) {
        const batch = ids.slice(i, i + cohort);
        await Promise.all(
          batch.map((id) =>
            fetch(`/api/skills/${id}/toggle`, { method: 'POST' }).catch(() => undefined),
          ),
        );
      }
      showToast(
        `${target ? 'Enabled' : 'Disabled'} ${candidates.length} skill${candidates.length === 1 ? '' : 's'}`,
        'ok',
      );
    } catch {
      setSkills(snapshot);
      showToast('Bulk toggle failed', 'err');
    } finally {
      setBulkBusy(false);
    }
  };

  // Drag-reorder state. `draggingId` is the row currently being dragged;
  // `overId` is the row the pointer is currently hovering. We persist
  // the full id-array on every drop so the server's stored priority
  // list mirrors what the user sees.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const persistOrder = (ordered: Skill[]) => {
    const ids = ordered.map((s) => s.id);
    void fetch('/api/skills/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).catch(() => undefined);
  };

  const reorderSkill = (srcId: string, dstId: string) => {
    if (srcId === dstId) return;
    setSkills((prev) => {
      const fromIdx = prev.findIndex((s) => s.id === srcId);
      const toIdx = prev.findIndex((s) => s.id === dstId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved!);
      persistOrder(next);
      showToast('Skill order saved', 'ok');
      return next;
    });
  };

  // Filter the installed-skills list by case-insensitive substring match
  // against name / description / when-to-use, AND by source chip. Sources
  // present in the loaded skill list are surfaced as filter chips so the
  // user only sees options that actually exist.
  const filterText = filter.trim().toLowerCase();
  const visibleSkills = skills.filter((s) => {
    if (sourceFilter !== 'all' && s.source !== sourceFilter) return false;
    if (!filterText) return true;
    return (
      s.name.toLowerCase().includes(filterText) ||
      s.description.toLowerCase().includes(filterText) ||
      (s.whenToUse?.toLowerCase().includes(filterText) ?? false)
    );
  });
  const presentSources = Array.from(new Set(skills.map((s) => s.source))).sort();

  return (
    <div className="skills-page">
      <header className="skills-page__header">
        <h2>Skills</h2>
        <p className="skills-page__lede">
          Reusable procedures {agentName} can run. Packs come from the Anthropic, OpenAI,
          Cloudflare, aihero, gstack, and gbrain ecosystems — one parser, four catalogs.
        </p>
      </header>

      <section className="skills-page__section">
        <div className="skills-page__section-head">
          <h3>Packs</h3>
          <p className="ot-micro">Toggle whole catalogs on or off.</p>
        </div>
        <div className="skills-page__packs">
          {PACKS.map((pack) => {
            // Count installed skills with this pack's source so the user
            // sees "8 installed" instead of guessing whether anything's
            // actually plumbed in.
            const installed = skills.filter((s) => s.source === pack.source).length;
            const uninstall = async () => {
              if (
                !window.confirm(
                  `Uninstall ${pack.title}? ${installed} skill${installed === 1 ? '' : 's'} will be removed. This drops the local D1 rows + R2 blobs.`,
                )
              ) {
                return;
              }
              try {
                const res = await fetch(
                  `/api/skills/pack/${encodeURIComponent(pack.source)}/uninstall`,
                  { method: 'POST' },
                );
                const data = (await res.json()) as { ok: boolean; removed?: number };
                if (data.ok) {
                  setSkills((prev) => prev.filter((s) => s.source !== pack.source));
                  showToast(
                    `Uninstalled ${pack.title} · ${data.removed ?? installed} removed`,
                    'ok',
                  );
                } else {
                  showToast('Uninstall failed', 'err');
                }
              } catch {
                showToast('Uninstall failed', 'err');
              }
            };
            return (
              <div
                key={pack.id}
                className={`skill-pack${activePack === pack.id ? ' skill-pack--active' : ''}`}
                role="group"
                aria-label={pack.title}
              >
                <div className="skill-pack__head">
                  <button
                    type="button"
                    className="skill-pack__title-btn"
                    onClick={() => setActivePack(pack.id === activePack ? null : pack.id)}
                  >
                    {pack.title}
                  </button>
                  <SkillToggle on={pack.defaultEnabled} />
                </div>
                <p className="skill-pack__desc">{pack.description}</p>
                {activePack === pack.id && (() => {
                  // Pack-contents preview — surfaces the installed
                  // skill names from this pack so the user can see
                  // exactly what they're toggling. Sorted by `enabled`
                  // first (enabled live above disabled) so a glance at
                  // the top tells you what's actually in play. Caps at
                  // 8 visible with a "+N more" tail so 30-skill packs
                  // don't drown the panel.
                  const packSkills = skills
                    .filter((s) => s.source === pack.source)
                    .slice()
                    .sort((a, b) => {
                      if (!!a.enabled !== !!b.enabled) return a.enabled ? -1 : 1;
                      return a.name.localeCompare(b.name);
                    });
                  if (packSkills.length === 0) {
                    return (
                      <p className="ot-micro skill-pack__contents-empty">
                        Nothing installed from this pack yet.
                      </p>
                    );
                  }
                  const visible = packSkills.slice(0, 8);
                  const remainder = packSkills.length - visible.length;
                  return (
                    <ul className="skill-pack__contents">
                      {visible.map((s) => (
                        <li
                          key={s.id}
                          className={`skill-pack__contents-row${s.enabled ? '' : ' skill-pack__contents-row--off'}`}
                          title={s.description}
                        >
                          <span
                            className={`skill-pack__contents-dot${s.enabled ? ' skill-pack__contents-dot--on' : ''}`}
                            aria-hidden
                          />
                          <span className="skill-pack__contents-name">{s.name}</span>
                        </li>
                      ))}
                      {remainder > 0 && (
                        <li className="skill-pack__contents-more ot-micro">
                          +{remainder} more · scroll the Installed list below
                        </li>
                      )}
                    </ul>
                  );
                })()}
                <div className="skill-pack__foot">
                  <span className="ot-micro">{pack.id}</span>
                  {installed > 0 && (
                    <button
                      type="button"
                      className="skill-pack__uninstall"
                      onClick={() => void uninstall()}
                      title="Remove every skill from this pack"
                    >
                      ✕ uninstall ({installed})
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <SkillAuthor />

      <section className="skills-page__section">
        <div className="skills-page__section-head">
          <h3>Installed skills</h3>
          <p className="ot-micro">
            Discover-by-default: skills auto-load when their <code>description</code> and{' '}
            <code>when_to_use</code> match the conversation.
          </p>
          {/* Tester history import/export — agent-level utility for
              moving the test-prompt library between OpenThink
              installations. Sits in the section header so users
              browsing skills naturally see the affordance. */}
          <div className="skills-page__history-tools">
            <button
              type="button"
              className="ot-btn ot-btn--ghost skills-page__history-btn"
              onClick={() => {
                const text = exportTesterHistory(agentName);
                const blob = new Blob([text], {
                  type: 'application/json;charset=utf-8',
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `tester-history-${agentName || 'agent'}-${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 500);
                showToast('Tester history exported', 'ok');
              }}
              title="Download every tester-history prompt (per-skill + global) as JSON for import on another agent"
            >
              ↓ Export tester history
            </button>
            <label
              className="ot-btn ot-btn--ghost skills-page__history-btn"
              title="Merge a previously-exported tester history JSON into the current agent's history pool"
            >
              ↑ Import…
              <input
                type="file"
                accept="application/json,.json"
                className="skills-page__history-file"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const result = importTesterHistory(text);
                    if (result.ok) {
                      showToast(
                        `Imported ${result.added} unique prompt${result.added === 1 ? '' : 's'} (${result.duplicates} skipped)`,
                        'ok',
                      );
                    } else {
                      showToast(`Import failed: ${result.error}`, 'err');
                    }
                  } catch (err) {
                    showToast(
                      `Import failed: ${err instanceof Error ? err.message : 'read error'}`,
                      'err',
                    );
                  } finally {
                    // Reset so the same file can be picked again.
                    e.target.value = '';
                  }
                }}
              />
            </label>
          </div>
        </div>
        {skills.length === 0 ? (
          <div className="ot-empty skills-page__empty">
            <span className="ot-empty__glyph" aria-hidden>
              ⊕
            </span>
            <h3 className="ot-empty__title">No skills installed yet</h3>
            <p className="ot-empty__body">
              Install a pack from the catalog above, or save a generic
              workflow from a Train-mode session to turn it into a reusable
              skill.
            </p>
            <div className="skills-page__empty-cta">
              <button
                type="button"
                className="ot-btn"
                onClick={() => {
                  // Smooth-scroll to the Packs section and flash it so the
                  // user's eye lands on the catalog.
                  const el = document.querySelector('.skills-page__packs');
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    el.classList.add('skills-page__packs--flash');
                    window.setTimeout(
                      () => el.classList.remove('skills-page__packs--flash'),
                      1200,
                    );
                  }
                }}
              >
                ↑ Browse packs
              </button>
              <button
                type="button"
                className="ot-btn ot-btn--ghost"
                onClick={() => {
                  // Open the inline Skill Author and scroll to it. The
                  // SkillAuthor component listens for the custom event and
                  // flips its internal open state.
                  window.dispatchEvent(new CustomEvent('openthink:open-skill-author'));
                }}
              >
                ✎ Author one inline
              </button>
              <button
                type="button"
                className="ot-btn ot-btn--ghost"
                onClick={() => {
                  // Open the chat — once the user runs a real workflow they
                  // can pop the "Save as skill" sheet from the canvas.
                  window.location.hash = '#/shell';
                }}
              >
                → Save from chat
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="skills-page__filters">
              <input
                type="search"
                className="ot-input skills-page__filter-input"
                placeholder="Filter skills by name, description, when-to-use…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter skills"
              />
              <div className="skills-page__filter-chips">
                <button
                  type="button"
                  className={`skills-page__filter-chip${sourceFilter === 'all' ? ' skills-page__filter-chip--active' : ''}`}
                  onClick={() => setSourceFilter('all')}
                >
                  all
                </button>
                {presentSources.map((src) => (
                  <button
                    key={src}
                    type="button"
                    className={`skills-page__filter-chip${sourceFilter === src ? ' skills-page__filter-chip--active' : ''}`}
                    onClick={() => setSourceFilter(src)}
                  >
                    {src}
                  </button>
                ))}
                {(filter || sourceFilter !== 'all') && (
                  <button
                    type="button"
                    className="skills-page__filter-chip skills-page__filter-chip--clear"
                    onClick={() => {
                      setFilter('');
                      setSourceFilter('all');
                    }}
                  >
                    × clear
                  </button>
                )}
              </div>
              <span className="ot-micro skills-page__filter-count">
                {visibleSkills.length} / {skills.length}
              </span>
              {/* Bulk-toggle the currently-filtered set. Only renders
                  when there's ≥2 visible skills so a single-row view
                  doesn't gain unnecessary chrome. The buttons disable
                  themselves when there'd be nothing to flip (every
                  visible skill is already on / off respectively). */}
              {visibleSkills.length >= 2 && (() => {
                const visibleIds = new Set(visibleSkills.map((s) => s.id));
                const predicate = (s: Skill) => visibleIds.has(s.id);
                const allOn = visibleSkills.every((s) => s.enabled);
                const allOff = visibleSkills.every((s) => !s.enabled);
                return (
                  <div className="skills-page__bulk-toggle">
                    <button
                      type="button"
                      className="skills-page__bulk-btn"
                      onClick={() => void bulkSetEnabled(predicate, true)}
                      disabled={bulkBusy || allOn}
                      title="Enable every visible skill"
                    >
                      Enable all
                    </button>
                    <button
                      type="button"
                      className="skills-page__bulk-btn"
                      onClick={() => void bulkSetEnabled(predicate, false)}
                      disabled={bulkBusy || allOff}
                      title="Disable every visible skill"
                    >
                      Disable all
                    </button>
                  </div>
                );
              })()}
            </div>
            {visibleSkills.length === 0 ? (
              <p className="ot-micro" style={{ padding: '12px 16px' }}>
                No skills match this filter.
              </p>
            ) : (
              <ul className="skills-page__list">
                {visibleSkills.map((s) => (
                  <li
                    key={s.id}
                    className={`skill-row${s.enabled ? '' : ' skill-row--off'}${draggingId === s.id ? ' skill-row--dragging' : ''}${overId === s.id && draggingId && draggingId !== s.id ? ' skill-row--over' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', s.id);
                      setDraggingId(s.id);
                    }}
                    onDragOver={(e) => {
                      if (!draggingId || draggingId === s.id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setOverId(s.id);
                    }}
                    onDragLeave={() => {
                      setOverId((cur) => (cur === s.id ? null : cur));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const src = draggingId;
                      setDraggingId(null);
                      setOverId(null);
                      if (src) reorderSkill(src, s.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setOverId(null);
                    }}
                    // Keyboard nav — Tab to enter, arrows to walk the
                    // list, Enter / Space to toggle enabled, t to open
                    // the inline tester. Discriminates on event target
                    // so descendants (toggle, tester input) still get
                    // their own native key handling.
                    tabIndex={0}
                    role="listitem"
                    aria-label={`Skill ${s.name}, ${s.enabled ? 'enabled' : 'disabled'}. Enter to toggle.`}
                    onKeyDown={(e) => {
                      const target = e.currentTarget as HTMLLIElement;
                      if (e.target !== target) return;
                      const NAV_KEYS = [
                        'ArrowDown',
                        'ArrowUp',
                        'Home',
                        'End',
                        'Enter',
                        ' ',
                        't',
                        'T',
                      ];
                      if (!NAV_KEYS.includes(e.key)) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void toggleSkill(s.id);
                        return;
                      }
                      if (e.key === 't' || e.key === 'T') {
                        // Pop the tester for this row — the <details>
                        // child renders a `summary` that natively
                        // toggles its `open` attribute when activated.
                        const det = target.querySelector(
                          'details.skill-row__tester',
                        ) as HTMLDetailsElement | null;
                        if (det) {
                          e.preventDefault();
                          det.open = !det.open;
                          if (det.open) {
                            // Park focus on the tester input so the
                            // user can start typing immediately.
                            const input = det.querySelector(
                              'input[type="text"]',
                            ) as HTMLInputElement | null;
                            input?.focus();
                          }
                        }
                        return;
                      }
                      const list = target.parentElement;
                      if (!list) return;
                      const rows = Array.from(
                        list.querySelectorAll<HTMLLIElement>('.skill-row'),
                      );
                      const idx = rows.indexOf(target);
                      if (idx < 0 || rows.length === 0) return;
                      e.preventDefault();
                      let next = idx;
                      if (e.key === 'ArrowDown')
                        next = Math.min(rows.length - 1, idx + 1);
                      else if (e.key === 'ArrowUp')
                        next = Math.max(0, idx - 1);
                      else if (e.key === 'Home') next = 0;
                      else if (e.key === 'End') next = rows.length - 1;
                      if (next !== idx) {
                        rows[next]?.focus();
                        rows[next]?.scrollIntoView({
                          block: 'nearest',
                          inline: 'nearest',
                        });
                      }
                    }}
                  >
                    <span
                      className="skill-row__handle"
                      aria-hidden
                      title="Drag to reorder discovery priority"
                    >
                      ⠿
                    </span>
                    <div>
                      <div className="skill-row__name">
                        {s.name}{' '}
                        <span className="ot-pill ot-pill--accent">{s.source}</span>
                        <span className="ot-micro" style={{ marginLeft: 8 }}>v{s.version}</span>
                        {typeof s.lastUsed === 'number' && (
                          <span
                            className={`skill-row__recent${Date.now() - s.lastUsed < 24 * 60 * 60_000 ? ' skill-row__recent--hot' : ''}`}
                            title={new Date(s.lastUsed).toLocaleString()}
                          >
                            used {skillRecentLabel(s.lastUsed)}
                          </span>
                        )}
                      </div>
                      <div className="skill-row__desc">{s.description}</div>
                      {s.whenToUse && <div className="skill-row__when">When: {s.whenToUse}</div>}
                      <SkillTester
                        skillId={s.id}
                        skillName={s.name}
                        skillDescription={s.description}
                        skillWhenToUse={s.whenToUse}
                      />
                    </div>
                    {s.source === 'local' && (
                      <button
                        type="button"
                        className="skill-row__fork"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const res = await fetch(
                              `/api/skills/${encodeURIComponent(s.id)}/body`,
                            );
                            const data = (await res.json()) as {
                              ok: boolean;
                              body?: string;
                              name?: string;
                            };
                            if (!data.ok || !data.body) {
                              showToast(
                                'Could not load skill body — fork unavailable',
                                'err',
                              );
                              return;
                            }
                            // Hand the body off to the authoring panel
                            // via a custom event so we don't have to
                            // hoist SkillAuthor's state into Skills.
                            // The author component listens for this
                            // and opens itself + populates the source.
                            window.dispatchEvent(
                              new CustomEvent('openthink:fork-skill', {
                                detail: {
                                  body: data.body,
                                  originalName: data.name ?? s.name,
                                },
                              }),
                            );
                            showToast(
                              `Forked "${data.name ?? s.name}" into the author panel`,
                              'ok',
                            );
                          } catch {
                            showToast('Fork failed', 'err');
                          }
                        }}
                        title="Copy this skill's source into the authoring panel as a starting point for a new skill"
                      >
                        ⤴ Fork
                      </button>
                    )}
                    <SkillToggle on={s.enabled} onClick={() => toggleSkill(s.id)} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// Inline tester for a single skill row. The user types a sample
// message + clicks "Test match" to see whether the orchestrator's
// keyword heuristic would auto-load this skill on that turn. Lets
// authors tune `whenToUse` without burning real chat turns. Pure
// client interaction — backend route runs a token-set Jaccard against
// the skill's description + when_to_use.
// Per-skill history cap — 8 queries is enough to cover a typical
// authoring session without bloating the localStorage payload.
const TESTER_HISTORY_CAP = 8;
const TESTER_HISTORY_KEY = (skillId: string): string =>
  `openthink:skill-tester-hist:${skillId}`;

function loadTesterHistory(skillId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TESTER_HISTORY_KEY(skillId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .slice(0, TESTER_HISTORY_CAP);
  } catch {
    return [];
  }
}

function pushTesterHistory(skillId: string, q: string): string[] {
  if (typeof window === 'undefined') return [];
  const trimmed = q.trim();
  if (!trimmed) return loadTesterHistory(skillId);
  // Dedup by string value — pushing an already-present query bubbles
  // it to the front. Cap enforced at write time so the array never
  // exceeds the limit across sessions.
  const cur = loadTesterHistory(skillId).filter((s) => s !== trimmed);
  cur.unshift(trimmed);
  const next = cur.slice(0, TESTER_HISTORY_CAP);
  window.localStorage.setItem(TESTER_HISTORY_KEY(skillId), JSON.stringify(next));
  return next;
}

function clearTesterHistory(skillId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TESTER_HISTORY_KEY(skillId));
}

// Cross-skill "recent queries everywhere" pool. Lives separately from
// the per-skill history so a user can re-run a useful test prompt on
// a brand-new fork (or a freshly-saved skill that has no per-skill
// history yet) without re-typing. Capped at 12 — slightly higher than
// the per-skill cap since this list aggregates across the whole skill
// shelf.
const GLOBAL_TESTER_HISTORY_CAP = 12;
const GLOBAL_TESTER_HISTORY_KEY = 'openthink:skill-tester-hist-global';

function loadGlobalTesterHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GLOBAL_TESTER_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .slice(0, GLOBAL_TESTER_HISTORY_CAP);
  } catch {
    return [];
  }
}

function pushGlobalTesterHistory(q: string): string[] {
  if (typeof window === 'undefined') return [];
  const trimmed = q.trim();
  if (!trimmed) return loadGlobalTesterHistory();
  const cur = loadGlobalTesterHistory().filter((s) => s !== trimmed);
  cur.unshift(trimmed);
  const next = cur.slice(0, GLOBAL_TESTER_HISTORY_CAP);
  window.localStorage.setItem(GLOBAL_TESTER_HISTORY_KEY, JSON.stringify(next));
  return next;
}

function clearGlobalTesterHistory(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(GLOBAL_TESTER_HISTORY_KEY);
}

// Export every tester-history pool to a JSON string the user can save
// + import into another OpenThink installation. Captures both the
// global recent pool AND every per-skill bucket (keyed by skill id);
// the importer treats per-skill entries as global-pool seed candidates
// since skill ids don't match across installations.
function exportTesterHistory(agentName: string): string {
  if (typeof window === 'undefined') return '{}';
  const globalRecent = loadGlobalTesterHistory();
  const perSkill: Record<string, string[]> = {};
  try {
    // Walk every localStorage key for the per-skill prefix.
    const prefix = 'openthink:skill-tester-hist:';
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const skillId = key.slice(prefix.length);
      // Skip the global bucket; it lives under a different key.
      if (skillId.length === 0) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          perSkill[skillId] = parsed.filter(
            (s): s is string => typeof s === 'string',
          );
        }
      } catch {
        /* corrupt cell — skip */
      }
    }
  } catch {
    /* localStorage access failure — leave perSkill empty */
  }
  return JSON.stringify(
    {
      schema: 'openthink/tester-history@1',
      agentName,
      exportedAt: Date.now(),
      globalRecent,
      perSkill,
    },
    null,
    2,
  );
}

// Import a previously-exported tester-history JSON. Returns a result
// object with the count of newly-added vs. skipped prompts so the
// caller can surface meaningful feedback. Merges every entry into
// the GLOBAL pool (skill ids won't match across installations, so
// we don't try to restore per-skill buckets — they re-form
// organically as the user runs tests on each skill).
function importTesterHistory(text: string): {
  ok: boolean;
  added: number;
  duplicates: number;
  error?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, added: 0, duplicates: 0, error: 'invalid JSON' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, added: 0, duplicates: 0, error: 'unexpected shape' };
  }
  const data = parsed as {
    schema?: string;
    globalRecent?: unknown;
    perSkill?: unknown;
  };
  if (data.schema && data.schema !== 'openthink/tester-history@1') {
    return {
      ok: false,
      added: 0,
      duplicates: 0,
      error: `unknown schema "${data.schema}"`,
    };
  }
  // Build a candidate set from globalRecent + every per-skill bucket
  // (so a per-skill prompt from agent A still lands in agent B's
  // global pool, ready to be re-bound to whichever skill matches).
  const candidates = new Set<string>();
  if (Array.isArray(data.globalRecent)) {
    for (const q of data.globalRecent) {
      if (typeof q === 'string' && q.trim().length > 0) {
        candidates.add(q.trim());
      }
    }
  }
  if (data.perSkill && typeof data.perSkill === 'object') {
    for (const arr of Object.values(data.perSkill as Record<string, unknown>)) {
      if (!Array.isArray(arr)) continue;
      for (const q of arr) {
        if (typeof q === 'string' && q.trim().length > 0) {
          candidates.add(q.trim());
        }
      }
    }
  }
  if (candidates.size === 0) {
    return {
      ok: false,
      added: 0,
      duplicates: 0,
      error: 'no recognisable prompts found',
    };
  }
  // Merge into the global pool: existing entries skip, new entries
  // get pushed via the canonical helper so cap + dedup semantics
  // stay consistent.
  const existing = new Set(loadGlobalTesterHistory());
  let added = 0;
  let duplicates = 0;
  for (const q of candidates) {
    if (existing.has(q)) {
      duplicates += 1;
      continue;
    }
    pushGlobalTesterHistory(q);
    existing.add(q);
    added += 1;
  }
  return { ok: true, added, duplicates };
}

// Stop-words trimmed before keyword extraction. Kept short — these are
// the high-frequency particles that drown out the actual content tokens
// in description / whenToUse strings ("use this when…", "the skill
// helps the user with…"). Anything else stays so genuine domain words
// like "deploy" / "schedule" / "calendar" survive.
const SAMPLE_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'with', 'when', 'use', 'using',
  'used', 'this', 'that', 'these', 'those', 'is', 'are', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'by', 'as', 'so', 'it', 'its', 'if', 'should',
  'will', 'would', 'can', 'could', 'do', 'does', 'has', 'have', 'had', 'about',
  'user', 'users', 'agent', 'agents', 'helper', 'helps', 'help', 'helping',
  'skill', 'skills', 'tool', 'tools', 'need', 'needs', 'want', 'wants', 'wanting',
  'asks', 'ask', 'asking', 'how', 'why', 'what', 'which', 'where', 'whose',
  'thing', 'things', 'something', 'anything', 'someone', 'anyone', 'most',
  'into', 'than', 'then', 'they', 'them', 'their', 'there', 'from', 'have',
]);

// Derive a 3-4 chip sample library from the skill's metadata. The samples
// are user-message shaped (questions / requests) seeded with the skill's
// own distinctive vocabulary, so clicking one tests whether the matcher
// would activate on a realistic phrasing of that domain. If the description
// is empty we fall back to a universal "Show me an example…" line so the
// tester never renders a bare input.
function deriveSampleMessages(
  skillName: string,
  description: string,
  whenToUse: string | undefined,
): string[] {
  const text = `${description ?? ''} ${whenToUse ?? ''}`.toLowerCase();
  const words = (text.match(/[a-z][a-z'-]{3,}/g) ?? []).filter(
    (w) => !SAMPLE_STOPWORDS.has(w),
  );
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  // Sort by frequency, then alpha for stability across renders so the
  // chip order doesn't shuffle when the user re-opens the tester.
  const top = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([w]) => w);

  const samples: string[] = [];
  const lowerName = skillName.toLowerCase();
  // Lead with a name-based prompt — almost always a useful sanity check
  // ("does my skill at least match its own name?").
  samples.push(`Help me with ${lowerName}`);
  if (top[0]) samples.push(`How do I ${top[0]}?`);
  if (top[1]) samples.push(`Can you handle ${top[1]} for me?`);
  if (top[2]) samples.push(`I need ${top[2]} now`);
  // Pad with universals if the description was too thin to yield three
  // distinct keywords (common for terse "FROM upstream" skills).
  if (samples.length < 4) samples.push('Show me an example');
  if (samples.length < 4) samples.push('What does this do?');
  // Dedup while preserving order — name-based + keyword-based can
  // collide on single-word skill names.
  const seen = new Set<string>();
  return samples.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 4);
}

// Generic "should NOT match" pool — phrases drawn from completely
// unrelated domains so they're vanishingly unlikely to share
// keywords with any specific skill. The user batch-tests these to
// verify their threshold isn't so loose it fires on small-talk /
// unrelated requests. Mixed with one or two phrases that
// deliberately use stop-words only, since "what's the weather"
// against a coding skill is the canonical false-positive shape.
const GENERIC_NEGATIVE_POOL: readonly string[] = [
  "What's the weather like today?",
  'Tell me a joke',
  'Pick a random number between 1 and 100',
  'What time is it in Tokyo?',
  'Convert 50 USD to EUR',
  'Recommend a sci-fi novel',
  'How tall is Mount Everest?',
  'Translate "good morning" to French',
  'Name a famous painter',
  'Suggest a quick lunch recipe',
];

// Pick 3 negative samples that don't share any of the skill's top
// keywords. Re-derives the keyword set so the filter stays
// consistent with what `deriveSampleMessages` thinks the skill is
// "about". Deterministic given the same skill — seeded by a tiny
// hash of the name so the same skill always shows the same trio
// (avoids reshuffling on re-open).
function deriveNegativeSampleMessages(
  skillName: string,
  description: string,
  whenToUse: string | undefined,
): string[] {
  const text = `${description ?? ''} ${whenToUse ?? ''}`.toLowerCase();
  const keywords = new Set(
    (text.match(/[a-z][a-z'-]{3,}/g) ?? []).filter(
      (w) => !SAMPLE_STOPWORDS.has(w),
    ),
  );
  // Filter the pool to phrases that don't share any keyword with the
  // skill — anything that survives is a genuine "should NOT match"
  // candidate. Falls back to the unfiltered pool if every entry
  // collides (extremely unlikely with a 10-phrase generic pool).
  const safe = GENERIC_NEGATIVE_POOL.filter((phrase) => {
    const phraseWords = phrase.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [];
    return !phraseWords.some((w) => keywords.has(w));
  });
  const pool = safe.length >= 3 ? safe : [...GENERIC_NEGATIVE_POOL];
  // Stable per-skill seed — hash the name into a single int so the
  // displayed trio sticks across re-renders. Mulberry-style splitmix
  // step is enough for a uniform spread across the small pool.
  let seed = 2166136261;
  for (let i = 0; i < skillName.length; i++) {
    seed ^= skillName.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  // Deterministic Fisher-Yates partial shuffle: walk the array,
  // swap each position with a hash-derived later index, take the
  // first 3. The seed mixes between each step so the picks aren't
  // clustered.
  const next = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = [...pool];
  for (let i = 0; i < Math.min(3, arr.length); i++) {
    const j = i + Math.floor(next() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, 3);
}

function SkillTester({
  skillId,
  skillName,
  skillDescription,
  skillWhenToUse,
}: {
  skillId: string;
  skillName: string;
  skillDescription: string;
  skillWhenToUse?: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{
    score: number;
    wouldActivate: boolean;
    matched: string[];
    threshold: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // Per-skill query history. Lazy-loaded on first open so we don't
  // burn the localStorage read on every render of every row.
  const [history, setHistory] = useState<string[]>([]);
  // Cross-skill query history — surfaces previously-useful test
  // prompts on freshly-saved or just-forked skills that have no
  // per-skill history yet. Lazy-loaded alongside the per-skill set.
  const [globalHistory, setGlobalHistory] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    if (history.length === 0) {
      setHistory(loadTesterHistory(skillId));
    }
    // Global history always loads on open so a fresh skill row
    // surfaces it even when per-skill is empty. Dedup against the
    // per-skill set happens at render time.
    setGlobalHistory(loadGlobalTesterHistory());
  }, [open, skillId, history.length]);
  // Sample prompt library — derived from the skill's description +
  // whenToUse. Memoized on those inputs so editing the skill rebuilds
  // the chip set, but typing in the input doesn't churn it.
  const derivedSamples = useMemo(
    () => deriveSampleMessages(skillName, skillDescription, skillWhenToUse),
    [skillName, skillDescription, skillWhenToUse],
  );
  // Per-skill pinned-sample list. Pinned samples are user-marked
  // "always include in the batch + show even if my description
  // changes" prompts — they're surfaced as the first chips in the
  // strip with a 📌 glyph and survive description-edit churn that
  // would otherwise reshuffle the derived set. Persists to
  // localStorage keyed by skill id.
  const [pinnedSamples, setPinnedSamples] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(`openthink:skill-tester-pinned:${skillId}`);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 12)
        : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pinnedSamples.length === 0) {
      window.localStorage.removeItem(`openthink:skill-tester-pinned:${skillId}`);
    } else {
      window.localStorage.setItem(
        `openthink:skill-tester-pinned:${skillId}`,
        JSON.stringify(pinnedSamples),
      );
    }
  }, [pinnedSamples, skillId]);
  // Merged sample list — pinned first (preserve add order), then the
  // derived samples that aren't already pinned. Dedup case-
  // insensitively so the same prompt can't appear twice with
  // different casing. Memoized on both inputs so a derive-rebuild
  // doesn't trigger a render every time the user types.
  const samples = useMemo(() => {
    const seen = new Set(pinnedSamples.map((s) => s.toLowerCase()));
    const out = [...pinnedSamples];
    for (const s of derivedSamples) {
      const k = s.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(s);
      }
    }
    return out;
  }, [pinnedSamples, derivedSamples]);
  const togglePinSample = (sample: string) => {
    setPinnedSamples((prev) => {
      const idx = prev.indexOf(sample);
      if (idx >= 0) return prev.filter((s) => s !== sample);
      // Cap at 12 — anything beyond that overwhelms the chip row.
      if (prev.length >= 12) return prev;
      return [...prev, sample];
    });
  };
  // Negative samples — phrases the skill SHOULDN'T match. Verdict
  // colors invert: a green ✓ chip here means "the skill correctly
  // skipped this unrelated prompt", red means false-positive risk.
  // Same memo dependency set as the positive samples so a skill
  // edit refreshes both strips together.
  const negativeSamples = useMemo(
    () => deriveNegativeSampleMessages(skillName, skillDescription, skillWhenToUse),
    [skillName, skillDescription, skillWhenToUse],
  );
  // Simulated threshold for the what-if slider — lets the user ask
  // "would this prompt activate at threshold X?" without changing
  // the global setting. Defaults to 0.15 (matches the orchestrator's
  // default) and snaps to the real threshold whenever a fresh
  // result lands so the slider always starts aligned with what the
  // user will actually see in production.
  const [simThreshold, setSimThreshold] = useState(0.15);
  // Batch-run state — fires every sample chip through the match
  // endpoint in sequence and tallies which would activate. Surfaces an
  // aggregate "X of Y activate" verdict + per-chip glyph so the user
  // can sanity-check that their whenToUse covers the expected
  // phrasings without typing each one. Sequential to avoid hammering
  // the same DO with 4 parallel POSTs.
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<
    Record<
      string,
      | { wouldActivate: boolean; score: number; threshold: number }
      | { error: true }
    >
  >({});

  const run = async (override?: string) => {
    const q = (override ?? message).trim();
    if (!q || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillId)}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        score?: number;
        wouldActivate?: boolean;
        matched?: string[];
        threshold?: number;
      };
      if (data.ok) {
        const realThreshold = data.threshold ?? 0.15;
        setResult({
          score: data.score ?? 0,
          wouldActivate: !!data.wouldActivate,
          matched: data.matched ?? [],
          threshold: realThreshold,
        });
        // Snap the what-if slider to the live threshold on every
        // fresh single-fire so the user starts from "what the
        // orchestrator actually does" rather than the previous
        // simulation position. Their what-if drag survives until
        // the next test fires.
        setSimThreshold(realThreshold);
        // Only record a query that produced a real verdict — failed
        // requests skip the history write so the row doesn't fill
        // with noise from a transient outage.
        setHistory(pushTesterHistory(skillId, q));
        // Mirror the entry into the cross-skill pool so future
        // testers (and freshly-saved skills) surface this prompt.
        setGlobalHistory(pushGlobalTesterHistory(q));
      } else {
        showToast('Test failed', 'err');
      }
    } catch {
      showToast('Test failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  // Fire every sample chip through the match endpoint sequentially
  // and stash the verdict per-chip. The user sees an aggregate
  // "{hits}/{total} activate" toast at the end and a tiny glyph next
  // to each chip so they can scan which phrasings actually trigger
  // the skill. Failed requests get marked as { error: true } so
  // their chip shows a × glyph rather than silently looking like
  // they didn't activate. The negative-sample list rides the same
  // batch so the user sees both axes from one button press; the
  // toast surfaces hits + false-positives separately so they
  // can spot a too-loose threshold immediately.
  const runAllSamples = async () => {
    const all = [...samples, ...negativeSamples];
    if (all.length === 0 || batchBusy || busy) return;
    setBatchBusy(true);
    setBatchResults({});
    let hits = 0;
    let fails = 0;
    let falsePositives = 0;
    const negSet = new Set(negativeSamples);
    for (const q of all) {
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(skillId)}/match`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: q }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          score?: number;
          wouldActivate?: boolean;
          threshold?: number;
        };
        if (data.ok) {
          const activated = !!data.wouldActivate;
          if (negSet.has(q)) {
            // A negative sample that activated is a false positive —
            // the threshold is loose enough to fire on small-talk.
            if (activated) falsePositives += 1;
          } else {
            // A positive sample that activated is a hit, the desired
            // outcome for the strip above.
            if (activated) hits += 1;
          }
          // Accumulate via functional update — the loop's next iter
          // shouldn't depend on a stale closure of batchResults.
          setBatchResults((prev) => ({
            ...prev,
            [q]: {
              wouldActivate: activated,
              score: data.score ?? 0,
              threshold: data.threshold ?? 0.15,
            },
          }));
        } else {
          fails += 1;
          setBatchResults((prev) => ({ ...prev, [q]: { error: true } }));
        }
      } catch {
        fails += 1;
        setBatchResults((prev) => ({ ...prev, [q]: { error: true } }));
      }
    }
    setBatchBusy(false);
    // Two-axis summary: positive hit-rate + negative miss-count.
    // Anything >0 in the negative column flips the toast to err so
    // a too-loose threshold leaps off the page.
    const posSummary = `${hits}/${samples.length} activate`;
    const negSummary =
      negativeSamples.length > 0
        ? falsePositives > 0
          ? ` · ${falsePositives} false-positive${falsePositives === 1 ? '' : 's'}`
          : ` · 0/${negativeSamples.length} false-positives`
        : '';
    const failSummary = fails > 0 ? ` · ${fails} failed` : '';
    const isProblem = fails > 0 || falsePositives > 0;
    showToast(
      `Batch test: ${posSummary}${negSummary}${failSummary}`,
      isProblem ? 'err' : 'ok',
    );
  };

  return (
    <details
      className="skill-row__tester"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="skill-row__tester-summary">
        ✦ Test match
      </summary>
      <div className="skill-row__tester-body">
        <div className="skill-row__tester-row">
          <input
            type="text"
            className="ot-input"
            placeholder={`Sample message that should trigger ${skillName}…`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) {
                e.preventDefault();
                void run();
              } else if (e.key === 'ArrowUp' && history.length > 0 && !message) {
                // Empty input + ArrowUp pops the most-recent query
                // into the field. Matches the shell-history convention
                // users already have muscle memory for.
                e.preventDefault();
                setMessage(history[0] ?? '');
              }
            }}
          />
          <button
            type="button"
            className="ot-btn ot-btn--ghost"
            onClick={() => void run()}
            disabled={busy || !message.trim()}
          >
            {busy ? 'Testing…' : 'Run'}
          </button>
        </div>
        {samples.length > 0 && (
          <div className="skill-row__tester-samples">
            <span
              className="ot-micro skill-row__tester-samples-label"
              title="Shift+click any chip to pin it — pinned samples survive description edits and always show first"
            >
              try{pinnedSamples.length > 0 ? ` · 📌${pinnedSamples.length}` : ''}
            </span>
            {samples.map((s) => {
              const verdict = batchResults[s];
              // Each chip wears a verdict glyph after the batch run
              // completes: ✓ for activate, ○ for skip, × for fetch
              // failure, and during the run the in-flight chip shows
              // a dot. Once the batch lands, clicking a chip with an
              // activate verdict pulls it into the input + shows the
              // full result via the existing single-fire path.
              const isActive = !!verdict;
              const hit =
                verdict && 'wouldActivate' in verdict && verdict.wouldActivate;
              const skipped =
                verdict && 'wouldActivate' in verdict && !verdict.wouldActivate;
              const failed = verdict && 'error' in verdict;
              const cls = [
                'skill-row__tester-sample-chip',
                isActive && hit
                  ? 'skill-row__tester-sample-chip--hit'
                  : '',
                isActive && skipped
                  ? 'skill-row__tester-sample-chip--skip'
                  : '',
                isActive && failed
                  ? 'skill-row__tester-sample-chip--err'
                  : '',
              ]
                .filter(Boolean)
                .join(' ');
              const isPinned = pinnedSamples.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  className={`${cls}${isPinned ? ' skill-row__tester-sample-chip--pinned' : ''}`}
                  onClick={(ev) => {
                    // Shift+click toggles the pin state without firing
                    // the prefill / run path — preserves the existing
                    // single-click UX while making the pin discoverable
                    // (the chip's title also explains the shortcut).
                    if (ev.shiftKey) {
                      ev.preventDefault();
                      togglePinSample(s);
                      return;
                    }
                    // If this chip has a verdict already, pull it into
                    // the input + run so the user sees the full
                    // matched-tokens breakdown without retriggering
                    // the batch. Otherwise just prefill so they can
                    // riff before sending (same UX as before).
                    if (verdict && 'wouldActivate' in verdict) {
                      setMessage(s);
                      void run(s);
                    } else {
                      setMessage(s);
                    }
                  }}
                  title={
                    verdict && 'wouldActivate' in verdict
                      ? `${verdict.wouldActivate ? '✓ activates' : '○ skipped'} · score ${verdict.score.toFixed(3)}${isPinned ? ' · 📌 pinned (Shift+click to unpin)' : ' · Shift+click to pin'}`
                      : verdict && 'error' in verdict
                        ? 'Batch test failed for this sample — click to retry'
                        : `Use as starting prompt: ${s}${isPinned ? ' · 📌 pinned (Shift+click to unpin)' : ' · Shift+click to pin'}`
                  }
                  disabled={busy || batchBusy}
                >
                  {isPinned && (
                    <span
                      className="skill-row__tester-sample-pin"
                      aria-label="Pinned"
                      title="Pinned sample"
                    >
                      📌
                    </span>
                  )}
                  {hit && <span className="skill-row__tester-sample-glyph" aria-hidden>✓</span>}
                  {skipped && <span className="skill-row__tester-sample-glyph" aria-hidden>○</span>}
                  {failed && <span className="skill-row__tester-sample-glyph" aria-hidden>×</span>}
                  {s}
                </button>
              );
            })}
            <button
              type="button"
              className="skill-row__tester-samples-runall"
              onClick={() => void runAllSamples()}
              disabled={batchBusy || busy || samples.length === 0}
              title="Test every sample chip (positives + negatives) in one pass and surface which activate this skill"
            >
              {batchBusy ? 'Testing…' : 'Run all'}
            </button>
          </div>
        )}
        {negativeSamples.length > 0 && (
          <div className="skill-row__tester-samples skill-row__tester-samples--neg">
            <span className="ot-micro skill-row__tester-samples-label skill-row__tester-samples-label--neg">
              shouldn't match
            </span>
            {negativeSamples.map((s) => {
              const verdict = batchResults[s];
              // Negative-sample verdict semantics are inverted: ✓
              // means "correctly skipped" (good outcome), × means
              // "false-positive activation" (problem). Keep glyphs
              // visually consistent across both strips so the user
              // doesn't have to re-learn what they mean per row.
              const isActive = !!verdict;
              const activated =
                verdict && 'wouldActivate' in verdict && verdict.wouldActivate;
              const skipped =
                verdict && 'wouldActivate' in verdict && !verdict.wouldActivate;
              const failed = verdict && 'error' in verdict;
              const cls = [
                'skill-row__tester-sample-chip',
                'skill-row__tester-sample-chip--neg',
                // A negative sample that activated is bad → red.
                isActive && activated
                  ? 'skill-row__tester-sample-chip--err'
                  : '',
                // A negative sample that skipped is good → green.
                isActive && skipped
                  ? 'skill-row__tester-sample-chip--hit'
                  : '',
                isActive && failed
                  ? 'skill-row__tester-sample-chip--err'
                  : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={s}
                  type="button"
                  className={cls}
                  onClick={() => {
                    if (verdict && 'wouldActivate' in verdict) {
                      setMessage(s);
                      void run(s);
                    } else {
                      setMessage(s);
                    }
                  }}
                  title={
                    verdict && 'wouldActivate' in verdict
                      ? `${verdict.wouldActivate ? '⚠ false-positive — activates on unrelated prompt' : '✓ correctly skipped'} · score ${verdict.score.toFixed(3)}`
                      : verdict && 'error' in verdict
                        ? 'Batch test failed for this sample — click to retry'
                        : `Negative sample: should NOT activate this skill — ${s}`
                  }
                  disabled={busy || batchBusy}
                >
                  {/* For negatives, the ✓/× glyph meaning inverts vs.
                      the positive strip — render the glyph that
                      matches the actual desirability of the result. */}
                  {activated && (
                    <span className="skill-row__tester-sample-glyph" aria-hidden>×</span>
                  )}
                  {skipped && (
                    <span className="skill-row__tester-sample-glyph" aria-hidden>✓</span>
                  )}
                  {failed && (
                    <span className="skill-row__tester-sample-glyph" aria-hidden>×</span>
                  )}
                  {s}
                </button>
              );
            })}
          </div>
        )}
        {history.length > 0 && (
          <div className="skill-row__tester-history">
            <span className="ot-micro skill-row__tester-history-label">
              recent
            </span>
            {history.map((q) => (
              <button
                key={q}
                type="button"
                className="skill-row__tester-history-chip"
                onClick={() => {
                  // Click re-runs the query immediately rather than
                  // just populating the input — saves a roundtrip
                  // through the Run button for the common case of
                  // re-testing after a skill edit.
                  setMessage(q);
                  void run(q);
                }}
                title={`Re-run: ${q}`}
                disabled={busy}
              >
                {q.length > 32 ? `${q.slice(0, 30)}…` : q}
              </button>
            ))}
            <button
              type="button"
              className="skill-row__tester-history-clear"
              onClick={() => {
                clearTesterHistory(skillId);
                setHistory([]);
              }}
              title="Clear this skill's tester history"
            >
              clear
            </button>
          </div>
        )}
        {/* Cross-skill recent strip — surfaces test prompts the user
            has run against ANY skill that aren't already in this
            skill's per-skill history. Empty when nothing globally
            recent OR when every entry is already in the per-skill
            strip above. Distinct label so the two histories don't
            read as one homogeneous pool. */}
        {(() => {
          const localSet = new Set(history);
          const globalUnique = globalHistory.filter((q) => !localSet.has(q));
          if (globalUnique.length === 0) return null;
          return (
            <div className="skill-row__tester-history skill-row__tester-history--global">
              <span className="ot-micro skill-row__tester-history-label">
                also across skills
              </span>
              {globalUnique.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="skill-row__tester-history-chip skill-row__tester-history-chip--global"
                  onClick={() => {
                    setMessage(q);
                    void run(q);
                  }}
                  title={`Re-run on this skill: ${q}`}
                  disabled={busy}
                >
                  {q.length > 32 ? `${q.slice(0, 30)}…` : q}
                </button>
              ))}
              <button
                type="button"
                className="skill-row__tester-history-clear"
                onClick={() => {
                  clearGlobalTesterHistory();
                  setGlobalHistory([]);
                }}
                title="Clear cross-skill tester history"
              >
                clear
              </button>
            </div>
          );
        })()}
        {result && (() => {
          // What-if threshold slider — purely client-side simulation
          // so the user can ask "would this prompt activate the
          // skill at threshold X?" without flipping a global setting.
          // Lifted from the result.threshold default so the initial
          // position matches what the orchestrator actually uses.
          // Drag → re-derive activation by comparing against the
          // skill's score; verdict glyph + label flip live as the
          // slider moves.
          const simulatedActivates = result.score >= simThreshold;
          const drifted =
            Math.abs(simThreshold - result.threshold) > 0.001;
          return (
            <div
              className={`skill-row__tester-result${simulatedActivates ? ' skill-row__tester-result--hit' : ''}`}
            >
              <span className="skill-row__tester-verdict">
                {simulatedActivates ? '✓ Would activate' : '○ Skipped'}
              </span>
              <span className="ot-micro">
                score {result.score.toFixed(3)} · threshold{' '}
                <span
                  className={drifted ? 'skill-row__tester-thresh-drift' : ''}
                  title={
                    drifted
                      ? `Simulating at ${simThreshold.toFixed(2)} — orchestrator currently uses ${result.threshold.toFixed(2)}`
                      : `Orchestrator's live threshold`
                  }
                >
                  {simThreshold.toFixed(2)}
                </span>
              </span>
              {result.matched.length > 0 && (
                <span className="skill-row__tester-matched">
                  matched: {result.matched.slice(0, 6).map((m) => `“${m}”`).join(', ')}
                  {result.matched.length > 6 && ` +${result.matched.length - 6}`}
                </span>
              )}
              <div className="skill-row__tester-thresh">
                <label className="skill-row__tester-thresh-label ot-micro">
                  what-if threshold
                  <input
                    type="range"
                    className="skill-row__tester-thresh-slider"
                    min={0.05}
                    max={0.5}
                    step={0.01}
                    value={simThreshold}
                    onChange={(e) =>
                      setSimThreshold(Number.parseFloat(e.target.value))
                    }
                    aria-label="Simulated activation threshold"
                  />
                </label>
                {drifted && (
                  <button
                    type="button"
                    className="skill-row__tester-thresh-reset"
                    onClick={() => setSimThreshold(result.threshold)}
                    title="Snap back to the orchestrator's live threshold"
                  >
                    ↺ {result.threshold.toFixed(2)}
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </details>
  );
}

// Skill authoring panel — write Smithers JSX, see the compiled plan as you
// type, save the resulting SKILL.md to R2 + D1 via /api/skills.
//
// The compiled preview goes through the same /api/skills/compile endpoint
// the orchestrator (and any future MCP peer) hits, so we know what the
// user sees in this editor is exactly what the agent will run.
function SkillAuthor() {
  const [open, setOpen] = useState(false);
  // Hydrate the source from a localStorage draft on first render so a
  // page reload doesn't blow away an in-progress workflow. The draft
  // gets written debounced on every change and cleared after a
  // successful save.
  const [source, setSource] = useState<string>(() => {
    if (typeof window === 'undefined') return STARTER_JSX;
    return (
      window.localStorage.getItem('openthink:skill-author-draft') ?? STARTER_JSX
    );
  });
  // Whether the current source differs from both STARTER_JSX (so we
  // know the user has actually touched it) and from the last saved
  // copy. Drives the "draft restored" indicator.
  const [draftRestored, setDraftRestored] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem('openthink:skill-author-draft');
    return stored !== null && stored !== STARTER_JSX;
  });
  // Debounce the draft write so a wall of keystrokes doesn't fire one
  // localStorage write per character. 400ms after the last keypress
  // we mirror the current source into the draft slot.
  const draftTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current);
    draftTimerRef.current = window.setTimeout(() => {
      if (source === STARTER_JSX || source.trim() === '') {
        window.localStorage.removeItem('openthink:skill-author-draft');
      } else {
        window.localStorage.setItem('openthink:skill-author-draft', source);
      }
    }, 400);
    return () => {
      if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current);
    };
  }, [source]);
  const discardDraft = () => {
    if (
      window.confirm(
        'Discard the saved draft and reset to the starter template?',
      )
    ) {
      window.localStorage.removeItem('openthink:skill-author-draft');
      setSource(STARTER_JSX);
      setDraftRestored(false);
    }
  };
  const [compiled, setCompiled] = useState<{
    name: string;
    description?: string;
    steps: Array<{ id: string; title: string; body: string; requiresApproval?: boolean; tool?: string }>;
  } | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ id: string; prUrl?: string } | null>(null);

  // Listen for the empty-state CTA's `openthink:open-skill-author` event.
  // When fired, flip open, scroll into view, and focus the textarea so
  // the user lands in a productive state.
  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      window.requestAnimationFrame(() => {
        const el = document.querySelector('.skill-author');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        const ta = document.querySelector(
          '.skill-author textarea',
        ) as HTMLTextAreaElement | null;
        if (ta) ta.focus();
      });
    };
    window.addEventListener('openthink:open-skill-author', onOpen);
    return () => window.removeEventListener('openthink:open-skill-author', onOpen);
  }, []);

  // Fork-from-existing — a Skill row's "⤴ Fork" button dispatches
  // this with the original SKILL.md body. We open the author panel
  // and replace the current source with the forked body so the user
  // can iterate from a known-good template. The originalName isn't
  // applied verbatim — we leave the body's frontmatter alone and let
  // the user rename the skill before saving (the body has `name:`
  // inside that the user should bump to avoid id collisions).
  useEffect(() => {
    const onFork = (e: Event) => {
      const detail = (e as CustomEvent<{ body?: string; originalName?: string }>).detail;
      if (!detail?.body) return;
      setOpen(true);
      setSource(detail.body);
      // Clear any "saved" / "draft restored" framing — this is a
      // fresh body the user just brought in from elsewhere.
      setSaved(null);
      setDraftRestored(false);
      window.requestAnimationFrame(() => {
        const el = document.querySelector('.skill-author');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };
    window.addEventListener('openthink:fork-skill', onFork);
    return () => window.removeEventListener('openthink:fork-skill', onFork);
  }, []);

  // Debounce the compile so each keystroke isn't a worker call.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/skills/compile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          workflow?: typeof compiled;
          error?: string;
        };
        if (data.ok && data.workflow) {
          setCompiled(data.workflow);
          setCompileError(null);
        } else {
          setCompiled(null);
          setCompileError(data.error ?? 'compile_failed');
        }
      } catch (err) {
        setCompileError(err instanceof Error ? err.message : 'network');
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [open, source]);

  // Client-side linter. Runs against the compiled workflow plus the
  // raw source. Returns a flat list of hints with severity so the
  // UI can render warnings + info inline without forcing the user to
  // dig through docs. Hints don't block save — they're advisory.
  const lintHints = (() => {
    const out: Array<{
      severity: 'warn' | 'info';
      message: string;
    }> = [];
    if (!compiled) return out;
    if (!compiled.description || compiled.description.length < 12) {
      out.push({
        severity: 'info',
        message:
          'No description (or very short). Add a short sentence so the orchestrator can match this skill to user requests.',
      });
    }
    if (compiled.steps.length === 0) {
      out.push({
        severity: 'warn',
        message: 'Workflow has no steps — the agent has nothing to run.',
      });
    }
    if (compiled.steps.length >= 12) {
      out.push({
        severity: 'info',
        message: `${compiled.steps.length} steps — long workflows can be hard to debug. Consider breaking into multiple skills.`,
      });
    }
    // Per-step checks.
    const titleCounts = new Map<string, number>();
    for (const s of compiled.steps) {
      titleCounts.set(s.title, (titleCounts.get(s.title) ?? 0) + 1);
      if (s.title.length > 60) {
        out.push({
          severity: 'warn',
          message: `Step "${s.title.slice(0, 40)}…" has a long title (${s.title.length} chars). Titles surface in the audit log + chat — keep them under 60.`,
        });
      }
      if (!s.body || s.body.length < 12) {
        out.push({
          severity: 'warn',
          message: `Step "${s.title}" has a short or empty body — the agent needs instructions to act on.`,
        });
      }
    }
    for (const [title, n] of titleCounts) {
      if (n > 1) {
        out.push({
          severity: 'warn',
          message: `${n} steps share the title "${title}". Audit log + jump-to-step would be ambiguous — give each a distinct name.`,
        });
      }
    }
    // Approval guidance. Heuristic: if any step's body contains a
    // destructive verb (delete, remove, drop, send, post, deploy,
    // charge, transfer), encourage requiresApproval on that step.
    const destructive = /\b(delete|remove|drop|send|post|deploy|charge|transfer|publish|rm)\b/i;
    for (const s of compiled.steps) {
      if (destructive.test(s.body) && !s.requiresApproval) {
        out.push({
          severity: 'warn',
          message: `Step "${s.title}" looks destructive but has no approval gate. Consider adding requiresApproval to make it manual-mode by default.`,
        });
        break; // one mention is enough — don't spam
      }
    }
    // Source-level: surface TODO / FIXME so the user knows they had
    // scaffolding to come back to.
    if (/\b(TODO|FIXME|XXX|TBD)\b/i.test(source)) {
      out.push({
        severity: 'info',
        message: 'Source contains TODO/FIXME — leftover scaffolding the agent may not handle.',
      });
    }
    return out;
  })();

  const save = async () => {
    if (!compiled) return;
    setBusy(true);
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: compiled.name,
          description: compiled.description ?? `${compiled.steps.length}-step workflow.`,
          whenToUse: 'authored from the skill editor',
          body: source,
          tags: ['local', 'smithers'],
        }),
      });
      const data = (await res.json()) as { ok: boolean; id?: string; prUrl?: string };
      if (data.ok && data.id) {
        setSaved({ id: data.id, prUrl: data.prUrl });
        // Successful save → the draft is no longer "in flight". Drop
        // it from localStorage so a future reload doesn't re-hydrate
        // the same body the user just persisted.
        window.localStorage.removeItem('openthink:skill-author-draft');
        setDraftRestored(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="skills-page__section">
      <div className="skills-page__section-head">
        <h3>Author a skill</h3>
        <p className="ot-micro">
          Write a Smithers JSX workflow; compile lands live as you type. Saves
          to R2 + D1 and (when "Share skills upstream" is on) opens a draft PR.
        </p>
      </div>
      {!open ? (
        <button type="button" className="ot-btn" onClick={() => setOpen(true)}>
          ＋ New skill
        </button>
      ) : (
        <div className="skill-author">
          {draftRestored && (
            <div className="skill-author__draft" role="status">
              <span className="skill-author__draft-glyph" aria-hidden>✦</span>
              <span>
                Draft restored from your last session — keep editing or{' '}
                <button
                  type="button"
                  className="skill-author__draft-discard"
                  onClick={discardDraft}
                >
                  discard
                </button>
                .
              </span>
            </div>
          )}
          <textarea
            className="ot-input skill-author__source"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setSaved(null);
              // Once the user types, we're definitively past the
              // "restored from disk" framing — hide the chip so it
              // doesn't camp on screen.
              if (draftRestored) setDraftRestored(false);
            }}
            rows={14}
            spellCheck={false}
          />
          <div className="skill-author__preview">
            <span className="ot-label">Compiled</span>
            {compileError ? (
              <p className="skill-author__error">⊘ {compileError}</p>
            ) : compiled ? (
              <>
                <div className="skill-author__title">
                  <strong>{compiled.name}</strong>
                  <span className="ot-micro">{compiled.steps.length} step(s)</span>
                </div>
                {/* Lint hints — purely advisory, fired off the compiled
                    workflow + raw source. Warnings get a louder
                    treatment than info notes; both are dismissable in
                    aggregate via the "× clear" pill. */}
                {lintHints.length > 0 && (
                  <ul className="skill-author__lints">
                    {lintHints.map((h, i) => (
                      <li
                        key={i}
                        className={`skill-author__lint skill-author__lint--${h.severity}`}
                      >
                        <span className="skill-author__lint-glyph" aria-hidden>
                          {h.severity === 'warn' ? '⚠' : 'ⓘ'}
                        </span>
                        <span>{h.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <ol className="skill-author__steps">
                  {compiled.steps.map((s) => (
                    <li key={s.id} className="skill-author__step">
                      <strong>{s.title}</strong>
                      {s.requiresApproval && (
                        <span className="ot-pill ot-pill--accent">approval</span>
                      )}
                      {s.tool && (
                        <span className="ot-pill">via {s.tool}</span>
                      )}
                      {s.body && <p>{s.body}</p>}
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="ot-micro">compiling…</p>
            )}
          </div>
          <div className="skill-author__actions">
            <button
              type="button"
              className="ot-btn"
              onClick={() => void save()}
              disabled={busy || !compiled}
            >
              {busy ? 'Saving…' : 'Save skill'}
            </button>
            <button
              type="button"
              className="ot-btn ot-btn--ghost"
              onClick={() => {
                setOpen(false);
                setSaved(null);
              }}
            >
              Cancel
            </button>
            {saved && (
              <span className="ot-micro skill-author__saved">
                ✓ saved as <code>{saved.id}</code>
                {saved.prUrl && (
                  <>
                    {' · '}
                    <a href={saved.prUrl} target="_blank" rel="noreferrer">
                      PR opened ↗
                    </a>
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

const STARTER_JSX = `<workflow name="morning-routine">
  <step name="open-inbox">Open Gmail unread last 24h</step>
  <step name="classify" requiresApproval>Group by sender type</step>
  <step name="reply" tool="researcher.research">Draft replies in my voice</step>
</workflow>`;

// Compact relative-time formatter for the recency badge — same family
// of buckets as the audit/invocations relTime helpers but tuned for
// the skill row's tight visual budget (no "just now" wording — just
// the magnitude). Hover surfaces the absolute timestamp via `title`.
function skillRecentLabel(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'in the future';
  if (diff < 60_000) return 'just now';
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * 24 * 60 * 60_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function SkillToggle({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button
      className={`skill-toggle${on ? ' skill-toggle--on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      aria-pressed={on}
      aria-label={on ? 'Disable' : 'Enable'}
    >
      <span className="skill-toggle__dot" />
    </button>
  );
}
