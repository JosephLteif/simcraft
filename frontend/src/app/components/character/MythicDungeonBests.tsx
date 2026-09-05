import type { getMythicDungeonBests } from '../../lib/character-panel-utils';

export default function MythicDungeonBests({
  dungeons,
  seasonLoaded,
}: {
  dungeons: ReturnType<typeof getMythicDungeonBests>;
  seasonLoaded: boolean;
}) {
  return (
    <section aria-label="Season dungeon bests" className="border-t border-white/5 pt-3">
      <h4 className="text-xs font-bold tracking-wider text-zinc-400 uppercase">
        Season dungeon bests
      </h4>
      <p className="mt-1 mb-3 text-[11px] text-zinc-500">
        {seasonLoaded
          ? 'Highest completed key per dungeon this season. Fastest run breaks ties.'
          : 'Season records unavailable. Showing available runs.'}
      </p>
      {dungeons.length ? (
        <table className="w-full table-fixed text-left text-xs">
          <thead className="text-[11px] text-zinc-500">
            <tr>
              <th scope="col" className="pb-2 font-medium">
                Dungeon
              </th>
              <th scope="col" className="w-12 pb-2 text-right font-medium sm:w-16">
                Key
              </th>
              <th scope="col" className="w-14 pb-2 text-right font-medium sm:w-20">
                Rating
              </th>
              <th scope="col" className="w-16 pb-2 text-right font-medium sm:w-24">
                Best time
              </th>
            </tr>
          </thead>
          <tbody>
            {dungeons.map((dungeon) => (
              <tr key={dungeon.dungeon} className="border-t border-white/5 odd:bg-white/[0.02]">
                <th scope="row" className="py-2 pr-2 pl-2 font-medium text-zinc-200">
                  <div className="flex items-center gap-2">
                    {dungeon.imageUrl && (
                      <img
                        src={dungeon.imageUrl}
                        alt=""
                        className="hidden h-8 w-8 shrink-0 rounded object-cover sm:block"
                      />
                    )}
                    <span className="min-w-0 break-words">{dungeon.dungeon}</span>
                  </div>
                </th>
                <td className="py-2 text-right font-mono font-bold text-zinc-100">
                  {dungeon.level ? `+${dungeon.level}` : seasonLoaded ? '0' : '-'}
                </td>
                <td className="text-gold py-2 text-right font-mono">
                  {dungeon.score ?? (seasonLoaded && !dungeon.level ? '0' : '-')}
                </td>
                <td
                  className={`py-2 text-right font-mono ${dungeon.timed === true ? 'text-emerald-300' : dungeon.timed === false ? 'text-amber-300' : 'text-zinc-400'}`}
                >
                  <span
                    title={
                      dungeon.timed === true
                        ? 'Timed'
                        : dungeon.timed === false
                          ? 'Over time'
                          : undefined
                    }
                  >
                    {dungeon.duration}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-zinc-500">No dungeon runs available.</p>
      )}
    </section>
  );
}
