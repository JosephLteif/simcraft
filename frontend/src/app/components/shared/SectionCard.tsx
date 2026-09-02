import type { ReactNode } from 'react';

type SectionCardProps = {
  title: string;
  children: ReactNode;
  className?: string;
  titleClassName?: string;
  variant?: 'compact' | 'card';
};

export default function SectionCard({
  title,
  children,
  className = '',
  titleClassName = '',
  variant = 'compact',
}: SectionCardProps) {
  const containerClassName =
    variant === 'card'
      ? `card p-5 ${className}`.trim()
      : `rounded border border-white/10 bg-black/20 p-3 ${className}`.trim();
  const headingClassName =
    variant === 'card'
      ? `mb-4 text-xs font-bold tracking-wider text-zinc-500 uppercase ${titleClassName}`.trim()
      : `mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500 ${titleClassName}`.trim();

  return (
    <div className={containerClassName}>
      <p className={headingClassName}>{title}</p>
      {children}
    </div>
  );
}
