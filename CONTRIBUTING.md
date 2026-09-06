# Contributing to WhyLowDPS

Thanks for your interest in contributing.

## Scope

WhyLowDPS is currently Windows-first and desktop-first. Please keep changes focused, practical, and aligned with existing architecture and UX patterns.

## Before you start

- Open an issue first for non-trivial changes.
- Keep pull requests small and single-purpose.
- Avoid unrelated refactors in feature/bugfix PRs.

## Development

The supported development target is the Windows desktop application. Use Node.js
20 and Rust 1.95; the repository includes `.nvmrc` and `rust-toolchain.toml`
so local tools and CI use the same versions.

End-user installation and Battle.net client setup are documented in
[Getting started](docs/getting-started.md).

Windows is required for full desktop validation. The project site uses GitHub
Pages, and the hosted application supports a private, single-instance Docker
deployment. It is not designed as a public multi-user service.

Install dependencies:

```bash
npm ci
npm ci --prefix frontend
```

Sync a local work branch to the latest release commit before continuing work:

```bash
git fetch origin master --tags
git merge --ff-only origin/master
```

The release action commits synchronized version metadata to `master` before it
creates the release tag. Keep local changes committed or stashed before this
fast-forward.

Run the desktop app:

```bash
npm run desktop:dev
```

Run the backend directly:

```bash
cd backend
cargo run -p whylowdps-server
```

Run the development frontend for a phone on the same LAN:

```bash
# Terminal 1, from the repository root
npm run backend:dev

# Terminal 2, from the repository root
npm run web:dev:lan
```

Find the PC's private IPv4 address with `ipconfig`, then open
`http://<PC-LAN-IP>:3000` on the phone. Both devices must be on the same trusted
Wi-Fi network. If Windows Firewall prompts, allow Node.js on **Private
networks**; do not enable a Public-network rule or forward the port to the
internet. The Next.js development server is the LAN-facing process and keeps
the backend on `127.0.0.1:8000`.

The installed desktop flow is different from the development server: it is
opt-in, uses port `17384`, and requires device pairing. Follow
[Desktop LAN sharing](docs/lan-sharing.md) for enablement, pairing, device
management, security, and troubleshooting.

Run the focused checks used by the repository:

```bash
npm run typecheck:frontend
npm run test:frontend
npm run test:scripts
cargo test --workspace
```

The desktop crate formatting gate is:

```bash
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check
```

The full desktop build check is:

```bash
npm run tauri:build:check
```

## Release workflow

Stable releases are created from `master`. Before tagging, run:

```bash
npm run verify:release -- 3.4.2
```

The release workflow creates a draft GitHub release, uploads the signed
artifacts and checksum metadata, and publishes the release only after those
steps complete. If a release step fails, leave the draft unpublished until the
failure is corrected or the draft is deleted.

For a new stable release, open **Actions → Release → Run workflow** and choose
**patch**, **minor**, or **major**. Stable releases always use `master`.

If the version bump and tag were already created but a later release step
failed, recover the same release without incrementing the version again:

1. Open **Actions → Release → Run workflow**.
2. Set **Release action** to **republish**.
3. Enter the existing version without the `v` prefix, such as `4.0.0`.
4. Run the workflow.

Republish mode verifies that `v<version>` exists, checks out that tag, and
rebuilds the desktop and hosted Docker artifacts. It does not commit, bump, or
move the release tag; existing release assets and Docker tags are replaced as
part of the retry.

Developer builds have their own simple workflow. Push to `dev`, or open
**Actions → Dev Release → Run workflow**. It publishes a signed Windows
prerelease under the moving `dev` GitHub release and updates its `latest.json`
manifest. Stable users are unaffected. Install the dev artifact once, or
choose **Settings → App Updates → Dev (pre-release)**, then future developer
releases can be installed through the normal updater.

When the tested dev build is ready for everyone, open **Actions → Release → Run
workflow**, choose **promote-dev**, enter the exact **Dev version** and the
**Stable version**, and run it. The dev version selects the immutable tested
source tag; the stable version selects the official `v<version>` to publish, so
it can intentionally differ from the dev prerelease base. It does not bump the
stable version again. It also promotes the `Unreleased` changelog into that
version and updates the Pages source on `master`. It fails if that stable
version already has a release tag. Both release workflows require the
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets.

## Pull request guidelines

- Use clear commit messages.
- Describe user impact, not only code changes.
- Include screenshots for UI changes.
- Call out risk areas and rollback path for risky changes.
- Ensure local checks relevant to your change pass.

## Trust and privacy expectations

- Do not introduce remote storage of Battle.net credentials.
- Keep local-first behavior intact unless explicitly discussed and approved.
- Document any new network data source in README and release notes.

## Code style

- Follow existing conventions in touched files.
- Prefer minimal, maintainable changes over broad rewrites.
- Keep logic readable and strongly typed.
