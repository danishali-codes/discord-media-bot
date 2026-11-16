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

type LinkRow = {
  discord_id: string;
  seerr_user_id: number;
  username: string;
  service: string;
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
