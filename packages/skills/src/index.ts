// @openthink/skills — AgentSkills loader + pack registry.
// Parses SKILL.md (YAML frontmatter + body), validates with Zod, computes a
// when_to_use embedding key for the Vectorize trigger index.

import { z } from 'zod';

export const SkillFrontmatter = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().default('0.1.0'),
  source: z
    .enum(['anthropic', 'openai', 'cloudflare', 'aihero', 'gstack', 'gbrain', 'local'])
    .default('local'),
  license: z.string().optional(),
  when_to_use: z.string().optional(),
  requires: z
    .object({
      env: z.array(z.string()).optional(),
    })
    .optional(),
  credentials: z
    .array(
      z.object({
        name: z.string(),
        label: z.string(),
        type: z.enum(['password', 'string', 'json']),
        required: z.boolean().default(false),
      }),
    )
    .optional(),
  tags: z.array(z.string()).default([]),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>;

export interface SkillBundle {
  id: string;
  frontmatter: SkillFrontmatter;
  body: string;
  files: Record<string, string>; // path -> R2 key
  hasWorkflow: boolean;
}

export interface SkillPack {
  id: 'pack:cloudflare' | 'pack:anthropic-core' | 'pack:openai-core' | 'pack:aihero' | 'pack:gstack' | 'pack:gbrain';
  defaultEnabled: boolean;
  skills: SkillBundle[];
}

// parseSkillMd — minimal YAML frontmatter splitter. We avoid a heavy YAML parser by
// constraining frontmatter to the documented shape (strings, lists, simple objects).
// Iteration 6 swaps this for `js-yaml` once skill ingestion goes live.
export function parseSkillMd(raw: string): { frontmatter: unknown; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const fmRaw = match[1] ?? '';
  const body = match[2] ?? '';
  const fm: Record<string, unknown> = {};
  // Very small subset of YAML — `key: value`, `key: [a, b]`, multi-line `key: |`.
  const lines = fmRaw.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || line.trim() === '') {
      i++;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const [, k, vRaw] = kv;
    if (vRaw === '|' || vRaw === '>') {
      const collected: string[] = [];
      i++;
      while (i < lines.length && (lines[i]?.startsWith('  ') || lines[i] === '')) {
        collected.push((lines[i] ?? '').replace(/^ {2}/, ''));
        i++;
      }
      fm[k as string] = collected.join('\n').trim();
      continue;
    }
    fm[k as string] = parseYamlScalar(vRaw ?? '');
    i++;
  }
  return { frontmatter: fm, body };
}

function parseYamlScalar(raw: string): unknown {
  const v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v.replace(/^["']|["']$/g, '');
}
