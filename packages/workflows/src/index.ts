// @openthink/workflows — Smithers JSX → Cloudflare Workflow compiler.
// Phase 1 (iteration 7): compile to Cloudflare Workflows.
// Phase 2 (P8, future): adopt Smithers' native render → execute → persist loop.

export interface SmithersTaskSpec {
  id: string;
  description: string;
  schema?: unknown;          // Zod schema for output validation
  agent?: string;            // agent identifier ('researcher', 'writer', etc.)
  requiresApproval?: boolean;
  retries?: { limit: number; backoff: 'constant' | 'linear' | 'exponential' };
}

export type SmithersNode =
  | { kind: 'task'; spec: SmithersTaskSpec }
  | { kind: 'sequence'; children: SmithersNode[] }
  | { kind: 'parallel'; children: SmithersNode[] }
  | { kind: 'loop'; until: string; maxIterations: number; child: SmithersNode }
  | { kind: 'branch'; condition: string; ifTrue: SmithersNode; ifFalse?: SmithersNode }
  | { kind: 'approval'; description: string; child: SmithersNode };

export interface CompiledPlan {
  steps: Array<{ id: string; description: string; requiresApproval?: boolean }>;
}

// Naïve flattener — produces a linear plan suitable for the iteration-1 GoalWorkflow
// stub. The full compiler emits a CFG (with branches + parallel fan-out) in iteration 7.
export function flattenPlan(root: SmithersNode): CompiledPlan {
  const steps: CompiledPlan['steps'] = [];

  function walk(node: SmithersNode): void {
    switch (node.kind) {
      case 'task':
        steps.push({
          id: node.spec.id,
          description: node.spec.description,
          requiresApproval: node.spec.requiresApproval,
        });
        return;
      case 'sequence':
        node.children.forEach(walk);
        return;
      case 'parallel':
        // Flat fallback — pretend parallel is sequence for now.
        node.children.forEach(walk);
        return;
      case 'loop':
        for (let i = 0; i < node.maxIterations; i++) {
          walk(node.child);
        }
        return;
      case 'branch':
        // Pessimistic flatten — pick truthy branch in iteration 1; real CFG in iteration 7.
        walk(node.ifTrue);
        if (node.ifFalse) walk(node.ifFalse);
        return;
      case 'approval':
        steps.push({
          id: `approval:${steps.length}`,
          description: node.description,
          requiresApproval: true,
        });
        walk(node.child);
        return;
    }
  }

  walk(root);
  return { steps };
}
