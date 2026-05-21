/* Shared inference path — wraps the Workers AI binding behind the
 * Vercel AI SDK so every agent DO (Orchestrator, Researcher, Coder,
 * Judge, MemoryAgent) calls through one helper instead of `env.AI.run`
 * directly.
 *
 * Why bother:
 *   - One choke-point where we'll later plug AI Gateway (BACKLOG §2.3)
 *     and multi-model routing (§2.4) without touching call sites.
 *   - Lets us swap models per cost class (cheap routing → Llama 8B,
 *     reasoning → Llama 70B, eventually Claude/GPT) by changing a
 *     single map.
 *   - Unlocks declarative tools via `tool({inputSchema, execute,
 *     needsApproval})` — see `worker/agents/tools/registry.ts`.
 *
 * Keeping the surface small. Two entry points:
 *   - `generate({ messages, costClass })` → text response (one-shot)
 *   - `stream({ messages, costClass, tools })` → an AsyncIterable of
 *     text deltas. Callers consume tokens and forward them over WS.
 *
 * Backwards compatible — until every call site moves over, the legacy
 * `env.AI.run(...)` path keeps working alongside this.
 */
import { createWorkersAI, type WorkersAI } from 'workers-ai-provider';
import {
  generateText,
  streamText,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
} from 'ai';

import type { Env } from '../env';

/**
 * Cost class drives the model picker. The names are intentional — the
 * caller declares intent, not a specific model, so we can re-tune the
 * mapping when better models land without chasing call sites.
 *
 *   cheap     — fast routing, classification, summarization
 *   reasoning — multi-step planning, judging, retrieval re-ranking
 *   long      — long-context jobs (8k+ messages, large docs)
 *   embed     — text → vector for Vectorize
 */
export type CostClass = 'cheap' | 'reasoning' | 'long' | 'embed';

/**
 * Model map keyed by cost class. Each value is a Workers AI model
 * identifier. Add a model here, then call inference.generate({
 * costClass: 'reasoning' }) and the new model lights up everywhere.
 *
 * Llama 3.1 8B stays default for cheap because it's already the model
 * the legacy `env.AI.run` calls used and the prompts are tuned for it.
 */
const MODELS: Record<CostClass, string> = {
  cheap: '@cf/meta/llama-3.1-8b-instruct',
  reasoning: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  long: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  embed: '@cf/baai/bge-base-en-v1.5',
};

interface InferenceContext {
  provider: WorkersAI;
  env: Env;
}

/** Build an inference handle bound to a specific worker request. */
export function inferenceFor(env: Env): InferenceContext {
  const provider = createWorkersAI({ binding: env.AI });
  return { provider, env };
}

export interface GenerateArgs {
  messages: ModelMessage[];
  costClass?: CostClass;
  /** Hard timeout in ms. Default 3500ms to mirror the existing race. */
  timeoutMs?: number;
}

/** One-shot text generation. Returns the assistant text. */
export async function generate(
  ctx: InferenceContext,
  args: GenerateArgs,
): Promise<{ text: string; finishReason?: string; usage?: unknown }> {
  const model = ctx.provider(modelFor(args.costClass ?? 'cheap'));
  const timeoutMs = args.timeoutMs ?? 3500;

  const result = (await Promise.race([
    generateText({ model, messages: args.messages }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('inference_timeout')), timeoutMs),
    ),
  ])) as Awaited<ReturnType<typeof generateText>>;

  return {
    text: result.text ?? '',
    finishReason: result.finishReason,
    usage: result.usage,
  };
}

export interface StreamArgs {
  messages: ModelMessage[];
  costClass?: CostClass;
  /** Optional tool set — drives the SDK's tool loop. */
  tools?: ToolSet;
  /** Cap on tool steps so a misbehaving tool can't churn forever. */
  maxSteps?: number;
  /** Caller-controlled abort. Wire to the WS close handler. */
  abortSignal?: AbortSignal;
}

/** Streaming generation. Returns the SDK's result object so the caller
 *  can pull `textStream`, `toUIMessageStreamResponse()`, or `usage`
 *  depending on context (WS broadcast vs. HTTP response). */
export function stream(
  ctx: InferenceContext,
  args: StreamArgs,
): StreamTextResult<ToolSet, never> {
  const model = ctx.provider(modelFor(args.costClass ?? 'cheap'));
  return streamText({
    model,
    messages: args.messages,
    tools: args.tools,
    abortSignal: args.abortSignal,
  });
}

/** Tiny embedding helper for memory-agent etc. Returns the raw vector. */
export async function embed(env: Env, text: string): Promise<number[] | null> {
  if (!env.AI) return null;
  try {
    const result = (await env.AI.run(MODELS.embed, { text: [text] })) as {
      data?: number[][];
    };
    return result.data?.[0] ?? null;
  } catch (err) {
    console.warn('[inference] embed failed', err);
    return null;
  }
}

function modelFor(cost: CostClass): string {
  return MODELS[cost];
}

/** Re-export the `tool()` helper from the AI SDK so call sites import
 *  declarative tool definitions from one place. */
export { tool } from 'ai';
export type { Tool, ToolSet, ModelMessage };
