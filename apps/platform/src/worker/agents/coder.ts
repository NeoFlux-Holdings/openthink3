// Coder — specialist DO for code-shaped tasks. Two methods:
//
//   - review(args)   take a code snippet, return a structured review:
//                    issues[] / suggestions[] / risk score / what-the-code-does.
//                    Real Workers AI call — works locally + in prod.
//
//   - exec(args)     execute the code in a sandbox. Production-only: this
//                    requires the `@cloudflare/sandbox` package + a Container
//                    binding, neither of which the local miniflare supports.
//                    Until that lands we return a deterministic "sandbox
//                    unavailable" envelope so the orchestrator can still
//                    surface the review path as a useful fallback.
//
// The orchestrator's intent-detector currently maps "code" mentions to
// `exec` — once exec is live, `review` becomes the smart-fallback when the
// user opts out of execution.

import { BaseRpcAgent } from './base-rpc-agent';
import { generate as aiGenerate, inferenceFor } from '../lib/inference';

interface ReviewArgs {
  source?: string;
  language?: string;
  goal?: string;
}

interface ReviewResult {
  summary: string;
  issues: Array<{ severity: 'low' | 'med' | 'high'; line?: number; note: string }>;
  suggestions: string[];
  riskScore: number;
  language: string;
  bytes: number;
}

export class Coder extends BaseRpcAgent {
  async invoke(method: string, args: unknown): Promise<unknown> {
    switch (method) {
      case 'ping':
        return { from: 'coder', ts: Date.now() };
      case 'review':
        return this.review(args as ReviewArgs);
      case 'exec':
        // Try a review-flavored response so the orchestrator's downstream
        // surfaces have *something* useful, then attach the sandbox status.
        return this.exec(args as ReviewArgs);
      default:
        throw new Error(`unknown_method:${method}`);
    }
  }

  private async review(args: ReviewArgs): Promise<ReviewResult | { ok: false; error: string }> {
    const source = (args.source ?? '').trim();
    if (!source) return { ok: false, error: 'missing_source' };
    const language = args.language ?? guessLanguage(source);
    const goal = args.goal ?? '';
    const snippet = source.length <= 6_000 ? source : source.slice(0, 6_000) + '\n// …truncated';

    let raw = '';
    try {
      const result = await aiGenerate(inferenceFor(this.env), {
        costClass: 'reasoning',
        messages: [
          {
            role: 'system',
            content:
              'You are a senior engineer reviewing a snippet. Reply with VALID JSON only — no preamble, ' +
              'no code fence. Schema:\n' +
              '{"summary": string, "issues": [{"severity":"low|med|high","line":int|null,"note":string}], ' +
              '"suggestions": [string], "riskScore": <0..1>}\n' +
              'Be specific. Cite line numbers when possible. ' +
              'riskScore 0=perfectly safe, 1=actively dangerous. ' +
              'If the code is fine, return empty issues/suggestions arrays and a positive summary.',
          },
          {
            role: 'user',
            content:
              `Language: ${language}\n` +
              (goal ? `Goal: ${goal}\n` : '') +
              `\nCODE:\n${snippet}`,
          },
        ],
      });
      raw = result.text;
    } catch (err) {
      return {
        ok: false,
        error: 'ai_failed',
        ...({ reason: err instanceof Error ? err.message : String(err) } as object),
      } as ReviewResult & { ok: false; error: string; reason: string };
    }

    const parsed = safeParseJson(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {
        summary: 'Review produced unparseable output; raw LLM response was: ' + (raw.slice(0, 280) || '(empty)'),
        issues: [],
        suggestions: [],
        riskScore: 0.5,
        language,
        bytes: source.length,
      };
    }

    const p = parsed as {
      summary?: unknown;
      issues?: unknown;
      suggestions?: unknown;
      riskScore?: unknown;
    };

    const issues: ReviewResult['issues'] = Array.isArray(p.issues)
      ? p.issues
          .filter((i) => i && typeof i === 'object')
          .map((i): ReviewResult['issues'][number] => {
            const obj = i as { severity?: unknown; line?: unknown; note?: unknown };
            const severity: 'low' | 'med' | 'high' =
              obj.severity === 'high' || obj.severity === 'med' ? obj.severity : 'low';
            return {
              severity,
              line: typeof obj.line === 'number' ? obj.line : undefined,
              note: typeof obj.note === 'string' ? obj.note : '',
            };
          })
          .filter((i) => i.note.length > 0)
      : [];

    const suggestions = Array.isArray(p.suggestions)
      ? p.suggestions.filter((s): s is string => typeof s === 'string')
      : [];

    const riskScore = clamp01(Number(p.riskScore));
    const summary = typeof p.summary === 'string' && p.summary ? p.summary : 'No summary returned.';

    return {
      summary,
      issues,
      suggestions,
      riskScore,
      language,
      bytes: source.length,
    };
  }

  private async exec(args: ReviewArgs): Promise<unknown> {
    // Production path: dynamic-import @cloudflare/sandbox. The package is an
    // optionalDependency so local dev doesn't fail when it can't fetch (no
    // Container binding in miniflare anyway). When the binding is available
    // we spin up a fresh container, write the source, and execute via the
    // appropriate runtime (node for JS/TS, python for py, bash for shell).
    const source = (args.source ?? '').trim();
    if (!source) return { ok: false, error: 'missing_source' };
    const language = args.language ?? guessLanguage(source);
    try {
      const mod = (await import('@cloudflare/sandbox' as never)) as unknown as {
        getSandbox?: (
          ns: unknown,
          name: string,
        ) => Promise<{
          exec(cmd: string, opts?: { cwd?: string; env?: Record<string, string> }): Promise<{
            stdout: string;
            stderr: string;
            exitCode: number;
          }>;
          writeFile(path: string, content: string): Promise<void>;
        }>;
      };
      const sandboxNs = (this.env as unknown as { SANDBOX?: unknown }).SANDBOX;
      if (mod.getSandbox && sandboxNs) {
        const sandbox = await mod.getSandbox(sandboxNs, `coder-${crypto.randomUUID().slice(0, 8)}`);
        const ext =
          language === 'python' ? 'py' :
          language === 'typescript' ? 'ts' :
          language === 'go' ? 'go' :
          language === 'c' ? 'c' :
          'js';
        const filename = `/tmp/snippet.${ext}`;
        await sandbox.writeFile(filename, source);
        const cmd =
          language === 'python' ? `python3 ${filename}` :
          language === 'typescript' ? `npx --yes ts-node ${filename}` :
          language === 'go' ? `go run ${filename}` :
          language === 'c' ? `gcc ${filename} -o /tmp/snippet && /tmp/snippet` :
          `node ${filename}`;
        const t0 = Date.now();
        const result = await sandbox.exec(cmd);
        return {
          ok: result.exitCode === 0,
          sandbox: 'cloudflare-sandbox',
          language,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: Date.now() - t0,
        };
      }
    } catch (err) {
      console.warn('[coder] sandbox exec failed, falling back to review', err);
    }

    // Fallback: run a review pass so the orchestrator answers something
    // specific instead of a blank "no sandbox" envelope.
    const review = await this.review(args);
    return {
      ok: 'summary' in review,
      sandbox: 'unavailable',
      note:
        'Sandbox execution requires `@cloudflare/sandbox` + a `SANDBOX` binding. ' +
        'Returning a code review instead.',
      review,
    };
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function safeParseJson(s: string): unknown {
  try {
    const stripped = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function guessLanguage(src: string): string {
  if (/^\s*(import\s|from\s|def\s|class\s)/.test(src)) return 'python';
  if (/^\s*(import\s|export\s|const\s|let\s|function\s)/.test(src)) return 'typescript';
  if (/^\s*(package\s|func\s|var\s)/.test(src)) return 'go';
  if (/^\s*#include\s/.test(src)) return 'c';
  if (/^\s*<!doctype|<html/i.test(src)) return 'html';
  return 'unknown';
}
