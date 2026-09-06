export default function RankingsHeader() {
  return (
    <div className="hidden px-4 pb-2 pt-1.5 xl:block">
      <div className="grid items-center gap-x-6 border-b border-white/10 pb-3 xl:grid-cols-[minmax(0,1fr)_35.25rem]">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="w-6 shrink-0 text-right text-[12px] uppercase tracking-[0.15em] text-zinc-300">
            #
          </span>
          <span className="text-[12px] uppercase tracking-[0.15em] text-zinc-300">
            Items & Talents
          </span>
        </div>
        <div className="grid grid-cols-[8rem_5rem_7rem_13rem] gap-3">
          <span className="text-right text-[12px] uppercase tracking-[0.15em] text-zinc-300">
            DPS Change
          </span>
          <span className="text-right text-[12px] uppercase tracking-[0.15em] text-zinc-300">
            DPS
          </span>
          <span className="text-right text-[12px] uppercase tracking-[0.15em] text-zinc-300">
            Item Level
          </span>
          <span className="text-right text-[12px] uppercase tracking-[0.15em] text-zinc-300">
            Action
          </span>
        </div>
      </div>
    </div>
  );
}
