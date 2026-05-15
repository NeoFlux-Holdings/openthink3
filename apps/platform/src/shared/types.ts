// Types shared between the Worker and the browser-side UI.
// Keep this file free of any runtime imports.

export type ApprovalMode = 'full_auto' | 'smart_auto' | 'manual';

export type ToolPolicyScope = 'always' | 'session' | 'never';

export interface AgentIdentity {
  name: string;            // e.g. "drift-wombat"
  email: string;           // owner email gating Access
  hostname: string;        // e.g. "drift-wombat.workers.dev"
  createdAt: number;
  version: string;
}

export interface UserSettings {
  mode: ApprovalMode;
  spendCapCents: number;
  spentCentsToday: number;
  dailyResetAt: number;
  timezone: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  artifacts?: ArtifactRef[];
  createdAt: number;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  status: 'pending' | 'approved' | 'running' | 'done' | 'error';
  estCostCents?: number;
  result?: unknown;
}

export type ArtifactType =
  | 'document'
  | 'browser-session'
  | 'webpage'
  | 'slides'
  | 'table'
  | 'image'
  | 'code'
  | 'chart';

export interface ArtifactRef {
  id: string;
  type: ArtifactType;
  title: string;
  version: number;
  r2Key: string;
  thumbnailKey?: string;
  createdAt: number;
}

export interface DeployStep {
  id: string;
  label: string;
  state: 'pending' | 'running' | 'done' | 'error';
  durationMs?: number;
  log?: string[];
  error?: string;
}

export interface DeployState {
  agentName: string;
  steps: DeployStep[];
  startedAt: number;
  finishedAt?: number;
  hostname?: string;
}

export type CanvasWindowMode = 'single' | 'grid' | 'stack';

export type ComposerMode = 'auto' | 'plan' | 'train';

export interface Skill {
  id: string;
  name: string;
  description: string;
  source: 'anthropic' | 'openai' | 'cloudflare' | 'aihero' | 'gstack' | 'gbrain' | 'local';
  version: string;
  enabled: boolean;
  whenToUse: string;
  tags: string[];
  hasWorkflow: boolean;
  lastUsed?: number;
}

export interface Memory {
  id: string;
  category: 'user_facts' | 'active_work' | 'preferences' | 'domain_knowledge' | 'people';
  content: string;
  importance: number;
  whenToUse: string;
  createdAt: number;
  updatedAt: number;
}

export interface Trajectory {
  turnId: string;
  agentId: string;
  threadId: string;
  input: ChatMessage;
  toolCalls: ToolCall[];
  output: ChatMessage;
  model: string;
  scoreOverall?: number;
  scoreSchema?: number;
  scoreRelevancy?: number;
  scoreFaithfulness?: number;
  createdAt: number;
}
