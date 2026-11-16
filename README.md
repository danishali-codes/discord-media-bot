# media-bot

Discord bot for Danish's home media server. Members link a Jellyfin or Plex account, request movies and shows through Seerr, and admins approve, decline, or alter those requests from Discord. The same bot can show the library, playback reports, Uptime Kuma, and a few admin tools.

Re-register slash commands after this update (`node dist/register.js`, or the Docker command in Deploy). New command names do not appear until you do.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/link-account username service` | Any member | Matches a Seerr user and asks an admin to approve the link. |
| `/unlink-account` | Any member | Removes your own link. |
| `/request title` | Linked member | Search Seerr and request a movie, or a whole series / its latest season. Only works in `REQUESTS_CHANNEL_ID`. |
| `/search query` | Any member | Up to 5 results with posters. A Request button on titles that are not on the server uses the same flow as `/request`, including the link check and the requests-channel rule. |
| `/check [title]` | Linked member | Your newest 10 Seerr requests: title, year, movie/TV, date, and a combined status. The optional title filters those 10. |
| `/watchlist` | Linked member | Your Seerr watchlist, with Request buttons on anything not yet requested. |
| `/new [days]` | Any member | Recently added movies and shows. Episodes are grouped by series. Default is 7 days. Uses Jellyfin when configured, otherwise Seerr. |
| `/random [type] [genre]` | Any member | One random Jellyfin movie or show, with a link when `JELLYFIN_PUBLIC_URL` is set. |
| `/upcoming` | Linked member | Episodes in the next 7 days for TV you have requested. Needs Sonarr. |
| `/stats` | Linked member | Watch time and recent plays from Tautulli. Tautulli only covers Plex. |
| `/report` | Linked member | Modal for a playback problem. Opens a Seerr issue when the title is in the library, and posts it for admins. |
| `/link` | Any member | The service URLs that are set in the environment. |
| `/status` | Any member | Uptime Kuma monitors, up or down, with 24h uptime when Kuma sends it. |
| `/help` | Any member | This list. Admin commands are included only for admins. |
| `/announce` | Admin | Modal, then an embed in `ANNOUNCE_CHANNEL_ID` or the current channel. |
| `/pending` | Admin | Pending Seerr requests as poster embeds with Approve, Decline, and Alter. |
| `/nowplaying` | Admin | Current Tautulli (Plex) and Jellyfin sessions. |
| `/disk` | Admin | Disk percent per Beszel system. A warning shows at 80% or more. |
| `/restart service` | Admin | Restarts one allowlisted container through Arcane. Only in the admin channel, and only after a confirm button. |
| `/unlink user` | Admin | Removes that member's link and any pending link, then DMs them. |

Member commands reply ephemerally (only you see them), except the admin cards from `/pending` and the public announcement. `/request` has to be used in the requests channel. Discord does not offer guild commands inside a DM, so registration stays guild-scoped.

A pending link gets "Your link is awaiting approval" from `/request`, `/check`, `/watchlist`, `/upcoming`, `/stats`, and `/report`. Anyone else is told to use `/link-account`.

When someone joins, the bot DMs them to run `/link-account`, and mentions `/help`. The DM is skipped if they have DMs closed. Approve, decline, available, and resolved-report notices are also DMs, and those fail quietly when DMs are closed.

Admin means Manage Server, or the optional `ADMIN_ROLE_ID`. Administrator counts because it includes Manage Server.

## Discord app

1. Create an application at <https://discord.com/developers/applications>.
2. Bot tab: reset the token. That value is `DISCORD_TOKEN`.
3. Enable the privileged **Server Members Intent**. The bot asks Discord for the Guilds and Guild Members intents. Message Content is not used. Without Server Members Intent the process will not stay connected, and join DMs will not fire.
4. OAuth2 URL Generator: scopes `bot` and `applications.commands`. Bot permissions: View Channels, Send Messages, Embed Links. Invite it into the server.
5. Copy the application id into `DISCORD_CLIENT_ID`. Enable Discord developer mode, then copy the server id (`DISCORD_GUILD_ID`), the admin channel id (`ADMIN_CHANNEL_ID`), and the requests channel id (`REQUESTS_CHANNEL_ID`).
6. Optional: copy a role id into `ADMIN_ROLE_ID`. Approve and Deny otherwise require Manage Server. A member with Administrator can press them too, because that permission includes Manage Server.

Register the slash commands after the bot is in the server (see Deploy). Registration is guild-scoped, so the commands show up immediately in that server only. They are typed in a server channel, including after the join DM.

## Environment

Copy `.env.example` to `.env`. Values stay out of git.

| Name | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Bot token. |
| `DISCORD_CLIENT_ID` | Application id. |
| `DISCORD_GUILD_ID` | Server where commands are registered and join DMs are sent. |
| `ADMIN_CHANNEL_ID` | Channel for pending media requests and link confirmations. |
| `REQUESTS_CHANNEL_ID` | Only channel where `/request` runs. |
| `SEERR_URL` | Seerr base URL, for example `http://192.168.1.14:5055`. No path, no trailing slash required. |
| `SEERR_API_KEY` | Admin API key. It must be allowed to list users, create requests for another user (`userId`), and approve or decline. |
| `WEBHOOK_SECRET` | Exact `Authorization` header value Seerr sends. No `Bearer` prefix unless you put the same prefix in both places. |
| `WEBHOOK_PORT` | Port the webhook listens on, inside the container and on the host. |
| `ADMIN_ROLE_ID` | Optional. Members with this role may use admin commands and the Approve / Decline / Alter / report buttons, along with anyone who has Manage Server. |
| `JELLYFIN_URL` | Optional. Jellyfin base URL, for example `http://192.168.1.14:8096`. Dashboard → API Keys is `JELLYFIN_API_KEY`. |
| `JELLYFIN_PUBLIC_URL` | Optional. Browser URL shown by `/link` and on `/random`. |
| `PLEX_PUBLIC_URL` | Optional. Browser URL for `/link`. |
| `SEERR_PUBLIC_URL` | Optional. Browser URL for `/link`. |
| `STATUS_PAGE_URL` | Optional. Public status page URL for `/link`. |
| `LINKS_EXTRA` | Optional. More `/link` entries: `Name\|https://example.com,Other\|https://example.org`. |
| `UPTIME_KUMA_URL` | Optional. Kuma base URL. `/status` also needs `UPTIME_KUMA_STATUS_SLUG` (the slug in the public status page URL). |
| `STATUS_CHANNEL_ID` | Optional. Where Kuma down / back up alerts are posted. If blank, the webhook is accepted and ignored. |
| `ANNOUNCE_CHANNEL_ID` | Optional. `/announce` and the Sunday "New this week" post. If blank, `/announce` uses the current channel and the weekly post is skipped. |
| `SONARR_URL` | Optional. Sonarr base URL. Settings → General → API Key is `SONARR_API_KEY`. Used by `/upcoming`. |
| `TAUTULLI_URL` | Optional. Tautulli base URL. Settings → Web Interface → API key is `TAUTULLI_API_KEY`. Plex watch history only. |
| `BESZEL_URL` | Optional. Beszel hub URL. `BESZEL_EMAIL` and `BESZEL_PASSWORD` are the admin login. Used by `/disk`. |
| `ARCANE_URL` | Optional. Arcane base URL. System → API Keys is `ARCANE_API_KEY`. `ARCANE_ENV_ID` is the environment id (`0` is the local Docker engine). |
| `RESTART_ALLOWLIST` | Optional. Comma-separated container names `/restart` may touch. Anything else is refused. Names containing `:` are ignored. |
| `NEW_THIS_WEEK_CRON` | Optional. Five-field cron `minute hour * * weekday` in Asia/Dubai. Default `0 20 * * 0` (Sunday 20:00). Weekday may be `0`-`7` or `sun`-`sat`. |
| `INACTIVE_DAYS` | Optional. Default 60. Linked members with no Tautulli or Jellyfin activity in that many days are listed in the admin channel. |

Every new variable is optional. Leave it blank and that feature says it is not configured, or stays quiet. The original variables are still required.

The SQLite file is `data/bot.sqlite` (mounted at `/app/data` in Docker). Deleting it drops every account link and the weekly job stamps.

## Seerr webhook

In Seerr: Settings → Notifications → Webhook.

Enable these notification types:

- Request Pending Approval
- Request Approved
- Request Declined
- Request Available
- Request Automatically Approved

Webhook URL (use the mini PC's LAN address, not `localhost` from inside another container):

```text
http://<mini-pc-ip>:WEBHOOK_PORT/seerr-webhook
```

Authorization header: the same string as `WEBHOOK_SECRET`.

JSON payload. Paste this as-is:

```json
{
  "notification_type": "{{notification_type}}",
  "event": "{{event}}",
  "subject": "{{subject}}",
  "message": "{{message}}",
  "image": "{{image}}",
  "media_type": "{{media_type}}",
  "media_tmdbid": "{{media_tmdbid}}",
  "request_id": "{{request_id}}",
  "requestedBy_username": "{{requestedBy_username}}",
  "requestedBy_email": "{{requestedBy_email}}"
}
```

The bot reads `notification_type`, `subject`, `image`, `media_type`, `media_tmdbid`, `request_id`, and `requestedBy_username`. `event`, `message`, and `requestedBy_email` are kept on the normalized event so a later version can forward that same object to n8n. They are not shown in Discord in v1.

Seerr's subject is usually `Title (Year)`. The template has no separate year field and no numeric Seerr user id. After the webhook arrives, the bot loads `GET /api/v1/request/{request_id}` for the requester's Seerr user id (that is how DMs find the linked Discord account) and `GET /api/v1/movie/{tmdbId}` or `GET /api/v1/tv/{tmdbId}` for the title, year, and poster. If those calls fail, it falls back to the subject and image from the payload.

What happens with each event:

- `MEDIA_PENDING`: embed in the admin channel with requester, title, year, and poster, plus Approve, Decline, and Alter. Approve calls `POST /api/v1/request/{id}/approve`. Decline calls `POST /api/v1/request/{id}/decline`. The message is then edited with the outcome and who pressed the button. Alter, for a show, lets an admin pick seasons (`PUT /api/v1/request/{id}` with those season numbers, then approve). For a movie, or via "Different title" on a show, a short search replaces the request: the new one is created for the same Seerr user and approved, and the original is declined. A replacement show is requested for all seasons.
- `MEDIA_APPROVED`, `MEDIA_AUTO_APPROVED`, `MEDIA_DECLINED`, `MEDIA_AVAILABLE`: DM the linked requester. No DM if they never linked, or if DMs are closed.

Other notification types are acknowledged and ignored.

n8n is not wired up. `dispatchSeerrEvent` in `src/notifications.ts` is the only place that reacts to a normalized event. A later version can POST that object to an n8n webhook from that function without changing the HTTP parser.

## Uptime Kuma webhook

In Uptime Kuma, edit a notification → Add → Webhook.

- Friendly name: anything
- URL: `http://192.168.1.14:3070/kuma-webhook` (the mini PC, port `WEBHOOK_PORT`; 3070 is the published port in this setup)
- Request method: POST
- Request body: the default body is fine. The bot reads `heartbeat.status`, `monitor.name`, and `msg`. `heartbeat` and `monitor` may be objects or JSON strings.
- Custom header: name `Authorization`, value the same string as `WEBHOOK_SECRET` (no `Bearer` prefix unless that prefix is part of the secret)

Apply the notification to the monitors you care about. Status `0` posts a red "Down" embed to `STATUS_CHANNEL_ID`. Status `1` posts a green "Back up" embed. Other heartbeat statuses are ignored. If `STATUS_CHANNEL_ID` is blank, the bot answers 200 and does not post.

`/status` calls the public status page, not this webhook: `GET /api/status-page/{slug}` and `GET /api/status-page/heartbeat/{slug}`.

## Weekly jobs

The process checks every 30 seconds. On Sunday at 20:00 Asia/Dubai (or `NEW_THIS_WEEK_CRON`) it does two things, once each:

- Posts "New this week" to `ANNOUNCE_CHANNEL_ID`, using the same 7-day list as `/new`, with poster thumbnails. It does not post a message per item. Skipped when the channel is unset or nothing was added. If the bot is down during that minute, that week is skipped. There is no catch-up.
- Lists linked members with no Tautulli or Jellyfin activity for `INACTIVE_DAYS` (default 60) in the admin channel. Someone the bot cannot find in either source is left off the list. If neither Tautulli nor Jellyfin is configured, the check is skipped. Nothing is unlinked automatically.

## Arcane restart

`/restart` calls `POST /api/environments/{ARCANE_ENV_ID}/containers/{name}/restart` with header `X-Api-Key`. Arcane accepts the container id or name. The name has to be on `RESTART_ALLOWLIST`. The command only runs in `ADMIN_CHANNEL_ID`, asks for a confirm button, and then posts who restarted it in that channel.

## Beszel disk

`/disk` signs in to PocketBase at `POST /api/collections/users/auth-with-password`, then reads `systems` records. The root disk percent is `info.dp` (Beszel's field). `info.disk`, `info.diskPct`, and `info.DiskPct` are accepted if `dp` is missing. Extra filesystems on `info.efs` are shown beside the root disk. A system at 80% or more gets a warning emoji.

## Deploy

Arcane runs this stack from `/opt/docker/media-bot` on the mini PC.

```bash
cd /opt/docker/media-bot
cp .env.example .env
# fill in .env
docker compose up -d --build
docker compose run --rm --no-deps media-bot node dist/register.js
```

`compose.yaml` sets `container_name: media-bot`, `restart: unless-stopped`, `TZ=Asia/Dubai`, mounts `./data` at `/app/data`, and loads `.env`. The webhook port is published from `WEBHOOK_PORT`, which Compose reads from that same `.env`.

Re-run the register command after a command name, option, or description changes. You do not need to re-register when only the bot code changes, but you do need `docker compose up -d --build`.

On a machine with Node 20+ you can also `npm ci`, `npm run build`, and `npm run register` outside Docker. `npm test` runs the Seerr client, username-matching, and the pure-logic tests. It does not connect to Discord or Seerr.

Re-run register after pulling this update. The new slash commands are invisible until you do.

## How requests work

Search calls `GET /api/v1/search?query=...` with the query percent-encoded (`%20` for spaces, not `+`). Up to five movie and TV hits are shown as embeds. Each embed has the title, year, movie/TV, a short overview, whether it is Available, Partially available, Requested/Processing, or Not on the server, and the TMDB poster at `https://image.tmdb.org/t/p/w342{posterPath}`. People are skipped. Seerr's own search is what absorbs typos. Numbered buttons pick a result. `/search` uses the same embeds and only puts a Request button on titles that are not on the server.

Choosing a movie sends `POST /api/v1/request` with `mediaType`, `mediaId` (TMDB id), and `userId` of the linked Seerr user. Choosing a show asks for all seasons or the latest season. All seasons sends `seasons: "all"` (Seerr skips specials). Latest season sends the highest season number above 0. If Seerr says the title is already requested, already available, or has no seasons left, the bot shows that instead of an error. Quota and permission errors are shown as Seerr wrote them.

`/check` calls `GET /api/v1/user/{id}/requests?take=10&sort=added`. If the payload has no title, the bot loads the movie or TV detail, at most 10 of those calls. `/report` searches, then `POST /api/v1/issue` with Seerr's issue type (video 1, audio 2, subtitles 3, missing episode and other 4) and the internal media id. Resolved calls `POST /api/v1/issue/{id}/resolved` and DMs the reporter. Dismiss only closes the Discord card.

`/new` asks Jellyfin for `GET /Items?SortBy=DateCreated&IncludeItemTypes=Movie,Series,Episode` with `MinDateCreated`, and groups episodes by series. Without Jellyfin it uses Seerr `GET /api/v1/media?filter=available&sort=mediaAdded`. `/upcoming` loads the user's TV requests and keeps Sonarr calendar rows whose series tmdb or tvdb id matches. Only the newest 50 requests are considered.

Account linking loads `GET /api/v1/user?take=100` (and further pages when needed). A Jellyfin link matches `jellyfinUsername`, then `displayName`. A Plex link matches `plexUsername`, then `displayName`. Matching ignores case and surrounding spaces. The other service's username is not a match. Two matches at the same step are reported as ambiguous instead of guessing.

A match is not saved yet. The bot stores a pending link and posts it in the admin channel with the Discord user, the name they typed, and the Seerr user (display name, Jellyfin username, Plex username, and id). Approve saves the link and DMs the member. Deny drops it and DMs them to contact an admin. The admin message is edited with who pressed the button, and the buttons are disabled. Only Manage Server or `ADMIN_ROLE_ID` can press them. A member cannot open a second pending link, and a Seerr user cannot be pending or linked for two Discord users at once. `/request` works after approval. A pending member is told their link is awaiting approval.

The Seerr API key needs to list users, create and approve requests, and create and resolve issues. Forwarding the normalized webhook event to n8n is still not implemented.
