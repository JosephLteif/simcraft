# What's New History

This is the append-only archive for the public GitHub Pages changelog. The app popup intentionally shows only the latest update; older versions remain available on the Pages archive and at their repository release tags.

Add new work under the `Unreleased` section. Stable bump and `promote-dev` releases promote that section to the selected version and date, synchronize the app data, and update `master` for GitHub Pages. `republish` only rebuilds an existing release tag.

## Unreleased

No unreleased changes yet.

## v6.0.0 — 2026-09-06 — Release notes for v6.0.0

### New features

#### Prioritize Drop Finder activities

Drop Finder rankings now summarize which raid bosses and dungeons are the best next targets for the current character.

- Compare unique item rewards, likely upgrades, and the best DPS gain for each source.
- Select a boss or dungeon to filter the rankings to matching combinations, switch directly to another source, or use Show all sources to clear the filter.

#### Show every Mythic+ season dungeon best

The character Mythic+ overview now lists every dungeon in the active season with the character's best completed run.

- Compare each dungeon's highest completed key, Mythic+ rating, and fastest completion time in one table.
- Keep dungeons with no completed run visible so missing season coverage is easy to spot.
- Keep season-wide bests separate from the current week's vault activity and completed-run count.

#### Filter Warcraft Logs parses by difficulty

Warcraft Logs raid data now keeps LFR, Normal, Heroic, and Mythic parses distinct instead of combining every difficulty into one result.

- Request each raid difficulty explicitly and label per-boss rankings with the difficulty they came from.
- Filter the Raiding tab by Needed difficulties based on the character's Blizzard kills, All difficulties, or an individual difficulty.
- Keep the selected parse difficulties across refreshes while preserving the existing Warcraft Logs summary and report views.

#### Add optional Raider.IO and Warcraft Logs character data

Character pages can now combine Blizzard data with public Raider.IO and Warcraft Logs data without making either provider a dependency.

- Raider.IO is enabled by default and can be disabled under Settings > Integrations; it adds current-season Mythic+ scores, best runs, raid progression, attribution, and profile links.
- Warcraft Logs activates after valid credentials are saved and adds latest-zone rankings, five recent public reports with report dates and end times, and per-boss best and median parses, public kills, best amounts, metrics, and specs.
- The integration settings explain what belongs in each Warcraft Logs field and show the exact redirect host and port for the current app address; private reports and private OAuth/PKCE access are not used.
- Personal Warcraft Logs credentials take precedence over shared hosted credentials, while environment credentials take precedence over the administrator-managed fallback. Secrets remain protected and are never returned by the API.

#### Adjust cores for running simulations

Running simulations now expose a live Cores selector on the result page so CPU usage can be adjusted without cancelling the job.

- Apply a new core count while the simulation continues, including across staged SimC runs.
- Choose from one core up to the maximum worker-thread count configured when the simulation started.
- Keep the control scoped to the simulation owner and disable it when the running process cannot be controlled.

### Improvements

#### Simplify SimC profile context

Simulation pages no longer show a separate Active Character banner when the imported profile already provides that context.

- Keep the SimC export and detected character details as the focused profile context.
- Continue synchronizing the shared active-character state automatically for defaults, history, dashboard, and rich presence.

#### Refine the tracked-character dashboard

Tracked Characters now use lighter grouping and better vertical balance.

- Replace heavy nested overview and vault frames with softer surfaces, a compact stat divider, and a focused selected-character accent.
- Anchor overview actions to the bottom of the card and add breathing room below the dashboard widget.

#### Make Wishlist slot grouping easier to scan

Wishlist's By Slot view now makes each gear section easier to scan.

- Show the slot name at the top of each grouped section.
- Remove redundant nested cards so saved items use a flatter layout.

#### Rework Top Gear rankings layout

Top Gear rankings now keep item details, performance metrics, and row actions in separate responsive regions so long item and talent combinations stay readable.

- Reserve aligned columns for DPS change, DPS, item level, and actions so values and buttons do not overlap the item details.
- Move the Best marker into the item-content area and tighten row and header spacing to use the available space more effectively.
- Stack the ranking content cleanly on narrower screens while preserving the existing filters and actions.

#### Flatten character detail sections

Character tabs and simulation result sections now avoid redundant nested containers so the useful data occupies more of the page.

- Keep the specialization label and talent controls directly inside the outer Talents section instead of placing them in a second card.
- Remove the extra Raid progression frame and compact the Mythic+, Raiding, and Vault section headers and spacing.
- Preserve responsive stacking and the existing filters, refresh actions, and talent controls while reducing visual nesting.

#### Give simulation gear panels a cleaner layout

Simulation result gear panels now give the character artwork and equipped gear the space they need while keeping comparison stats easy to scan.

- Use a full-width class backdrop and centered gear arrangement inside the Character Panel, with the character render shown at full opacity.
- Place live or exact simulated stats in a separate right-hand panel at roughly 30% width on wide screens, stacking it below the gear panel on smaller screens.
- Remove the redundant Best Gear heading from inside the Character Panel.

#### Make Mythic+ overviews more compact

Character Mythic+ overviews now use a responsive widget grid to show more progression data without a long vertical stack.

- Review the Mythic+ summary and season dungeon bests side by side on desktop.
- View weekly vault progress and Raider.IO details in adjacent widgets, with vault slots arranged across the card.
- Keep the layout stacked and readable on narrow screens.

#### Make Raiding overviews more compact

Character Raiding overviews now place Blizzard progression and Warcraft Logs data in adjacent responsive widgets when both providers are enabled.

- Keep raid expansion, group, and parse controls with the Blizzard progression widget.
- View Warcraft Logs rankings and recent public reports beside raid progress on wider screens.
- Expand Blizzard progression to full width when Warcraft Logs is disabled and stack the widgets on narrow screens.

#### Share Great Vault trackers across character tabs

The Mythic+ and Raiding tabs now reuse the Vault tab's Great Vault tracker widgets.

- See the same per-slot activity popovers, completion placeholders, and unlocked item levels from every character tab.
- Keep weekly thresholds, activity details, and reward-level calculations consistent across the character experience.

#### Make tracked characters easier to scan

The dashboard's tracked-character card now uses its available space more effectively, keeping the character overview compact while giving the vault a clear vertical home.

- Review tracked characters, profile links, level, class, item level, and actions in a compact overview column.
- View Raid Vault above Mythic+ Vault in an aligned vault column with equal-height containers and responsive mobile stacking.
- Keep vault rewards inside the same aligned container without repeating the weekly progress summary.

#### Make Simulation History selection and actions clearer

Simulation History now keeps row actions visible and makes multi-row selection, filtering, and mobile scanning easier.

- Select day groups or individual rows, use Shift to select a range, and use Ctrl or Cmd to add or remove individual rows.
- Use the simulation-type filter alongside character, pin, and search filters, with the controls reordered for quicker scanning.
- Keep Pin, Rerun, and Delete actions in the row layout with clear colored buttons instead of hiding them behind hover state.

#### Reduce header clutter

The top bar now keeps its most useful actions compact without removing functionality.

- Open What's New from the profile menu instead of a separate full-width header button.
- Use App search to open the shared-result workflow; Import Result no longer occupies the top bar.
- Start the current page tour from a standalone help icon outside the mobile More menu, which is reserved for App search.

#### Make navigation and recovery easier

Core pages are easier to discover and recover when runtime game data or a network request is unavailable.

- App search now includes Queue, Raids, Saved Routes, Wishlist, Crest Upgrades, analysis tools, and Trinket Heatmaps.
- The Analysis navigation group stays active while browsing Trinket Heatmaps.
- Raids now prefer the same runtime expansion and raid catalog data used by Dungeons, while retaining artwork fallbacks and a retry action.
- Saved Routes now reports load, save, delete, and clipboard failures through in-app notifications instead of browser alerts.

#### Preserve complete raid catalogs and artwork

Raid browsing now keeps historical and current content available even when runtime data is incomplete.

- The Raids page retains the complete Blizzard raid catalog across every expansion instead of replacing it with only active-season rows.
- Current raids identified by game-context encounter or instance IDs are assigned to the active expansion when the catalog omits that metadata.
- Drop Finder and Raids share ordered artwork fallbacks and recover from failed image requests instead of leaving current raid tiles blank.

#### Make simulation recovery states actionable

Simulation workflows now expose the state needed to recover from unavailable services, saved-input edge cases, and failed settings updates.

- History character filters preserve names and realms containing hyphens, and reruns open the matching tool for Top Gear, Drop Finder, analysis, and upgrade simulations.
- Drop Finder distinguishes catalog loading, empty results, and request failures, retries catalog requests, ignores stale responses, and blocks launch until a full character export is parsed.
- Settings now reports failed simulation-setting loads and saves, retries stale loads safely, and rolls failed changes back to the last confirmed value.

#### Monitor and manage simulation queues

Simulation runs now support a configurable parallel-job limit, with clear queue visibility across desktop, hosted Docker, and the dashboard.

- Set the number of parallel simulations from Settings > Simulation Performance; Docker-hosted changes are restricted to administrators.
- Monitor running and queued simulations from the global activity card, including from a simulation's own result page.
- Queued simulations now clearly explain that SimC has not started, show the current queue position, and link directly to queue management instead of displaying misleading zero-progress details.
- Cancel queued or running simulations directly from the activity card.
- See the current queued-job count on the dashboard, which refreshes automatically while simulations are in flight.

#### Connect Wishlist and Upgrade Planner

Wishlist targets and owned-item upgrades now follow one clear gear roadmap without duplicating entries.

- Use Drop Finder to save gear you still need to Wishlist, then review or simulate those targets from the Wishlist page.
- Open Upgrade Planner to select items already present in your SimC export and add their upgrade paths to Gear Roadmap.
- See the matching character's Wishlist count and move between Drop Finder, Wishlist, and Upgrade Planner from one Upgrades navigation group.
- Reorder roadmap entries, mark upgrades complete, and track planned costs against available currencies.

#### Search and save Trinket result combinations

Upgrade Trinket results are now easier to scan and turn into Wishlist plans.

- Search by a specific trinket name or combination to narrow the result matrix.
- Save a trinket pair directly to the matching character's Wishlist; eligible upgrade trinkets are added together.
- The old-season and Turbulent trinket filter appears in results only when those candidates were included when the simulation was launched.

#### Share and open simulation results anywhere

Completed simulation results can now travel as portable `.wldps` files and open in another WhyLowDps app with the same result view.

- Use Share result file on a completed result page, then import the file from the header or by dragging it into the web or desktop app.
- On Windows, double-clicking a `.wldps` file launches WhyLowDps when it is closed or focuses the existing app when it is already running.
- Shared results include the display data needed for review without requiring the original simulation job or account.

#### Understand result variation at a glance

Result pages now place a clearer analysis section at the bottom, helping you interpret DPS variation and compare upgrades without overreacting to simulation noise.

- View an estimated DPS distribution with P5, P25, P50, P75, and P95 percentile markers.
- See a 95% confidence interval for the reported DPS mean when iteration data is available.
- Compare Top Gear deltas against an uncertainty threshold labeled Meaningful, Within noise, or Needs more data.
- Read stat plots against a visible baseline and compare stat weights using ranked relative bars.
- The Result Insights section starts collapsed so the primary result remains the first thing you see.

#### Enrich character detail pages

Character detail pages now bring profile, progression, profession, and external character information together in the Profile tab.

- See active specialization, faction, guild, achievement points, item levels, Mythic+ score, highest key, top dungeon, weekly vault progress, and current-season raid progress when Blizzard provides the data.
- Review primary and secondary professions with their available skill-point progress in a card styled with the character attributes.
- Open consistent Armory, Warcraft Logs, and Raider.IO links for characters with spaces, apostrophes, and realm slugs.
- Character data refreshes in the background after 15 minutes while the page is visible, keeps the last successful snapshot during failures, and recovers when the page becomes visible again.
- Mythic+ summaries use current-season best runs when the profile index does not include period best-run entries.

#### Show character artwork clearly

Character profile and character-list cards now pair Blizzard's class backgrounds with clearly visible character renders.

- Use the matching `armory_bg_class_<class>.jpg` artwork behind each character.
- Keep the character render above the card gradient at full opacity so equipment and roster views are easier to recognize.

#### Show Great Vault activity per slot

Weekly Mythic+ runs and raid boss kills are now available from every individual Great Vault slot card.

- Hover or focus a Mythic+ or Raid slot to open a game-style activity popover without permanently expanding the vault layout.
- Tap a slot on mobile to keep its activity details open, and dismiss the popover by clicking elsewhere or pressing Escape.
- Tracked-character dashboard cards and character detail pages use the same weekly activity data, so slot progress and the underlying runs or kills stay aligned.

#### Consolidate external character data

Character Mythic+ and Raiding tabs now place each provider's unique information alongside the canonical Blizzard data, so the same score and raid totals are not shown twice.

- Mythic+ keeps Blizzard's score, vault, and recent runs as the primary view and fills missing summary values from Raider.IO, with ranks, best-run scores and levels, completion dates, and direct run links shown inline.
- Raiding keeps Blizzard boss kills and difficulty data as the canonical view, adds Warcraft Logs boss metadata inline, and uses Raider.IO for active-raid AOTC and Cutting Edge milestones, achievement dates, scan freshness, attribution, and the profile link.
- Warcraft Logs remains a separate card for unique latest-zone ranking metrics and five recent public reports with start and end dates.
- Raider.IO progression and achievement entries are filtered against the active Blizzard raid list so stale or inactive raids do not reappear.

#### Default Raiding to the latest expansion

The character Raiding tab now opens on the latest concrete expansion so raid progression is immediately visible.

- The generic `Current expansion` option is no longer shown when it does not map to the character's raid data.
- The final expansion in the available raid data is selected by default, while `All expansions` remains available for browsing older content.

### Bug fixes

#### Prevent duplicate weekly Great Vault dungeon counts

Great Vault weekly Mythic+ activity now counts current-period dungeon runs once instead of counting season-best copies again.

- Keep season-best records out of weekly vault progress and per-slot activity popovers.

#### Preserve data-page state during failures

Transient refresh and mutation failures no longer turn valid page state into misleading empty screens.

- History keeps already-loaded simulation rows visible when a refresh fails and provides an inline retry action.
- History mutations now surface delete, clear, pin, and configuration failures instead of failing silently.
- Queue polling pauses while its browser tab is hidden, and row actions are disabled while a request is in flight.

#### Keep raid data complete and resilient

Raid rows now retain every real boss, including bosses with zero kills, while ignoring catalog-only trash placeholders.

- Warcraft Logs metadata is merged into the matching Blizzard boss row without replacing Blizzard kill and difficulty data.
- Provider failures, outages, rate limits, refreshes, and missing rankings leave the last usable snapshot and Blizzard raid data visible.

#### Show current raid progression

The character Raiding tab now displays current-season raid progress when the active raid pool identifies bosses instead of raid instances.

- Active raid filters now match both raid instance IDs and boss encounter IDs returned by the game data context.

#### Keep the login screen in view

The login screen now keeps the WhyLowDps logo visible on short desktop and mobile windows while allowing longer credential setup content to scroll.

- Prevented overflowing login content from being centered above the viewport.
- Preserved the centered layout when the full screen fits.

#### Surface data and UI failures safely

Data synchronization and common dialogs now make failures visible and keep keyboard users oriented.

- Initial game-data synchronization reports backend and status failures with a manual recovery action instead of leaving a misleading automatic-retry state; hidden tabs no longer continue background polling.
- Light mode now exposes only the explicit public gear catalog and conversion endpoints, keeping other gear paths protected.
- Route copy and credential setup errors use in-app feedback, while changelog, command-palette, loot, and route dialogs restore focus and support keyboard dismissal.

## v5.0.1 — 2026-08-31 — Release notes for v5.0.1

### Bug fixes

#### Keep stable release notes synchronized

Stable releases promoted from a developer build now move the release notes into the versioned archive and update the app and GitHub Pages data together.

- The promotion commit updates `master` so the published changelog cannot remain on `Unreleased` after a successful release.

## v5.0.0 — 2026-08-31 — Stable release archive

### Improvements

#### Override simulation performance per launch

Simulation launch controls now include a performance menu for one-time CPU thread overrides, while the main launch button continues to use the saved default.

- Choose Balanced, Performance, or Maximum for an individual simulation without changing Settings.

#### Configure simulation timeouts

Simulation settings now let you control how long a simulation may run and how long it may go without producing output, with a two-hour total timeout by default.

- Adjust the total and no-output timeouts from Settings > Simulation; values are saved with your account.

#### Organize settings by purpose

Settings are now grouped into focused tabs so simulation controls, default options, and application behavior are easier to find.

- Default Options has its own tab, while Clipboard Import, Close Behavior, and Share over LAN are grouped under Application.
- Removed the redundant Quick repairs panel in favor of the tab navigation.

#### Paginate large Top Gear result lists

Top Gear rankings now use fixed-size pages instead of mounting every combination in one list, keeping large result sets more responsive and reducing WebView memory use.

- Use Previous and Next to browse results; only the current page is rendered.

#### Select only eligible Top Gear items

Top Gear now offers an Eligible quick selection that keeps equipped items and selects only alternatives valid for the active character, specialization, and item-level rules.

- Use Eligible in the Top Gear quick actions to leave off-spec and low-level alternatives unselected.

#### Keep WoW tools and custom links one click away

The dashboard Quick Links widget now includes popular WoW tools such as Wowhead, Raidbots, WoWAnalyzer, Warcraft Logs, and Raider.IO, with clear icons and new-tab links.

- Add custom http:// or https:// URLs from the Quick Links editor.
- Choose an icon for each custom link from the built-in icon picker; links are saved locally with the rest of the dashboard preferences.

#### Persist recent SimC profile history

Recent SimC exports in the History list now persist locally, so they remain available after reloading the app or navigating between SimC pages.

- History remains limited to the 20 most recent exports and can still be cleared from the profile dropdown.

#### Filter legacy trinkets from Upgrade simulations

Upgrade Trinkets now defaults to current-season raid and dungeon sources, with an opt-in setting for old-season and Turbulent trinkets when those items are still relevant.

- Current-season filtering is applied before simulation combinations are generated, so excluded trinkets are not simulated.
- The setting can be enabled from the setup form or from the results view.

#### See the exact combination count before launching

Top Gear and Upgrade Compare now finish calculating the full combination count before a simulation can start, and explain clearly when the total is above the configured launch limit.

- The count continues past the configured limit so the exact total is shown.
- Simulation launch stays disabled while the count is computing or above the limit.
- Over-limit counts show the configured maximum and why the simulation cannot start.

#### Keep simulation progress visible across pages

Active simulations now remain easy to monitor after navigating to another page, with a compact progress card and a completion notification when the result is ready.

- The activity card appears on other pages and can be minimized to a small bottom-right indicator.
- The duplicate activity card is hidden while viewing that simulation's own progress or result page.

#### Keep long simulations and stage timing accurate

Simulation stage timers now use the job's persisted runtime timing, so leaving and reopening a simulation no longer resets the current stage clock. Longer simulations also have more time to finish before the total timeout is reached.

- Stage timing remains accurate through navigation, reloads, and pause/resume.
- The SimC total timeout is now two hours while the no-output timeout remains 10 minutes.

#### Rework the release pipeline

The release pipeline now separates automated developer builds from stable release promotion for a cleaner, more reliable release cycle.

- Pushes to `dev` publish the tested moving developer release.
- Stable releases can promote the tested developer build from the Release workflow.

### Bug fixes

#### Keep Full Mode after desktop updates

The desktop app now keeps your Light or Full Mode choice after an update, so returning players are not sent through the tour again.

#### Select consumables without opening a web page

Consumable choices now select directly when you click their labels, while the Wowhead link is a separate, clearly marked action.

#### Show the item's actual bonus stat

Item badges now prioritize the equipped item's bonus IDs, so bonuses such as Leech no longer appear as a stale or incorrect stat.

#### Rerun simulations with their original setup

Rerunning a saved simulation now reuses its exact SimC input, options, item data, and specialized simulation metadata, so reruns no longer start with an empty item selection.

- The new simulation opens on its running page immediately, keeping progress visible instead of running only in the background.

#### Select restored SimC profiles automatically

SimC exports restored or supplied outside the profile selector now automatically select the matching saved or recent profile instead of leaving the selector blank.

#### Use the selected target item level for trinket candidates

Trinket heatmaps now apply the selected target item level to fallback drops, preventing base-level variants from being simulated alongside the selected Myth upgrade level.

- Myth 6/6 selections no longer add raw 108 item-level variants to a 334 target simulation.

#### Show accurate Top Gear combination counts

Selecting all available gear items now keeps the selected item identities aligned with the resolved gear data, so the combination count no longer remains at zero during the selection update.

## v4.1.1 — 2026-08-25 — Release notes for v4.1.1

### Bug fixes

#### Keep loot icons and selected tooltip details in sync

Drop Finder item cards now keep their icons visible through reliable fallback sources, while Wowhead tooltips use the selected difficulty and upgrade level so item levels and stats match the card.

- Show a fallback icon when a primary game icon source is unavailable.
- Refresh tooltip data when the selected difficulty or upgrade level changes.

## v4.1.0 — 2026-08-24 — A clearer, more reliable simulation workspace

### New features

#### Explore the app with guided tours

Page-specific tours now walk you through the dashboard, simulation, upgrade, analysis, and loot workflows when you need a quick orientation.

- Start the current page tour from the help button in the header.
- Tours can follow interactive choices and continue when the next part of a workflow opens.
- Replay a completed tour whenever you want a refresher.

#### Make System Health an optional dashboard widget

System Health no longer takes up a fixed block above the dashboard. Add it only when you want a live readiness summary alongside the other dashboard widgets.

- Open Customize, choose Add Widget, and select System Health when you want the compact readiness summary on the board.
- Drag, resize, or remove the widget like the other dashboard sections; your choice is saved locally.
- Open Settings > Health for detailed diagnostics and repair actions when something needs attention.

### Improvements

#### Choose and monitor the managed SimC runtime

Hosted and desktop runtime controls now expose weekly and nightly channels, available versions, update status, and safer runtime validation.

- Select a SimC channel or a specific available runtime version from Settings > Updates.
- See the active channel and version in the admin sidebar when hosted runtime controls are available.
- Runtime updates validate the downloaded binary and retry incomplete manifest or release metadata before use.

#### Browse the permanent changelog history

The full versioned release archive now lives on the generated GitHub Pages changelog, while the in-app popup stays focused on the latest update.

- Open the archive from View changelog history in the What's New popup.
- Stable releases remain linked to their original GitHub release tags.

#### Keep readiness and runtime updates reliable

Readiness checks, staged data refreshes, managed runtime updates, and release metadata now preserve useful status and the last-known-good state when an update is incomplete.

- See the current SimC channel and version in the admin sidebar when runtime controls are available.
- Retry incomplete manifest or release metadata before activating a managed runtime update.
- Validate runtime binaries before they are used for simulations.

## v4.0.0 — 2026-08-21

### New features

#### Use separate accounts by default

Battle.net users now have separate simulations, routes, profiles, history, and browser state in desktop and hosted mode. Desktop Light mode remains a persistent device-local guest account.

#### Manage hosted users and Blizzard credentials

Hosted deployments can manage access and rotate their Blizzard application credentials without restarting the deployment.

- Configure a BattleTag allowlist and administrator/member roles.
- Disable access or revoke active sessions when needed.
- Add, rotate, select, or remove hosted Blizzard application credentials at runtime.

#### Install WhyLowDPS as a hosted PWA

The hosted web app now includes an installable manifest, service worker, offline shell, update prompt, and browser or iOS installation guidance.

#### Run a private Docker-hosted instance

WhyLowDPS now has a prebuilt amd64 Docker deployment for private, single-instance hosting with a persistent data volume, release image pinning, health checks, and backup scripts.

#### Share the desktop app over your trusted LAN

Desktop Settings can share WhyLowDPS with phones on the same trusted private network through one-time QR/link pairing and persistent paired-device management.

### Improvements

#### Use WhyLowDPS comfortably on mobile

Navigation, action bars, dense results, settings, and dialogs now adapt to smaller touch screens, including phone safe-area support and full-height mobile flows where useful.

#### Make account, dungeon, and release workflows clearer

Account switching, account actions, Light-mode raid browsing, dungeon fallbacks, Docker hosting, release assets, and the public hosting guides now preserve useful state and expose the important next action more clearly.

#### Keep running simulations and hosted data reliable

Progress, profilesets, and statistics use the available page width more effectively. Hosted game-data and SimulationCraft refreshes validate staged data and retain the last-known-good state during degraded season rollovers.

### Bug fixes

#### Keep simulation and account flows on the right route

Dungeon and Mythic+ route inputs are no longer parsed as character imports when they also contain name-like lines. Related-scenario refresh loops, account switching, and hosted Docker persistence are more reliable.

## v3.8.0 — 2026-08-16

### New features

#### Recent character search history

Find recently used characters from the header with filtering and one-click navigation.

#### Pause, resume, and rerun simulations

Control active simulations from the result screen and rerun saved inputs in one click.

#### Shared notification center

Review simulation results and app updates from persistent local notification history.

### Improvements

#### Clearer running simulation status

Progress, profilesets, and statistics now use the available page width more effectively.

### Bug fixes

#### More reliable desktop notifications

Completed simulation notifications are deduplicated and keep their in-app result action. App updates are recorded in notification history while the existing updater remains the live install flow.

## v3.7.0 — 2026-08-14

### New features

#### Setup checklist and command palette

Get a guided setup status and direct access to common workflows and repair areas.

#### Shared active-character context

Keep the active character consistent between the dashboard and simulation workspace.

### Improvements

#### Backup and restore safeguards

Export and restore versioned local simulation data while excluding credentials, tokens, caches, and runtime binaries.

### Bug fixes

#### More reliable desktop file handoff

Desktop launches now accept SimC and text files through associations, drag-and-drop, and second-instance handoff.

#### Clearer setup recovery

Setup status, repair areas, URL-addressable Settings sections, feedback semantics, and keyboard focus states are easier to find and understand.

## v3.6.0 — 2026-08-13

### New features

#### Season-aware Loot Browser

Group loot by expansion, season, and the active dungeon rotation.

#### Resizable Loot Browser instance panel

Resize the instance panel with mouse or keyboard controls.

### Bug fixes

#### More stable historical dungeon views

Active dungeons stay in the active group, source-expansion links remain available, current-season item-level controls are preserved, and incomplete metadata uses trusted fallbacks.

## v3.5.2 — 2026-07-17

### Documentation

#### Repository governance documentation

Added the project license, contribution guide, security policy, code of conduct, and roadmap.

### Improvements

#### Clearer raid-buff source badges

Hover explanations now clarify Override, Manual, and Default sources.

### Bug fixes

#### A less disruptive What's New popup

The in-app changelog no longer blocks Windows title-bar controls or window dragging.

## v3.0.1 — 2026-05-18

### Improvements

#### Structured release notes and downloads

Release artifacts include a recommended download, SHA256 checksums, and explicit Windows, SmartScreen, and Battle.net credential notes.

### New features

#### Discord invite and quick links

A first-launch Discord invite and sidebar links make community access easier.

## Release index

These stable tags are preserved in the repository. Releases whose detailed notes have not yet been migrated into the sections above remain selectable in the changelog page and link to their original release tag.

| Version | Tagged | Version | Tagged |
| --- | --- | --- | --- |
| v6.0.0 | 2026-09-06 | v5.0.1 | 2026-08-31 |
| v5.0.0 | 2026-08-31 | v4.1.1 | 2026-08-25 |
| v4.1.0 | 2026-08-24 | v4.0.0 | 2026-08-21 |
| v3.8.0 | 2026-08-16 | v3.7.0 | 2026-08-14 |
| v3.6.0 | 2026-08-13 | v3.5.2 | 2026-07-17 |
| v3.5.1 | 2026-07-17 | v3.5.0 | 2026-07-10 |
| v3.4.2 | 2026-07-07 | v3.4.1 | 2026-06-29 |
| v3.4.0 | 2026-06-23 | v3.3.1 | 2026-06-18 |
| v3.3.0 | 2026-06-16 | v3.2.0 | 2026-06-14 |
| v3.1.2 | 2026-05-25 | v3.1.1 | 2026-05-24 |
| v3.1.0 | 2026-05-19 | v3.0.1 | 2026-05-18 |
| v3.0.0 | 2026-05-18 | v2.6.0 | 2026-05-13 |
| v2.5.4 | 2026-05-12 | v2.5.3 | 2026-05-12 |
| v2.5.2 | 2026-05-11 | v2.5.1 | 2026-05-11 |
| v2.5.0 | 2026-05-11 | v2.4.0 | 2026-05-09 |
| v2.3.1 | 2026-05-08 | v2.3.0 | 2026-05-07 |
| v2.2.0 | 2026-05-06 | v2.1.0 | 2026-05-06 |
| v2.0.0 | 2026-05-05 | v1.8.0 | 2026-05-04 |
| v1.7.0 | 2026-05-03 | v1.6.0 | 2026-05-01 |
| v1.5.1 | 2026-04-29 | v1.5.0 | 2026-04-29 |
| v1.4.2 | 2026-04-28 | v1.4.1 | 2026-04-28 |
| v1.4.0 | 2026-04-28 | v1.3.1 | 2026-04-23 |
| v1.3.0 | 2026-04-23 | v1.2.4 | 2026-04-22 |
| v1.2.3 | 2026-04-21 | v1.2.2 | 2026-04-21 |
| v1.2.1 | 2026-04-21 | v1.2.0 | 2026-04-21 |
| v1.1.0 | 2026-04-20 | v1.0.2 | 2026-04-20 |
| v1.0.1 | 2026-04-20 | v1.0.0 | 2026-04-20 |
| v0.9.5 | 2026-04-19 | v0.9.4 | 2026-04-19 |
| v0.9.3 | 2026-04-19 | v0.9.2 | 2026-04-19 |
| v0.9.1 | 2026-04-18 | v0.9.0 | 2026-04-18 |
| v0.8.0 | 2026-04-14 | v0.7.1 | 2026-04-14 |
| v0.7.0 | 2026-04-14 | v0.6.1 | 2026-04-12 |
| v0.6.0 | 2026-04-12 | v0.5.0 | 2026-04-11 |
| v0.4.4 | 2026-04-11 | v0.4.3 | 2026-04-11 |
| v0.4.2 | 2026-04-11 | v0.4.1 | 2026-04-11 |
| v0.4.0 | 2026-04-11 | v0.3.0 | 2026-04-11 |
| v0.2.4 | 2026-04-09 | v0.2.3 | 2026-04-09 |
| v0.2.2 | 2026-04-09 | v0.2.1 | 2026-04-09 |
| v0.2.0 | 2026-04-09 | v0.1.0 | 2026-04-09 |