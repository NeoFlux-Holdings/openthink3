/* Declarative tool registry.
 *
 * Adopts the agents-starter pattern: every tool is a `tool({ description,
 * inputSchema, execute, needsApproval })` object built with the Vercel AI
 * SDK. The `needsApproval` callback returns a boolean — when true, the
 * orchestrator routes the call through the existing `requestApproval`
 * flow (see orchestrator.ts) instead of executing immediately.
 *
 * Adding a new tool is a one-liner: declare a schema + describe +
 * needsApproval + execute. The registry takes care of approval routing,
 * spend accounting (per-tool cost class), and broadcasting tool-call
 * frames to the chat WS.
 *
 * v1 ships three tools as fixtures so the pattern is exercised end-to-
 * end without committing us to the specific surface area:
 *   - getWeather:    no approval, fixture data (swap for real later)
 *   - calculate:     approval over 1000 (mirrors the starter's example)
 *   - searchWeb:     approval-required (consequential, costs $)
 *
 * Real tools to wire next (BACKLOG §2.1/2.2/2.5): send_email,
 * read_calendar, mcp_proxy. Each can land as one block in this file.
 */
import { tool } from 'ai';
import { z } from 'zod';

import type { Env } from '../../env';

/** Cost class drives the spend accounting + AI model picker. */
export type ToolCostClass = 'cheap' | 'medium' | 'expensive';

export interface ToolMeta {
  /** Per-tool spend in cents (estimated). Used by spend-cap gating. */
  estCostCents?: number;
  costClass?: ToolCostClass;
}

interface ToolContext {
  env: Env;
  /** Called when the tool needs approval. Returns once the user responds. */
  requestApproval: (req: {
    threadId: string;
    kind: 'tool' | 'send' | 'spend' | 'other';
    title: string;
    body?: string;
    meta?: string;
    costCents?: number;
    context?: Record<string, unknown>;
  }) => Promise<'approve' | 'deny' | 'edit'>;
  threadId: string;
}

/**
 * Build the v1 tool set. Pass in a context that wires approval routing
 * + env access. The shape matches `ai-sdk`'s `ToolSet` so the result
 * can be handed straight to `streamText({ tools })` once we move the
 * orchestrator to streaming.
 *
 * For the current intent-routing path we don't pass these into
 * `streamText` directly — instead the orchestrator pulls a tool by name
 * via `runTool(name, args)` below. Either path works; the tool
 * definitions are the same.
 */
export function buildTools(ctx: ToolContext) {
  return {
    getWeather: tool({
      description: 'Get the current weather for a city. No approval — read-only.',
      inputSchema: z.object({
        city: z.string().describe('City name'),
      }),
      execute: async ({ city }) => {
        // Fixture data. Swap for Open-Meteo / WeatherAPI when we wire
        // BACKLOG §2.0 (real-world integrations).
        const conditions = ['sunny', 'cloudy', 'rainy', 'snowy'] as const;
        return {
          city,
          temperature: Math.floor(Math.random() * 30) + 5,
          condition: conditions[Math.floor(Math.random() * conditions.length)],
          unit: 'celsius',
        };
      },
    }),

    calculate: tool({
      description:
        'Perform a math calculation with two numbers. Operations with abs values over 1000 require approval.',
      inputSchema: z.object({
        a: z.number().describe('First number'),
        b: z.number().describe('Second number'),
        operator: z.enum(['+', '-', '*', '/', '%']).describe('Arithmetic operator'),
      }),
      // The same pattern the agents-starter showcases — `needsApproval`
      // is read by the orchestrator before invoking execute. If true,
      // we route through requestApproval and only continue on 'approve'.
      needsApproval: async ({ a, b }: { a: number; b: number }) =>
        Math.abs(a) > 1000 || Math.abs(b) > 1000,
      execute: async ({ a, b, operator }) => {
        const ops: Record<string, (x: number, y: number) => number> = {
          '+': (x, y) => x + y,
          '-': (x, y) => x - y,
          '*': (x, y) => x * y,
          '/': (x, y) => x / y,
          '%': (x, y) => x % y,
        };
        if (operator === '/' && b === 0) return { error: 'Division by zero' };
        const fn = ops[operator];
        if (!fn) return { error: 'Unsupported operator' };
        return { expression: `${a} ${operator} ${b}`, result: fn(a, b) };
      },
    }),

    searchWeb: tool({
      description:
        'Search the web for a query — costs ~$0.02 per call. Always requires approval.',
      inputSchema: z.object({
        query: z.string().describe('Search query'),
      }),
      needsApproval: async () => true, // Always asks; consequential.
      execute: async ({ query }) => {
        // Fixture until we wire a real search provider (Brave Search API
        // or similar). Returns enough shape for the assistant to keep
        // its response useful without pretending to know more than it does.
        return {
          query,
          summary:
            '(search fixture — wire a real web-search provider via BACKLOG §2.0)',
          sources: [],
        };
      },
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Approval-aware runner                                              */
/* ------------------------------------------------------------------ */

/**
 * Resolve a tool by name and run it through the approval gate. Returns
 * the tool output, or a denial marker if the user rejected. Throws on
 * schema-validation failure or tool-execution exceptions so the caller
 * can decide how to surface them.
 *
 * Usage from the Orchestrator:
 *   const tools = buildTools({ env, requestApproval, threadId });
 *   const out = await runTool(tools, 'calculate', { a: 12, b: 34, operator: '+' });
 */
export async function runTool<TName extends string>(
  tools: ReturnType<typeof buildTools>,
  name: TName,
  args: unknown,
  ctx: ToolContext,
): Promise<{ ok: true; output: unknown } | { ok: false; reason: 'denied' | 'unknown_tool' | 'invalid_args' | 'execute_failed'; detail?: string }> {
  const def = (tools as Record<string, unknown>)[name];
  if (!def) return { ok: false, reason: 'unknown_tool' };

  // Validate args via the tool's schema.
  const schema = (def as { inputSchema?: { parse?: (x: unknown) => unknown } }).inputSchema;
  let parsed: unknown = args;
  if (schema && typeof schema.parse === 'function') {
    try {
      parsed = schema.parse(args);
    } catch (err) {
      return { ok: false, reason: 'invalid_args', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  // Approval gate.
  const needsApprovalFn = (def as { needsApproval?: (args: unknown) => Promise<boolean> | boolean })
    .needsApproval;
  if (typeof needsApprovalFn === 'function') {
    const requires = await needsApprovalFn(parsed);
    if (requires) {
      const decision = await ctx.requestApproval({
        threadId: ctx.threadId,
        kind: 'tool',
        title: `Run ${name}`,
        body: `The agent wants to run ${name} with:\n${JSON.stringify(parsed, null, 2)}`,
        meta: `tool · awaiting approval`,
        context: { tool: name, args: parsed },
      });
      if (decision !== 'approve') return { ok: false, reason: 'denied' };
    }
  }

  // Execute.
  const execute = (def as { execute?: (args: unknown, opts?: unknown) => Promise<unknown> | unknown })
    .execute;
  if (typeof execute !== 'function') {
    return { ok: false, reason: 'execute_failed', detail: 'tool has no execute fn' };
  }
  try {
    const output = await execute(parsed, {});
    return { ok: true, output };
  } catch (err) {
    return {
      ok: false,
      reason: 'execute_failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Lists every tool's metadata so the chat UI can show what's available. */
export function listTools(tools: ReturnType<typeof buildTools>) {
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: (def as { description?: string }).description ?? '',
    needsApproval: typeof (def as { needsApproval?: unknown }).needsApproval === 'function',
  }));
}
