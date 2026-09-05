# Changelog

All notable changes to WhyLowDPS should be documented in this file.

The format is based on Keep a Changelog and this project uses semantic versioning for stable releases.

## [Unreleased]

### Added

- Drop Finder rankings now include raid-boss and dungeon activity priorities with unique reward counts, likely-upgrade counts, and best DPS gain; selecting a source filters to matching combinations and can be cleared with Show all sources.
- Character Mythic+ overviews now list every active-season dungeon with its highest completed key, rating, and best completion time while keeping incomplete dungeons visible and weekly vault activity separate.
- Warcraft Logs raid parses now request LFR, Normal, Heroic, and Mythic rankings separately; the Raiding tab can show needed difficulties, all difficulties, or one selected difficulty while preserving the difficulty choice across refreshes.
- Character pages now support optional public Raider.IO and Warcraft Logs integrations: Raider.IO provides current-season Mythic+ scores, best runs, raid progression, attribution, and profile links, while Warcraft Logs provides latest-zone rankings, five dated recent reports, and per-boss parse, kill, amount, metric, and spec data.
- Simulation queue management now supports a configurable parallel-job limit across desktop and private Docker hosting; Docker-hosted changes are restricted to administrators.
- The global activity card now shows running and queued simulations, remains available on result pages, and supports cancellation.
- The dashboard now shows a live Queued Sims count while simulations are in flight.
- Wishlist and Upgrade Planner now share a character-scoped Gear Roadmap: Wishlist tracks items to obtain, while the roadmap tracks upgrades for owned items without duplicating the same list.
- Drop Finder, Wishlist, and Upgrade Planner are grouped together with direct navigation and clearer guidance for moving an item from acquisition to upgrade planning.
- Completed simulation results can now be exported as portable `.wldps` files, imported by picker or drag-and-drop, and opened directly by the desktop app through Windows file association.

### Changed

- Character Mythic+ overviews now use a responsive widget grid, placing the summary beside season dungeon bests and the weekly vault beside Raider.IO details; vault slots are arranged horizontally on wider screens and stack on mobile.
- Character Raiding overviews now use the responsive widget grid to place Blizzard progression beside Warcraft Logs when enabled, expand Blizzard content to full width otherwise, and stack the widgets on mobile.
- Character Mythic+ and Raiding tabs now reuse the Vault tab's Great Vault tracker widgets, including per-slot activity popovers, completion placeholders, and unlocked item levels.
- The tracked-character dashboard card now uses a compact character overview beside a vertically stacked vault column, with Raid Vault above Mythic+ Vault, equal-height desktop containers, responsive mobile stacking, and no redundant weekly progress strip.
- Great Vault slots now reveal their weekly Mythic+ runs or raid boss kills in game-style per-slot popovers on hover, focus, or touch, with the same activity details on tracked characters and character detail pages.
- Simulation History now supports day-group, Shift-range, and Ctrl/Cmd additive selection, adds a simulation-type filter, improves mobile filter ordering, and keeps colored Pin, Rerun, and Delete actions visible in each row.
- Header actions are now less crowded: What's New lives in the profile menu, shared-result import is available through App search, and the current page tour uses a standalone help icon outside the mobile More menu.
- App search now includes Queue, Raids, Saved Routes, Wishlist, Crest Upgrades, analysis tools, and Trinket Heatmaps, while the Analysis navigation group correctly stays active on Trinket Heatmaps.
- The Raids page now prefers the runtime expansion and raid catalog data shared with Dungeons, while retaining artwork fallbacks and a retry action.
- The Raids page now retains the complete Blizzard raid catalog across all expansions, assigns missing current-expansion metadata from game context, and shares resilient artwork fallbacks with Drop Finder.
- Saved Routes now uses in-app success and error feedback for loading, saving, deleting, and copying route data.
- Settings > Integrations now explains every Warcraft Logs credential field, shows the exact current redirect host and port, and applies personal, environment, and administrator-managed credential precedence without exposing secrets.
- Queued simulations now clearly explain that SimC has not started, show the current queue position, and link directly to queue management instead of displaying misleading zero-progress details.
- Result pages now place a clearer analysis section at the bottom with an estimated DPS distribution, percentile markers, confidence intervals, and uncertainty-aware comparison guidance.
- Top Gear deltas now show whether their difference is meaningful, within simulation noise, or needs more data; stat plots include a baseline and stat weights show ranked relative values.
- Result Insights starts collapsed by default so the primary result content stays focused until deeper analysis is requested.
- Upgrade Trinket results now support searching specific trinkets or combinations, saving eligible pairs directly to the character's Wishlist, and showing the legacy-trinket filter only when it was enabled at launch.
- Character detail pages now show profile, Mythic+, raid, vault, profession, and external-profile information in the Profile tab, with 15-minute visible-page refreshes that retain the last successful snapshot if a background refresh fails.
- Character profile and character-list cards now use matching Blizzard class backgrounds with full-opacity character renders for clearer artwork.
- Character Mythic+ and Raiding tabs now consolidate external data into the canonical Blizzard cards: Raider.IO details, active-raid achievement milestones, scan freshness, attribution, and profile links appear inline without duplicate progression totals, while Warcraft Logs keeps its unique rankings, dated reports, and per-boss metadata.
- The character Raiding tab now hides the generic Current expansion option and selects the latest concrete expansion by default, while keeping All expansions available for older progression.
- History character filters now preserve names and realms containing hyphens, and saved simulation reruns open the matching tool for each simulation type.
- Drop Finder now distinguishes catalog loading, empty results, and request failures, retries catalog requests, ignores stale responses, and requires a parsed character export before launch.
- Settings now reports failed simulation-setting loads and saves, retries stale loads safely, and rolls failed changes back to the last confirmed value.

### Fixed

- History now preserves already-loaded simulation rows when refreshes fail, reports mutation errors, and offers an inline retry action; queue polling also pauses for hidden tabs and disables busy row actions.
- Warcraft Logs data now merges into Blizzard boss rows without replacing Blizzard data, preserves snapshots through provider failures and refreshes, and keeps real zero-kill bosses visible while hiding catalog-only trash placeholders.
- Raider.IO raid achievements now request active raid slugs and filter against active Blizzard raids, preventing stale expansion entries such as legacy progression from appearing in the current-season card.
- Character Raiding tabs now show current-season progression when active raid pools identify bosses by encounter ID instead of raid instance ID.
- Login screen content now grows and scrolls on short desktop and mobile windows, keeping the WhyLowDps logo fully visible.
- Initial game-data synchronization now reports backend and status failures with a manual recovery action instead of leaving a misleading automatic-retry state, and hidden tabs no longer continue background polling.
- Light mode now exposes only the explicit public gear catalog and conversion endpoints, keeping other gear paths protected.
- Route copy and credential setup errors now use in-app feedback, while changelog, command-palette, loot, and route dialogs restore focus and support keyboard dismissal.

## [5.0.1] - 2026-08-31

### Fixed

- Stable releases promoted from a developer build now synchronize the versioned changelog data and update `master` for GitHub Pages.

## [5.0.0] - 2026-08-31

### Changed

- Simulation launch controls now include one-time Balanced, Performance, and Maximum CPU thread overrides while the main launch button continues to use the saved default.
- Simulation settings now support configurable total and no-output timeouts, defaulting to a two-hour total runtime and ten minutes without output.
- Settings are now grouped into focused Health, Simulation, Defaults, Application, Integrations, Data Cache, Updates, and About tabs; application behavior controls are separated from simulation controls and the redundant Quick repairs panel is removed.
- Top Gear rankings now use fixed-size pages instead of rendering every combination at once, reducing WebView memory use for large result sets.
- Top Gear now offers an Eligible quick selection that keeps equipped items and selects only alternatives valid for the active character, specialization, and item-level rules.
- Dashboard Quick Links now include popular WoW tools and support custom http:// or https:// URLs with selectable icons, persisted locally and opened in a new tab.
- Recent SimC exports in the History list now persist locally across reloads and navigation, while remaining limited to the 20 most recent profiles and clearable from the profile dropdown.
- Upgrade Trinkets now default to current-season raid and dungeon sources, with an opt-in setting for old-season and Turbulent trinkets; excluded trinkets are removed before simulation combinations are generated.
- Top Gear and Upgrade Compare now calculate the full combination count before launch, keep simulation start disabled while it is computing, and explain when the exact total exceeds the configured limit.
- Active simulations now remain monitorable across pages with a minimizable progress indicator, while the duplicate indicator is hidden on the simulation's own progress or result page; completion notifications still link back to the result.
- Simulation stage timers now use persisted job timing across navigation, reloads, and pause/resume, and the SimC total timeout is now two hours while the no-output timeout remains 10 minutes.
- The release pipeline now separates automated developer builds from stable release promotion for a cleaner, more reliable release cycle.

### Fixed

- The desktop app now persists the Light or Full Mode choice through updates and preserves completed guided tours for returning users.
- Consumable picker labels now select their option directly; the separate, clearly labeled external-link button opens Wowhead.
- Item bonus-stat badges now prioritize the equipped item's bonus IDs, preventing stale cached data from showing an incorrect stat such as Avoidance instead of Leech.
- Rerunning a saved simulation now preserves its exact SimC input, options, item data, and specialized simulation metadata, then opens the new simulation's running page immediately instead of running only in the background.
- Trinket heatmaps now use the selected target item level for fallback drops, so Myth 6/6 no longer simulates raw 108 item-level variants alongside 334 candidates.
- Top Gear now keeps the combination count accurate when selecting all available gear items.
- SimC exports restored or supplied outside the profile selector now automatically select the matching saved or recent profile.

## [4.1.1] - 2026-08-25

### Fixed

- Drop Finder item icons now use reliable fallback sources when a game icon endpoint is unavailable.
- Wowhead loot tooltips now use the selected difficulty and upgrade level, keeping displayed item levels and stats aligned with the card.

## [4.1.0] - 2026-08-24

### Added

- Guided tours now cover the dashboard, simulation, upgrade, analysis, and loot workflows, with replay controls from the header help button.
- Managed SimC runtime controls now expose weekly and nightly channels, available versions, runtime status, and binary validation before use.
- The public changelog history is now generated and published as a versioned GitHub Pages archive linked from the app.

### Changed

- System Health is now an optional dashboard widget available from Customize, instead of taking a fixed block above the dashboard; detailed diagnostics remain in Settings > Health.

## [4.0.0] - 2026-08-21

### Added

- Multi-user ownership is now the default in desktop and hosted modes: Battle.net users have separate simulations, routes, profiles, history, and browser state, while desktop Light mode remains a persistent device-local guest account.
- Hosted user administration now supports a BattleTag allowlist, administrator/member roles, disabling access, and revoking active sessions.
- Hosted Blizzard application credentials can be added, rotated, selected, or removed at runtime without restarting the deployment.
- Hosted Light mode can now use shared simulations, results, game-data catalogs, and raid browsing without a Battle.net session; account-specific features remain protected.
- Installable PWA support for the hosted web app, including a manifest, service worker, offline shell, update prompt, and install guidance for native browser prompts, browser menus, and iOS.
- Dungeon browsing now keeps the active season first while retaining available historical encounter lists and artwork fallbacks.
- Private, single-instance Docker hosting with an amd64 Compose deployment, prebuilt GHCR images, direct private-LAN access, and a persistent data volume for repeatable upgrades and rollbacks.
- Optional LAN sharing for phones on the same trusted private network, with one-time QR/link pairing, persistent paired-device management, presence tracking, and restart invalidation.

### Changed

- Mobile UI layouts now adapt navigation, action bars, dense results, settings, and dialogs for narrow touch screens, including phone safe-area support and full-height mobile flows where useful.
- Account switching now revokes the current session and starts a fresh Battle.net login; ordinary sessions persist securely across app and server restarts.
- Account actions now live under one avatar menu with the BattleTag, My Characters, Switch account, and Manage Users options; the current admin account is protected from self-disable, sign-out, or role changes.
- The hosted Raids page now works in Light mode, lists cataloged expansions, fills missing current-expansion metadata, and chains catalog and public artwork fallbacks when image endpoints have no source.
- Dungeon expansion and season selectors retain known content during incomplete runtime refreshes, and dungeon cards fall back through catalog and public artwork sources.
- Removing a paired LAN device immediately invalidates its session and redirects that browser to a QR scanner for a new pairing.
- Docker hosting now derives the web origin and Battle.net callback from the address and port used by the instance; health-check and backup scripts verify operations and produce recoverable archives with SHA-256 hashes.
- The public site and hosting guides now explain the desktop, hosted, PWA, and trusted-LAN paths more clearly, with responsive layouts for smaller screens.
- Tagged releases now health-check and publish versioned, minor, and latest Docker images, then attach hosting configuration, documentation, checksums, and image references.
- Hosted deployments use configurable HTTPS Battle.net callback and web-origin settings, while game-data and SimulationCraft runtime refreshes validate staged data and retain the last-known-good state during degraded season rollovers.
- Small workflow improvements now include visible app search with the Ctrl K shortcut, SimC profile persistence and older-patch warnings, hosted SimC channel and update controls, and clearer account, dungeon, setup, PWA, LAN, and Docker flows.

### Fixed

- Dungeon and Mythic+ route inputs are no longer parsed as character imports when they also contain name-like lines.
- Fixed related-scenario refresh loops, forced fresh Battle.net account selection when switching users, and improved persistence and publication reliability for hosted Docker secrets and images.
