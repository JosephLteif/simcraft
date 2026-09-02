# Getting started with WhyLowDPS

This guide covers the installed Windows desktop app. For an independent private
web instance, see [Docker-hosted private WhyLowDPS](docker-hosting.md). To open
the installed desktop app from a phone, see [Desktop LAN sharing](lan-sharing.md).

## Install the Windows app

1. Open the [WhyLowDPS releases page](https://github.com/JosephLteif/simcraft/releases/latest).
2. Download the Windows x64 setup executable from the latest completed release.
   Use the checksum file in that release if you want to verify the download.
3. Run the installer and open WhyLowDPS.

Windows SmartScreen may show a reputation warning because the app is not yet
widely installed or code-signed. Download only from the repository's release
page and verify the release checksum before choosing to continue.

## Choose the first-launch mode

WhyLowDPS can start in either mode:

- **Continue in Light mode** requires no Blizzard credentials. It supports
  local simulations, shared game-data catalogs, and simulation results, but
  Battle.net characters, Great Vault data, wishlists, and other account-scoped
  features are unavailable.
- **Save & Login with Battle.net** enables the account-aware features. It
  requires a personal Battle.net API client as described below.

You can start in Light mode and select **Login with Battle.net** from the app
header later.

## Create Battle.net API credentials

1. Sign in to the
   [Battle.net Developer Portal](https://community.developer.battle.net/access/clients).
2. Create a client for WhyLowDPS, or open an existing client reserved for this
   installation.
3. Add the redirect URL for the mode you are configuring:

   | Mode | Redirect URL | Allowed domain or service hostname |
   | --- | --- | --- |
   | Installed Windows app | `http://localhost:17384/api/auth/bnet/callback` | `localhost` |
   | Docker on a private LAN | `http://<HOST-IP>:<PORT>/api/auth/bnet/callback` | `<HOST-IP>` |
   | Trusted HTTPS host | `https://<HOSTNAME>/api/auth/bnet/callback` | `<HOSTNAME>` |

   For Docker or HTTPS, use the exact callback displayed by the hosted app. The
   scheme, hostname, port, and path must match the address used in the browser.
   Do not add a trailing slash. If the portal has a separate allowed-domain or
   service-URL field, enter only the hostname, without the callback path.

4. Save the client, then copy the values labeled **Client ID** and **Client
   Secret**. The Client ID is not the client-management identifier in the
   portal page's URL.

Treat the Client Secret like a password. Do not commit it, paste it into an
issue, or send it to another person.

## Configure the installed desktop app

On first launch:

1. Paste the **Client ID** and **Client Secret** into the matching WhyLowDPS
   fields.
2. Leave **Save these credentials securely on this device** enabled if this is
   your PC.
3. Select **Save & Login with Battle.net**.
4. Complete Battle.net authorization in the window that opens, then return to
   WhyLowDPS.

You can add, test, rename, replace, or remove credentials later under
**Settings > Integrations > API Integrations**. The desktop app protects saved
secrets with Windows DPAPI for the current Windows profile. It does not require
credentials in the repository `.env` files.

After signing in, **Settings > Integrations > Character data providers** can
enable the optional public Raider.IO and Warcraft Logs cards. Raider.IO is
enabled by default and requires no credential. Warcraft Logs uses personal
credentials from the [Warcraft Logs client manager](https://www.warcraftlogs.com/api/clients/)
entered there, shows only public reports and rankings, and
does not support private-report OAuth/PKCE access. Existing Blizzard data and
the outbound Raider.IO/Warcraft Logs profile links remain available if either
provider is disabled or unavailable.

If a saved profile says its secure secret is missing, re-enter the Client
Secret and save that profile again. This can happen after moving app data to a
different Windows account or machine because the protected value cannot be
decrypted there.

## Configure a Docker-hosted app

The Docker administrator has two options:

### Environment configuration

Uncomment and set these variables in `.env.docker`:

```dotenv
BLIZZARD_CLIENT_ID=your-client-id
BLIZZARD_CLIENT_SECRET=your-client-secret
# Optional shared Warcraft Logs public API credentials.
WARCRAFT_LOGS_CLIENT_ID=your-warcraft-logs-client-id
WARCRAFT_LOGS_CLIENT_SECRET=your-warcraft-logs-client-secret
```

Then recreate the service so the environment is applied:

```shell
docker compose --env-file .env.docker up -d
```

Do not use `docker compose restart app`; restart does not load changed
environment values.

The Warcraft Logs variables are optional. They provide a shared public-data
fallback for hosted users; users may instead enter personal credentials under
**Settings > Integrations**. Recreate the service after changing them.

### First-launch configuration

If the variables are not set, the hosted app's initial setup screen can save a
credential profile before the first Battle.net login. Login tokens are signed
with `JWT_SECRET`. OAuth access tokens and saved Blizzard client secrets are
encrypted using `SESSION_ENCRYPTION_KEY`. These variables are optional: if
omitted, the server generates both keys and stores them in `/data/.jwt-secret`
and `/data/.session-encryption-key`. Keep the generated files in the persistent
`/data` volume, or keep supplied keys stable across updates and restore them
with the data backup.

For either option, register the exact callback shown by the hosted app. A direct
LAN example is:

```text
http://192.168.1.20:8000/api/auth/bnet/callback
```

Every browser must open the app through that same registered origin. If the
host address, port, or HTTPS hostname changes, update the portal redirect and
recreate the service as needed.

## Finish first-time setup

1. Leave the app open while it prepares game data and the SimulationCraft
   runtime.
2. If WhyLowDPS reports missing required files, use **Repair Missing Files** and
   let the repair complete.
3. Review CPU threads and other simulation defaults in **Settings >
   Simulation**.
4. Review the application and SimulationCraft update channels in **Settings >
   Updates**.
5. Run a small Quick Sim before starting a large matrix or route simulation.

## Common Battle.net setup problems

### Redirect URI mismatch

Copy the callback from WhyLowDPS exactly. `localhost`, a LAN IP, and an HTTPS
hostname are different OAuth origins. The scheme and non-default port also
matter. Portal changes may take a few minutes to become active.

### Invalid client

Copy the value labeled **Client ID**, not an identifier from the portal page
URL. Re-copy the Client Secret without surrounding spaces, then use **Test
Blizzard Connection** under **Settings > Integrations**.

### Docker redirects to localhost

Open the hosted app through its registered IP-and-port or HTTPS origin. Always
run Compose with `--env-file .env.docker`, recreate the service after changing
configuration, and confirm that the browser did not reuse an old login tab.

### Account features are unavailable

Light mode intentionally disables account-scoped features. Select **Login with
Battle.net** and complete authorization with a working credential profile.
