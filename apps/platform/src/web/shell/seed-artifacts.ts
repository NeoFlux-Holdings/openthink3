// Demo artifacts that ship with the welcome thread so the canvas has
// something concrete to render in dev + screenshots. These get replaced
// by real agent-generated artifacts the moment the WS bridge lands and
// the orchestrator starts streaming things over.

import type { CanvasArtifact } from './canvas/Canvas';

export const SEED_ARTIFACTS: CanvasArtifact[] = [
  {
    id: 'doc-1',
    type: 'document',
    title: 'Weekly digest — research focus',
    version: 1,
    r2Key: 'demo/doc-1.md',
    createdAt: Date.now(),
    payload: {
      title: 'Weekly digest',
      body: `## Top three this week
- Cloudflare Sandbox went GA — code execution finally has a per-user container
- Browser Rendering added persistent sessions — research agents can keep cookies
- Agents SDK 0.12 ships RPC MCP — orchestrator ↔ specialist over DO bindings

### What it means for us
The three lanes from PRD §3 collapse to one substrate. We can stop treating
sandboxed code as a research lab and start treating it as the primary
execution lane.

> "The product is the deployment, not the chat surface." — north star §1`,
    },
  },
  {
    id: 'code-1',
    type: 'code',
    title: 'orchestrator.ts',
    version: 3,
    r2Key: 'demo/code-1.ts',
    createdAt: Date.now(),
    payload: {
      filename: 'apps/platform/src/worker/agents/orchestrator.ts',
      language: 'typescript',
      source: `import { Agent } from "agents";

export class Orchestrator extends Agent<Env> {
  async onStart() {
    await this.addMcpServer("researcher", this.env.RESEARCHER);
    await this.addMcpServer("coder",      this.env.CODER);
    await this.addMcpServer("memory",     this.env.MEMORY);
  }

  async handleGoal(goal: string) {
    // Long-running with durability — kick to Workflow
    return await this.env.GOAL_WORKFLOW.create({
      id: crypto.randomUUID(),
      params: { goal, agentId: this.name }
    });
  }
}`,
    },
  },
  {
    id: 'table-1',
    type: 'table',
    title: 'Spend so far today',
    version: 1,
    r2Key: 'demo/table-1.json',
    createdAt: Date.now(),
    payload: {
      columns: [
        { key: 'tool', label: 'Tool' },
        { key: 'calls', label: 'Calls', align: 'right' as const },
        { key: 'avg', label: 'Avg ms', align: 'right' as const },
        { key: 'cost', label: 'Cost', align: 'right' as const },
      ],
      rows: [
        { tool: 'workers-ai/llama-3.1-70b', calls: 142, avg: 380, cost: '$0.21' },
        { tool: 'anthropic/claude-opus', calls: 14, avg: 1820, cost: '$0.94' },
        { tool: 'browser-rendering', calls: 3, avg: 4200, cost: '$0.06' },
        { tool: 'sandbox/exec', calls: 9, avg: 720, cost: '$0.03' },
        { tool: 'github-mcp', calls: 26, avg: 220, cost: '$0.00' },
      ],
    },
  },
  {
    id: 'chart-1',
    type: 'chart',
    title: 'Tokens used this week',
    version: 1,
    r2Key: 'demo/chart-1.json',
    createdAt: Date.now(),
    payload: {
      kind: 'area' as const,
      series: [
        {
          name: 'tokens',
          points: [
            { x: 'Mon', y: 12_400 },
            { x: 'Tue', y: 18_900 },
            { x: 'Wed', y: 22_300 },
            { x: 'Thu', y: 17_800 },
            { x: 'Fri', y: 28_400 },
            { x: 'Sat', y: 9_200 },
            { x: 'Sun', y: 7_600 },
          ],
        },
      ],
    },
  },
  {
    id: 'slides-1',
    type: 'slides',
    title: 'OpenThink one-pager',
    version: 1,
    r2Key: 'demo/slides-1.json',
    createdAt: Date.now(),
    payload: {
      slides: [
        {
          title: 'OpenThink',
          body: 'A personal AI agent that lives on your own Cloudflare account.',
          bullets: ['Yours, not ours', 'Ninety seconds to "hi"', 'Self-evolving in the open'],
        },
        {
          title: 'Architecture',
          bullets: [
            'One Worker per user',
            'Durable Objects for state, hibernation, alarms',
            'Workers AI + your model of choice',
            'Browser Rendering for research',
          ],
        },
        {
          title: 'What it costs',
          body: 'Free path on workers.dev. ~$12/yr for a domain. Cloudflare bills per use.',
          bullets: ['$0–5/mo hobby use', '$20–50/mo heavy use', 'Hard caps you set'],
        },
      ],
    },
  },
  {
    id: 'webpage-1',
    type: 'webpage',
    title: 'Personal homepage — draft',
    version: 2,
    r2Key: 'demo/page-1.html',
    createdAt: Date.now(),
    payload: {
      title: 'Tom · personal',
      html: `<header style="padding:48px 32px;border-bottom:1px solid #e5e0d3;">
  <h1 style="font-family:Georgia,serif;font-size:48px;font-weight:400;margin:0 0 12px;letter-spacing:-0.02em;">Tom Zarebczan</h1>
  <p style="font-size:18px;color:#4a4640;max-width:48ch;">Builder of agents, video infra, and prediction markets. Currently shipping OpenThink.</p>
</header>
<section style="padding:32px;">
  <h2 style="font-family:Georgia,serif;font-weight:500;font-size:24px;">Selected work</h2>
  <ul style="line-height:1.7;color:#4a4640;">
    <li><a href="https://odysee.com">Odysee</a> — decentralised video</li>
    <li><a href="https://openthink.run">OpenThink</a> — personal AI agent on your Cloudflare</li>
    <li><a href="#">Friendly Bets</a> — curated prediction market feed</li>
  </ul>
</section>`,
    },
  },
  {
    id: 'image-1',
    type: 'image',
    title: 'Architecture diagram',
    version: 1,
    r2Key: 'demo/diagram-1.svg',
    createdAt: Date.now(),
    payload: {
      src:
        'data:image/svg+xml;utf8,' +
        encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 380" font-family="Inter,sans-serif">
  <rect width="640" height="380" fill="#FAF7F2"/>
  <g stroke="#E3DDD0" stroke-width="1.5" fill="#FFFEFB">
    <rect x="40" y="40" width="560" height="300" rx="12"/>
  </g>
  <text x="60" y="68" font-size="12" fill="#807A70" letter-spacing="2">THE USER'S WORKER · ONE PER DEPLOY</text>
  <g font-size="13" fill="#15140F">
    <rect x="80" y="100" width="140" height="60" rx="8" fill="#FBE6E1" stroke="#E85D4A"/>
    <text x="150" y="125" text-anchor="middle" font-weight="600">Orchestrator</text>
    <text x="150" y="143" text-anchor="middle" font-size="11" fill="#4A4640">AIChatAgent · DO</text>

    <rect x="260" y="100" width="140" height="60" rx="8" fill="#FFFEFB" stroke="#E3DDD0"/>
    <text x="330" y="125" text-anchor="middle" font-weight="600">Researcher</text>
    <text x="330" y="143" text-anchor="middle" font-size="11" fill="#4A4640">McpAgent · DO</text>

    <rect x="440" y="100" width="140" height="60" rx="8" fill="#FFFEFB" stroke="#E3DDD0"/>
    <text x="510" y="125" text-anchor="middle" font-weight="600">Coder</text>
    <text x="510" y="143" text-anchor="middle" font-size="11" fill="#4A4640">McpAgent · DO</text>

    <line x1="220" y1="130" x2="260" y2="130" stroke="#807A70" stroke-dasharray="2 3"/>
    <line x1="400" y1="130" x2="440" y2="130" stroke="#807A70" stroke-dasharray="2 3"/>

    <rect x="80" y="220" width="160" height="60" rx="8" fill="#F2EDE4" stroke="#E3DDD0"/>
    <text x="160" y="245" text-anchor="middle" font-weight="600">D1 · R2 · KV</text>
    <text x="160" y="263" text-anchor="middle" font-size="11" fill="#4A4640">trajectories · blobs · settings</text>

    <rect x="260" y="220" width="160" height="60" rx="8" fill="#F2EDE4" stroke="#E3DDD0"/>
    <text x="340" y="245" text-anchor="middle" font-weight="600">Vectorize · D1 FTS5</text>
    <text x="340" y="263" text-anchor="middle" font-size="11" fill="#4A4640">memory · skill triggers</text>

    <rect x="440" y="220" width="140" height="60" rx="8" fill="#F2EDE4" stroke="#E3DDD0"/>
    <text x="510" y="245" text-anchor="middle" font-weight="600">Workflows</text>
    <text x="510" y="263" text-anchor="middle" font-size="11" fill="#4A4640">/goal · retraining</text>
  </g>
</svg>`),
      caption: 'One Worker per user, fanned out across Durable Objects.',
    },
  },
  {
    id: 'browser-1',
    type: 'browser-session',
    title: 'research-tier-1',
    version: 1,
    r2Key: 'demo/browser-1.json',
    createdAt: Date.now(),
    payload: {
      sessionId: 'sess_research_tier_1',
      url: 'https://news.ycombinator.com',
      title: 'Hacker News',
      status: 'streaming' as const,
      takenOver: false,
      recentActions: [
        'navigate news.ycombinator.com',
        'scroll to top',
        'reading article 4 of 12',
        'open story · /item?id=…',
      ],
    },
  },
];
