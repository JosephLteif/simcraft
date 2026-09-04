type ProgressTone = 'success' | 'neutral';

type ProgressSlotCardProps = {
  slotLabel: string;
  statusLabel: string;
  tone: ProgressTone;
  description: string;
  progress?: number;
  footerLeft?: string;
  footerRight?: string;
  className?: string;
};

export default function ProgressSlotCard({
  slotLabel,
  statusLabel,
  tone,
  description,
  progress,
  footerLeft,
  footerRight,
  className = '',
}: ProgressSlotCardProps) {
  const success = tone === 'success';

  return (
    <div
      className={`rounded border p-2 ${
        success ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/10 bg-black/25'
      } ${className}`.trim()}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-zinc-200">{slotLabel}</span>
        <span className={`text-[10px] font-bold ${success ? 'text-emerald-300' : 'text-zinc-500'}`}>
          {statusLabel}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-zinc-400">{description}</p>
      {typeof progress === 'number' ? (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full ${success ? 'bg-emerald-400/90' : 'bg-gold/80'}`}
            style={{ width: `${Math.max(6, Math.round(progress * 100))}%` }}
          />
        </div>
      ) : null}
      {footerLeft || footerRight ? (
        <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-400">
          <span>{footerLeft}</span>
          <span>{footerRight}</span>
        </div>
      ) : null}
    </div>
  );
}
