// Smithers — JSX-as-workflow authoring layer.
//
// The full vision from PRD §5 is "users author skills as JSX, compiled to
// Cloudflare Workflows". This v1 ships a much smaller compiler: it accepts a
// dialect with three element kinds and turns them into the JSON plan shape
// `PlanCard` (and downstream `GoalWorkflow`) already understand.
//
// Supported syntax:
//
//   <workflow name="morning-routine">
//     <step name="open-inbox">Open Gmail unread last 24h</step>
//     <step name="classify" requiresApproval>Group by sender type</step>
//     <step name="reply" tool="researcher.research">Draft replies in my voice</step>
//   </workflow>
//
// The compiler is intentionally hand-written: no React/Babel dependency at
// runtime, no eval. We do a small recursive-descent parse + slot/prop pull.
// Smithers grows by adding new element handlers in `compileElement`.

export interface CompiledStep {
  id: string;
  title: string;
  body: string;
  requiresApproval?: boolean;
  tool?: string;
}

export interface CompiledWorkflow {
  name: string;
  description?: string;
  steps: CompiledStep[];
}

export interface CompileResult {
  ok: boolean;
  workflow?: CompiledWorkflow;
  error?: string;
}

export function compileSkillJsx(source: string): CompileResult {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: 'empty_source' };
  let cursor = 0;

  const skipWs = () => {
    while (cursor < trimmed.length && /\s/.test(trimmed[cursor]!)) cursor++;
  };

  // Parse a tag like `<step name="x" requiresApproval>`. Returns the tag
  // name + props map + whether it was self-closing. Throws on a malformed
  // tag; the top-level catch wraps that into an `{ok: false, error}`.
  const parseTag = (): { name: string; props: Record<string, string | true>; selfClosing: boolean } => {
    if (trimmed[cursor] !== '<') throw new Error('expected_lt');
    cursor++;
    // collect name
    let name = '';
    while (cursor < trimmed.length && /[a-zA-Z0-9_-]/.test(trimmed[cursor]!)) {
      name += trimmed[cursor]!;
      cursor++;
    }
    if (!name) throw new Error('missing_tag_name');
    const props: Record<string, string | true> = {};
    skipWs();
    while (cursor < trimmed.length && trimmed[cursor] !== '>' && trimmed[cursor] !== '/') {
      let propName = '';
      while (cursor < trimmed.length && /[a-zA-Z0-9_-]/.test(trimmed[cursor]!)) {
        propName += trimmed[cursor]!;
        cursor++;
      }
      if (!propName) throw new Error('bad_prop');
      if (trimmed[cursor] === '=') {
        cursor++;
        if (trimmed[cursor] !== '"') throw new Error('expected_quoted_prop');
        cursor++;
        let value = '';
        while (cursor < trimmed.length && trimmed[cursor] !== '"') {
          value += trimmed[cursor]!;
          cursor++;
        }
        if (trimmed[cursor] !== '"') throw new Error('unclosed_prop');
        cursor++;
        props[propName] = value;
      } else {
        props[propName] = true;
      }
      skipWs();
    }
    let selfClosing = false;
    if (trimmed[cursor] === '/') {
      selfClosing = true;
      cursor++;
    }
    if (trimmed[cursor] !== '>') throw new Error('expected_gt');
    cursor++;
    return { name, props, selfClosing };
  };

  // Read until `</tag>` and return the text between.
  const readUntilClose = (tag: string): string => {
    const closeTag = `</${tag}>`;
    const end = trimmed.indexOf(closeTag, cursor);
    if (end === -1) throw new Error(`unclosed_${tag}`);
    const text = trimmed.slice(cursor, end);
    cursor = end + closeTag.length;
    return text;
  };

  try {
    skipWs();
    const open = parseTag();
    if (open.name !== 'workflow') {
      return { ok: false, error: `expected_workflow_root, got_${open.name}` };
    }
    const steps: CompiledStep[] = [];

    while (true) {
      skipWs();
      if (cursor >= trimmed.length) throw new Error('unexpected_eof');
      if (trimmed.slice(cursor, cursor + 11) === '</workflow>') {
        cursor += 11;
        break;
      }
      const stepTag = parseTag();
      if (stepTag.name !== 'step') {
        return { ok: false, error: `expected_step, got_${stepTag.name}` };
      }
      const body = stepTag.selfClosing ? '' : readUntilClose('step');
      const name = String(stepTag.props.name ?? `step-${steps.length + 1}`);
      const id = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      steps.push({
        id: id || `step-${steps.length + 1}`,
        title: name,
        body: body.trim(),
        requiresApproval: stepTag.props.requiresApproval === true,
        tool:
          typeof stepTag.props.tool === 'string'
            ? (stepTag.props.tool as string)
            : undefined,
      });
    }

    return {
      ok: true,
      workflow: {
        name: String(open.props.name ?? 'untitled-skill'),
        description:
          typeof open.props.description === 'string'
            ? (open.props.description as string)
            : undefined,
        steps,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Reverse direction: given a JSON plan (the shape `PlanCard` renders),
// emit JSX so the Train mode "view as JSX" toggle can show the same plan
// in the authoring form.
export function renderPlanAsJsx(plan: CompiledStep[], name = 'this-skill'): string {
  if (plan.length === 0) return `<workflow name="${name}" />`;
  const lines: string[] = [`<workflow name="${name}">`];
  for (const step of plan) {
    const attrs = [
      `name="${step.id}"`,
      step.requiresApproval ? 'requiresApproval' : '',
      step.tool ? `tool="${step.tool}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (!step.body) {
      lines.push(`  <step ${attrs} />`);
    } else {
      lines.push(`  <step ${attrs}>${step.body}</step>`);
    }
  }
  lines.push('</workflow>');
  return lines.join('\n');
}
