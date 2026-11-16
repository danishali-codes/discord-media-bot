# media-bot

Discord bot for Danish's home media server. Members link a Jellyfin or Plex account, request movies and shows through Seerr, and admins approve or decline those requests from Discord.

v1 stops there. Later commands are listed at the bottom and are not implemented.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/link-account username service` | Any member | Matches `username` to a Seerr user (`jellyfin` or `plex`) and stores the Discord id. |
| `/unlink-account` | Any member | Removes that link. |
| `/request title` | Linked member | Search Seerr and request a movie, or a whole series / its latest season. Only works in `REQUESTS_CHANNEL_ID`. |

`/link-account` and `/unlink-account` can be used in the server or in a DM with the bot. `/request` has to be used in the requests channel.

When someone joins the server, the bot DMs them and asks them to run `/link-account`. That DM is skipped if they have DMs closed. Approve, decline, and available notices are also DMs, and those fail quietly when DMs are closed.

## Discord app

1. Create an application at <https://discord.com/developers/applications>.
2. Bot tab: reset the token. That value is `DISCORD_TOKEN`.
3. Enable the privileged **Server Members Intent**. The bot asks Discord for the Guilds and Guild Members intents. Message Content is not used. Without Server Members Intent the process will not stay connected, and join DMs will not fire.
4. OAuth2 URL Generator: scopes `bot` and `applications.commands`. Bot permissions: View Channels, Send Messages, Embed Links. Invite it into the server.
5. Copy the application id into `DISCORD_CLIENT_ID`. Enable Discord developer mode, then copy the server id (`DISCORD_GUILD_ID`), the admin channel id (`ADMIN_CHANNEL_ID`), and the requests channel id (`REQUESTS_CHANNEL_ID`).
6. Optional: copy a role id into `ADMIN_ROLE_ID`. Approve and Decline otherwise require the Discord Administrator permission.

Register the slash commands after the bot is in the server (see Deploy). Registration is guild-scoped, so the commands show up immediately in that server only.

## Environment

Copy `.env.example` to `.env`. Values stay out of git.

| Name | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Bot token. |
| `DISCORD_CLIENT_ID` | Application id. |
| `DISCORD_GUILD_ID` | Server where commands are registered and join DMs are sent. |
| `ADMIN_CHANNEL_ID` | Channel that receives pending-request embeds. |
| `REQUESTS_CHANNEL_ID` | Only channel where `/request` runs. |
| `SEERR_URL` | Seerr base URL, for example `http://192.168.1.14:5055`. No path, no trailing slash required. |
| `SEERR_API_KEY` | Admin API key. It must be allowed to list users, create requests for another user (`userId`), and approve or decline. |
| `WEBHOOK_SECRET` | Exact `Authorization` header value Seerr sends. No `Bearer` prefix unless you put the same prefix in both places. |
| `WEBHOOK_PORT` | Port the webhook listens on, inside the container and on the host. |
| `ADMIN_ROLE_ID` | Optional. Members with this role may press Approve / Decline, along with anyone who has Administrator. |

The SQLite file is `data/bot.sqlite` (mounted at `/app/data` in Docker). Deleting it drops every account link.

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

- `MEDIA_PENDING`: embed in the admin channel with requester, title, year, and poster, plus Approve and Decline. Approve calls `POST /api/v1/request/{id}/approve`. Decline calls `POST /api/v1/request/{id}/decline`. The message is then edited with the outcome and who pressed the button.
- `MEDIA_APPROVED`, `MEDIA_AUTO_APPROVED`, `MEDIA_DECLINED`, `MEDIA_AVAILABLE`: DM the linked requester. No DM if they never linked, or if DMs are closed.

Other notification types are acknowledged and ignored.

n8n is not wired up. `dispatchSeerrEvent` in `src/notifications.ts` is the only place that reacts to a normalized event. A later version can POST that object to an n8n webhook from that function without changing the HTTP parser.

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

Re-run the register command after command options change. You do not need to re-register when only the bot code changes, but you do need `docker compose up -d --build`.

On a machine with Node 20+ you can also `npm ci`, `npm run build`, and `npm run register` outside Docker. `npm test` runs the Seerr client and username-matching tests. It does not connect to Discord or Seerr.

## How requests work

Search calls `GET /api/v1/search?query=...` with the query percent-encoded (`%20` for spaces, not `+`). Up to five movie and TV hits are shown. People are skipped. Seerr's own search is what absorbs typos.

Choosing a movie sends `POST /api/v1/request` with `mediaType`, `mediaId` (TMDB id), and `userId` of the linked Seerr user. Choosing a show asks for all seasons or the latest season. All seasons sends `seasons: "all"` (Seerr skips specials). Latest season sends the highest season number above 0. If Seerr says the title is already requested, already available, or has no seasons left, the bot shows that instead of an error. Quota and permission errors are shown as Seerr wrote them.

Account linking loads `GET /api/v1/user?take=100` (and further pages when needed). A Jellyfin link matches `jellyfinUsername`, then `displayName`. A Plex link matches `plexUsername`, then `displayName`. Matching ignores case and surrounding spaces. The other service's username is not a match. Two matches at the same step are reported as ambiguous instead of guessing.

## Roadmap

Not in v1:

- `/check` for whether something is already in the library
- `/search` without creating a request
- `/link` for media links
- `/status` from Uptime Kuma
- `/report` for playback problems
- announcements
- forwarding the normalized webhook event to n8n
