interface Payload {
  src: string;
  alt?: string;
  caption?: string;
}

interface Props {
  payload: Payload;
  compact?: boolean;
}

export function ImageArtifact({ payload, compact }: Props) {
  return (
    <div className={`artifact-image${compact ? ' artifact-image--compact' : ''}`}>
      <img src={payload.src} alt={payload.alt ?? ''} />
      {payload.caption && !compact && <div className="artifact-image__caption">{payload.caption}</div>}
      <style>{`
        .artifact-image { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 12px; background: var(--ot-bg-soft); }
        .artifact-image img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: var(--ot-radius-sm); }
        .artifact-image__caption { font-size: 12px; color: var(--ot-ink-mute); margin-top: 8px; text-align: center; }
        .artifact-image--compact { padding: 6px; }
      `}</style>
    </div>
  );
}
