# Docker-hosted private WhyLowDPS

The hosted deployment is a private, single-instance Linux container. It runs
its own Linux SimulationCraft runtime; it does not connect to the Windows
desktop app's SimC process or data directory.

This is a self-hosted private instance, not a shared WhyLowDPS service. The
recommended installation uses the prebuilt release image. Building from source
is only needed for development or contributors.

Desktop **Share over LAN** is a different mode: it exposes the running Windows
app on port `17384` and requires QR pairing. Docker creates an independent web
instance on the configured host and does not use desktop pairing.

## Production requirements

- An amd64 Linux host, or Docker Desktop using its WSL2 Linux engine.
- Docker Engine with the Compose plugin (`docker compose version`).
- A stable private IPv4 address or DHCP reservation for the host.
- The selected TCP port allowed only from the trusted private network.
- A current WhyLowDPS release with a published `linux-x64` SimulationCraft
  runtime on the selected `SIMC_CHANNEL`.

Arm64 hosts are not currently supported because the companion runtime is
published for `linux-x64`.

## First installation

1. Download `compose.yaml` and `.env.docker.example` from the same WhyLowDPS
   GitHub release. A repository clone can be used for source development.
2. Put both files in a dedicated directory and create the private environment
   file:

   ```shell
   cp .env.docker.example .env.docker
   ```

3. Edit `.env.docker`:

   - The downloaded Compose file follows the published `latest` image by
     default.
   - Set `WHYLOWDPS_HOST_IP` to the host's private IPv4 address, for example
     `192.168.1.20`. Leave it as `0.0.0.0` to listen on all host interfaces.
   - Set `WHYLOWDPS_PORT` to the client-facing port, normally `8000`.
   - `JWT_SECRET` and `SESSION_ENCRYPTION_KEY` are optional. If you leave them
     unset, the server generates separate random values on first startup and
     stores them in `/data/.jwt-secret` and
     `/data/.session-encryption-key`. The persistent `whylowdps-data` volume
     must be retained so login tokens and encrypted credentials continue to
     work after restarts.
   - If you prefer to supply the values yourself, generate two different
     random 32-byte values and paste them into `JWT_SECRET` and
     `SESSION_ENCRYPTION_KEY`:

     ```shell
     openssl rand -hex 32
     openssl rand -hex 32
     ```

     Each output is a 64-character hexadecimal value. The values should look
     like `4f8c...` and `a19e...`, but must be generated locally rather than
     copied from documentation. `JWT_SECRET` signs login tokens.
     `SESSION_ENCRYPTION_KEY` encrypts OAuth tokens and saved Blizzard client
     secrets. Keep both values stable with the deployment and its backups.
     If you prefer a browser tool, use the
     [KuleUI Key Generator](https://www.kuleui.com/tools/dev/key-generator),
     select **Hex**, set the length to **32 bytes**, generate one value, copy
     it, and regenerate a second value for the other variable. The tool says
     it uses the browser's Web Crypto API and does not transmit generated
     values. Use it only from a trusted device; local OpenSSL or PowerShell
     generation is preferable for higher-security deployments.
   - Set `WHYLOWDPS_BOOTSTRAP_ADMIN_BATTLETAG` to the exact Battle.net
     BattleTag that will perform the first login, including its discriminator,
     for example `YourBattleTag#1234`. Quote the value if it contains `#`.
   - Leave `WHYLOWDPS_SECURE_COOKIES=false` for direct LAN HTTP. Set it to
     `true` only when the app is accessed through trusted HTTPS.
   - `SIMC_CHANNEL`, `MAX_CONCURRENT_SIMULATIONS`, and
     `MAX_JOBS_PER_USER` are optional tuning values; the example shows the
     normal defaults of `weekly`, `2`, and `200`. Administrators can change
     the parallel simulation limit later in **Settings → Simulation Performance**;
     the saved value is kept in the data volume.
   - Blizzard application credentials are entered in the app at runtime; they
     are not stored in this environment file.
   - Warcraft Logs is optional. To provide a shared public-data client for
     hosted users, set `WARCRAFT_LOGS_CLIENT_ID` and
     `WARCRAFT_LOGS_CLIENT_SECRET` below, then recreate the service. Users can
     also save personal Warcraft Logs credentials under **Settings >
     Integrations**; personal credentials take precedence over shared ones.

   On Windows PowerShell, the two secrets can also be generated without
   OpenSSL:

   ```powershell
   function New-WhyLowDpsSecret {
     $bytes = New-Object byte[] 32
     $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
     try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
     [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
   }
   $jwtSecret = New-WhyLowDpsSecret
   $sessionEncryptionKey = New-WhyLowDpsSecret
   "JWT_SECRET=$jwtSecret"
   "SESSION_ENCRYPTION_KEY=$sessionEncryptionKey"
   ```

4. Pull and start the latest release:

   ```shell
   docker compose --env-file .env.docker pull
   docker compose --env-file .env.docker up -d
   ```

   Always include `--env-file .env.docker`. This prevents unrelated values in
   a repository `.env` file from being used for the hosted deployment.

5. Confirm that the container is healthy:

   ```shell
   docker compose --env-file .env.docker ps
   docker compose --env-file .env.docker logs --tail=100 app
   curl --fail http://<WHYLOWDPS_HOST_IP>:<WHYLOWDPS_PORT>/health
   ```

6. Open `http://<WHYLOWDPS_HOST_IP>:<WHYLOWDPS_PORT>` from a browser on the
   trusted LAN and sign in with the bootstrap administrator BattleTag. Add other
   allowed accounts from **Manage Users**.

The administrator can switch the Docker-hosted SimulationCraft build at runtime
from **Settings > Docker Updates > SimC Channel**. Choose **Weekly** or **Nightly**;
the selected latest build is downloaded immediately and the choice is stored in
the persistent database volume. Other hosted users can use the runtime but
cannot change this server-wide setting.

The SQLite database, synchronized data, caches, saved encrypted credentials,
and downloaded SimC runtime live in the Docker-managed `whylowdps-data` volume.
Do not delete that volume during routine recreation, updates, or rollback.

## Optional character-data integrations

Warcraft Logs integration uses the [public client-credentials API](https://www.warcraftlogs.com/api/docs). It shows up
to five recent public reports and the latest available public zone ranking;
private reports, private OAuth/PKCE access, and report uploads are out of
scope. Configure a shared fallback with `WARCRAFT_LOGS_CLIENT_ID` and
`WARCRAFT_LOGS_CLIENT_SECRET`, or let each hosted user enter personal
credentials from the [Warcraft Logs client manager](https://www.warcraftlogs.com/api/clients/) under **Settings > Integrations**. A user credential wins over
environment credentials, and environment credentials win over the
administrator-managed fallback. Valid credentials automatically enable the
provider, which can still be disabled in the same settings panel.

Raider.IO is enabled by default and does not need credentials. It is
disableable under **Settings > Integrations** and includes an attribution link
on character cards. Both providers may rate-limit or temporarily withhold
public data; the existing Blizzard snapshot and profile links remain usable
when an external provider is unavailable.

## Manage Docker application updates

The default Compose deployment leaves application updates under host control. To
enable the optional in-app update manager, add a long random token to
`.env.docker`:

```dotenv
WHYLOWDPS_DOCKER_UPDATE_TOKEN=replace-with-a-long-random-token
```

Start the app with the `updates` profile so the label-scoped Watchtower
companion is running:

```shell
docker compose --env-file .env.docker --profile updates up -d
```

An administrator can then use **Settings > Docker Updates** to choose **Manual**
or **Automatic** updates and to press **Update now**. Automatic mode checks the
published `:latest` image on the selected interval and recreates the app when a
new digest is available. Manual mode only updates after an administrator starts
the action. The app may briefly disconnect while its container is recreated.

The companion is optional because it needs access to
`/var/run/docker.sock`; that access can control the Docker daemon. It is scoped
to the WhyLowDPS app by the Watchtower enable label, and its HTTP API is only
available on the private Compose network. If you do not want to grant that
access, leave the profile disabled and use the host-side commands below or
Portainer.

Multi-user releases use `/data/whylowdps-multi-user.db`. An earlier
`/data/whylowdps.db` is intentionally left untouched as a legacy backup; old
personal records are not imported automatically.

## Configuration reference

The production image is defined directly in `compose.yaml` as
`ghcr.io/josephlteif/whylowdps:latest`. Change that line to an exact version or
digest when pinning a deployment.

Published Docker releases use the `latest` tag and versioned tags. There is no
separate `stable` image tag.
The hosted Settings page only lists versions whose release includes the
`docker-image.txt` bundle generated after the image was published and its digest
was recorded.

| Variable | Purpose |
| --- | --- |
| `WHYLOWDPS_HOST_IP` | Optional host bind address, for example `192.168.1.20`; defaults to `0.0.0.0`. |
| `WHYLOWDPS_PORT` | Optional client-facing port; defaults to `8000`. |
| `JWT_SECRET` | Optional random 32-byte signing secret, normally 64 hex characters. If omitted, it is generated and stored in `/data/.jwt-secret`. Keep it stable; changing it invalidates login tokens. |
| `SESSION_ENCRYPTION_KEY` | Optional separate random 32-byte encryption key, normally 64 hex characters. If omitted, it is generated and stored in `/data/.session-encryption-key`. It protects OAuth tokens and saved Blizzard client secrets. Keep it stable. |
| `WARCRAFT_LOGS_CLIENT_ID` | Optional shared Warcraft Logs public API client ID. Environment credentials take precedence over an admin-managed shared fallback. |
| `WARCRAFT_LOGS_CLIENT_SECRET` | Optional shared Warcraft Logs public API client secret. Keep it private; it is never returned by the app. |
| `WHYLOWDPS_BOOTSTRAP_ADMIN_BATTLETAG` | BattleTag such as `YourBattleTag#1234`; it is used only to create the first administrator when the user table is empty. |
| `WHYLOWDPS_SECURE_COOKIES` | `false` for direct LAN HTTP; set `true` only behind trusted HTTPS. |
| `SIMC_CHANNEL` | Initial runtime channel: `weekly` or `nightly`; defaults to `weekly`. After an administrator changes the channel in Settings, the persisted setting takes precedence. |
| `SIMC_PATH` | Legacy fixed-binary override. Leave it unset for managed runtime updates; the standard `/data/simc-runtime/simc` path remains compatible with channel switching. A different path disables managed channel updates. |
| `MAX_CONCURRENT_SIMULATIONS` | Initial concurrency limit; the Compose example uses `2`. Administrators can change it later in **Settings → Simulation Performance**; the saved value takes precedence. |
| `MAX_JOBS_PER_USER` | Optional unpinned job-history limit; defaults to `200`. |

## Updates and rollback

Back up the data volume first, then pull and recreate the service:

```shell
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

`docker compose restart app` does not apply a new image or changed environment
values. Publishing a new `latest` image also does not restart an existing
container by itself. Configure Portainer or another Docker manager to poll the
image or receive a registry webhook, then pull and recreate the stack when the
digest changes.

For a command-line deployment, the update operation is:

```shell
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
```

The in-app manager follows the same pull-and-recreate behavior through the
optional Watchtower companion. It does not change `.env.docker`, the selected
image tag, or the `whylowdps-data` volume.

For Portainer or a similar manager, use the Compose image
`ghcr.io/josephlteif/whylowdps:latest` and enable its registry polling or
webhook-based pull-and-redeploy option. A normal running container does not
periodically check the registry on its own.

To roll back, change the `image` line in `compose.yaml` to the exact version
from `docker-image.txt`, for example
`ghcr.io/josephlteif/whylowdps:3.8.0`, or to the listed immutable digest. Pull
and recreate the service again. Preserve `.env.docker` if you supplied keys;
otherwise preserve the `whylowdps-data` volume, which contains the generated
keys.

## Build the hosted image from source

Contributors can use the source override, which gives the local image a
separate name from release images:

```shell
docker compose --env-file .env.docker -f compose.yaml -f compose.source.yaml up -d --build
```

Run the same command after source changes; restarting an existing container
does not rebuild it.

## Blizzard developer portal setup

Open the [Battle.net Developer Portal](https://community.developer.battle.net/access/clients),
open the client used by this deployment, and add the full callback URL to its
**Redirect URLs** list. The client ID must be the value labeled **Client ID** in
the portal; do not copy the client-management UUID from the portal page URL.
For a LAN deployment, add the exact IP-and-port callback displayed by the
hosted UI. If the machine's LAN address or port changes, update the portal
entry and recreate the Compose service before signing in again.
Changes in the portal may take several minutes to become active.

## Windows development

Use Docker Desktop with its WSL2 Linux engine. Build Linux containers; do not
use Windows containers for this service. Keep the database and SimC runtime in
the named Docker volume rather than a `C:\` bind mount. If testing from a
phone, permit the local Docker port only on the Windows Private network.

The Windows desktop build remains separate and continues to use Tauri,
DPAPI/keyring storage, `simc.exe`, Windows process controls, clipboard, tray,
and desktop update behavior.

## Hosted limitations

This deployment is intentionally single-replica and supports a small trusted
group of users. SQLite owner-scopes simulations, routes, character profiles,
history, and OAuth sessions. Use the administrator page to allow BattleTags,
disable users, assign roles, or revoke sessions. The default per-user history
limit is controlled by `MAX_JOBS_PER_USER`.

On first launch, enter a Blizzard application client ID and secret in the app.
The bootstrap administrator can later add, rename, rotate, or remove credential
profiles from Settings without restarting the container. Secrets are encrypted
at rest and are never returned to browsers; unauthenticated users can only see
profile names and public client IDs and select which profile to use. After the
first user is created, credential changes require an administrator session.

OAuth access tokens are encrypted with `SESSION_ENCRYPTION_KEY` before they are
stored in SQLite, and saved Blizzard client secrets use the same key. Active
sessions survive container restarts. Hosted Light mode is disabled: every
hosted user must sign in and be on the allowlist.

Direct LAN HTTP is not a secure browser context on most phones and browsers, so
secure cookies, service-worker installation, and native PWA installation are not
available. Keep the port restricted to the Windows Private network.

### Optional trusted HTTPS and PWA installation

An installable PWA requires an HTTPS certificate trusted by the browser and
phone. The baseline Compose file does not provide a certificate or reverse
proxy. If the administrator adds a trusted HTTPS proxy:

- Keep the deployment private and limit access to trusted users.
- Set `WHYLOWDPS_SECURE_COOKIES=true` and recreate the service.
- Preserve the browser-facing hostname and HTTPS scheme in the forwarded
  request.
- Register the exact `https://<HOSTNAME>/api/auth/bnet/callback` URL in the
  Battle.net Developer Portal.
- Trust the issuing certificate authority on every client if using an internal
  CA. An untrusted or self-signed certificate does not provide a browser secure
  context for native installation.

## Backups and operations

The repository includes PowerShell helpers for operators working from a clone.
Run the read-only operational check from the repository root:

```powershell
.\scripts\check-hosted.ps1
```

Create a consistent manual full-volume backup with a short app interruption:

```powershell
.\scripts\backup-hosted.ps1 -Destination 'D:\WhyLowDPSBackups'
```

The command writes a timestamped archive and SHA-256 hash. Do not place the
SQLite volume or backup destination on OneDrive or a network share. Before
trusting a backup, restore it into a disposable Docker volume and start an
isolated app container against that volume.
