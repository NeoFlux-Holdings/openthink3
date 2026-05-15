interface Payload {
  html: string;
  title?: string;
}

interface Props {
  payload: Payload;
  compact?: boolean;
}

export function WebpageArtifact({ payload, compact }: Props) {
  // Webpage artifacts render in a sandboxed iframe via the srcdoc attribute so
  // the host page is insulated from script + style leaks. The agent emits the
  // full document body; we wrap it in a minimal scaffold so untitled pages still
  // render predictably.
  const doc = `<!doctype html><html><head><meta charset="utf-8" /><title>${payload.title ?? 'Untitled'}</title><style>body{font-family:Inter,system-ui,sans-serif;margin:0;padding:24px;background:#fafafa;color:#15140f;}</style></head><body>${payload.html}</body></html>`;
  return (
    <div className={`artifact-webpage${compact ? ' artifact-webpage--compact' : ''}`}>
      <iframe
        title={payload.title ?? 'Generated webpage'}
        srcDoc={doc}
        sandbox="allow-same-origin"
      />
      <style>{`
        .artifact-webpage { height: 100%; }
        .artifact-webpage iframe { width: 100%; height: 100%; border: 0; background: white; }
      `}</style>
    </div>
  );
}
