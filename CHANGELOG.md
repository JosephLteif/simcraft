# Changelog

All notable changes to WhyLowDPS should be documented in this file.

The format is based on Keep a Changelog and this project uses semantic versioning for stable releases.

## [Unreleased]

### Added

- Simulation queue management now supports a configurable parallel-job limit across desktop and private Docker hosting; Docker-hosted changes are restricted to administrators.
- The global activity card now shows running and queued simulations, remains available on result pages, and supports cancellation.
- The dashboard now shows a live Queued Sims count while simulations are in flight.
- Wishlist and Upgrade Planner now share a character-scoped Gear Roadmap: Wishlist tracks items to obtain, while the roadmap tracks upgrades for owned items without duplicating the same list.
- Drop Finder, Wishlist, and Upgrade Planner are grouped together with direct navigation and clearer guidance for moving an item from acquisition to upgrade planning.
- Completed simulation results can now be exported as portable `.wldps` files, imported by picker or drag-and-drop, and opened directly by the desktop app through Windows file association.

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
