type CharacterQuickLinksProps = {
  armoryUrl: string;
  warcraftLogsUrl: string;
  raiderIoUrl: string;
  characterLabel?: string;
};

export default function CharacterQuickLinks({
  armoryUrl,
  warcraftLogsUrl,
  raiderIoUrl,
  characterLabel,
}: CharacterQuickLinksProps) {
  const labelSuffix = characterLabel ? ` for ${characterLabel}` : '';

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={armoryUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={characterLabel ? `Open Official Armory${labelSuffix}` : undefined}
        title={characterLabel ? `Open Official Armory${labelSuffix}` : undefined}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-bold text-zinc-300 ring-1 ring-white/5 transition-all hover:bg-white/10 hover:text-white active:scale-95"
      >
        <img
          src="/icons/blizzard.png"
          alt=""
          className="h-3.5 w-3.5 opacity-70"
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
        Official Armory
      </a>
      <a
        href={warcraftLogsUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={characterLabel ? `Open Warcraft Logs profile${labelSuffix}` : undefined}
        title={characterLabel ? `Open Warcraft Logs profile${labelSuffix}` : undefined}
        className="flex items-center gap-2 rounded-lg border border-[#ca3333]/20 bg-[#ca3333]/10 px-3 py-1.5 text-xs font-bold text-[#ff4d4d] ring-1 ring-white/5 transition-all hover:bg-[#ca3333]/20 hover:text-[#ff6666] active:scale-95"
      >
        Warcraft Logs
      </a>
      <a
        href={raiderIoUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={characterLabel ? `Open Raider.IO profile${labelSuffix}` : undefined}
        title={characterLabel ? `Open Raider.IO profile${labelSuffix}` : undefined}
        className="flex items-center gap-2 rounded-lg border border-[#fb8c00]/20 bg-[#fb8c00]/10 px-3 py-1.5 text-xs font-bold text-[#ffb74d] ring-1 ring-white/5 transition-all hover:bg-[#fb8c00]/20 hover:text-[#ffcc80] active:scale-95"
      >
        {characterLabel ? 'Raider.IO' : 'Raider.io'}
      </a>
    </div>
  );
}
