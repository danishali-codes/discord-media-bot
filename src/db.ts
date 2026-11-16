import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { LinkService } from './match';

export type LinkRecord = {
  discordId: string;
  seerrUserId: number;
  username: string;
  service: LinkService;
};

export type PendingLink = LinkRecord & {
  displayName: string | null;
  jellyfinUsername: string | null;
  plexUsername: string | null;
};

export type LinkRequestResult = 'pending' | 'discord-pending' | 'seerr-linked' | 'seerr-pending';

export type ApprovePendingResult = { status: 'approved'; link: PendingLink } | { status: 'missing' } | { status: 'seerr-taken' };

type LinkRow = {
  discord_id: string;
  seerr_user_id: number;
  username: string;
  service: string;
};

type PendingRow = LinkRow & {
  display_name: string | null;
  jellyfin_username: string | null;
  plex_username: string | null;
};

export class LinkStore {
  private readonly db: Database.Database;

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS account_links (
        discord_id TEXT PRIMARY KEY,
        seerr_user_id INTEGER NOT NULL UNIQUE,
        username TEXT NOT NULL,
        service TEXT NOT NULL,
        linked_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_links (
        discord_id TEXT PRIMARY KEY,
        seerr_user_id INTEGER NOT NULL UNIQUE,
        username TEXT NOT NULL,
        service TEXT NOT NULL,
        display_name TEXT,
        jellyfin_username TEXT,
        plex_username TEXT,
        created_at TEXT NOT NULL
      )
    `);
  }

  getByDiscord(discordId: string): LinkRecord | undefined {
    const row = this.db
      .prepare('SELECT discord_id, seerr_user_id, username, service FROM account_links WHERE discord_id = ?')
      .get(discordId) as LinkRow | undefined;
    return mapRow(row);
  }

  getBySeerr(seerrUserId: number): LinkRecord | undefined {
    const row = this.db
      .prepare('SELECT discord_id, seerr_user_id, username, service FROM account_links WHERE seerr_user_id = ?')
      .get(seerrUserId) as LinkRow | undefined;
    return mapRow(row);
  }

  link(input: LinkRecord): 'linked' | 'seerr-taken' {
    const existing = this.getBySeerr(input.seerrUserId);
    if (existing && existing.discordId !== input.discordId) return 'seerr-taken';
    try {
      this.db
        .prepare(
          `INSERT INTO account_links (discord_id, seerr_user_id, username, service, linked_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(discord_id) DO UPDATE SET
             seerr_user_id = excluded.seerr_user_id,
             username = excluded.username,
             service = excluded.service,
             linked_at = excluded.linked_at`,
        )
        .run(input.discordId, input.seerrUserId, input.username, input.service, new Date().toISOString());
    } catch (error) {
      if (isUniqueConstraint(error)) return 'seerr-taken';
      throw error;
    }
    return 'linked';
  }

  requestLink(input: PendingLink): LinkRequestResult {
    if (this.getPendingByDiscord(input.discordId)) return 'discord-pending';
    if (this.getBySeerr(input.seerrUserId)) return 'seerr-linked';
    if (this.getPendingBySeerr(input.seerrUserId)) return 'seerr-pending';
    try {
      this.db
        .prepare(
          `INSERT INTO pending_links (
             discord_id, seerr_user_id, username, service, display_name, jellyfin_username, plex_username, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.discordId,
          input.seerrUserId,
          input.username,
          input.service,
          input.displayName,
          input.jellyfinUsername,
          input.plexUsername,
          new Date().toISOString(),
        );
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      if (this.getPendingByDiscord(input.discordId)) return 'discord-pending';
      return 'seerr-pending';
    }
    return 'pending';
  }

  getPendingByDiscord(discordId: string): PendingLink | undefined {
    const row = this.db.prepare('SELECT * FROM pending_links WHERE discord_id = ?').get(discordId) as PendingRow | undefined;
    return mapPending(row);
  }

  getPendingBySeerr(seerrUserId: number): PendingLink | undefined {
    const row = this.db
      .prepare('SELECT * FROM pending_links WHERE seerr_user_id = ?')
      .get(seerrUserId) as PendingRow | undefined;
    return mapPending(row);
  }

  approvePending(discordId: string): ApprovePendingResult {
    const decide = this.db.transaction((): ApprovePendingResult => {
      const pending = this.getPendingByDiscord(discordId);
      if (!pending) return { status: 'missing' };
      if (this.link(pending) === 'seerr-taken') return { status: 'seerr-taken' };
      this.db.prepare('DELETE FROM pending_links WHERE discord_id = ?').run(discordId);
      return { status: 'approved', link: pending };
    });
    return decide();
  }

  denyPending(discordId: string): PendingLink | undefined {
    const pending = this.getPendingByDiscord(discordId);
    if (!pending) return undefined;
    this.db.prepare('DELETE FROM pending_links WHERE discord_id = ?').run(discordId);
    return pending;
  }

  unlink(discordId: string): boolean {
    const result = this.db.prepare('DELETE FROM account_links WHERE discord_id = ?').run(discordId);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

export function openDatabase(file = 'data/bot.sqlite'): LinkStore {
  return new LinkStore(file);
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

function mapPending(row: PendingRow | undefined): PendingLink | undefined {
  const link = mapRow(row);
  if (!row || !link) return undefined;
  return {
    ...link,
    displayName: row.display_name,
    jellyfinUsername: row.jellyfin_username,
    plexUsername: row.plex_username,
  };
}

function mapRow(row: LinkRow | undefined): LinkRecord | undefined {
  if (!row) return undefined;
  if (row.service !== 'jellyfin' && row.service !== 'plex') return undefined;
  return {
    discordId: row.discord_id,
    seerrUserId: row.seerr_user_id,
    username: row.username,
    service: row.service,
  };
}
