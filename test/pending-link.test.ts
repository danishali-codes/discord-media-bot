import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { LinkStore } from '../src/db';

const ada = {
  discordId: '111',
  seerrUserId: 2,
  username: 'Ada',
  service: 'jellyfin' as const,
  displayName: 'Ada Lovelace',
  jellyfinUsername: 'ada',
  plexUsername: null,
};

function openStore(): { store: LinkStore; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'pending-link-'));
  const store = new LinkStore(path.join(dir, 'bot.sqlite'));
  return {
    store,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('pending account links', () => {
  it('keeps a match pending and does not approve it', () => {
    const { store, cleanup } = openStore();
    try {
      assert.equal(store.requestLink(ada), 'pending');
      assert.equal(store.getByDiscord(ada.discordId), undefined);
      assert.deepEqual(store.getPendingByDiscord(ada.discordId), ada);
    } finally {
      cleanup();
    }
  });

  it('blocks a second pending link for the same Discord user', () => {
    const { store, cleanup } = openStore();
    try {
      assert.equal(store.requestLink(ada), 'pending');
      assert.equal(store.requestLink({ ...ada, seerrUserId: 9, username: 'other' }), 'discord-pending');
    } finally {
      cleanup();
    }
  });

  it('blocks a Seerr user that is already pending for someone else', () => {
    const { store, cleanup } = openStore();
    try {
      assert.equal(store.requestLink(ada), 'pending');
      assert.equal(store.requestLink({ ...ada, discordId: '222' }), 'seerr-pending');
    } finally {
      cleanup();
    }
  });

  it('approves the pending link into the account table and clears it', () => {
    const { store, cleanup } = openStore();
    try {
      assert.equal(store.requestLink(ada), 'pending');
      const approved = store.approvePending(ada.discordId);
      assert.equal(approved.status, 'approved');
      assert.deepEqual(store.getByDiscord(ada.discordId), {
        discordId: ada.discordId,
        seerrUserId: ada.seerrUserId,
        username: ada.username,
        service: ada.service,
      });
      assert.equal(store.getPendingByDiscord(ada.discordId), undefined);
    } finally {
      cleanup();
    }
  });

  it('blocks a Seerr user that is already linked', () => {
    const { store, cleanup } = openStore();
    try {
      assert.equal(store.requestLink(ada), 'pending');
      assert.equal(store.approvePending(ada.discordId).status, 'approved');
      assert.equal(store.requestLink({ ...ada, discordId: '333', username: 'clone' }), 'seerr-linked');
      assert.equal(store.getPendingByDiscord('333'), undefined);
    } finally {
      cleanup();
    }
  });

  it('deny drops the pending link and leaves no account', () => {
    const { store, cleanup } = openStore();
    try {
      const grace = { ...ada, discordId: '444', seerrUserId: 8, username: 'Grace', service: 'plex' as const };
      assert.equal(store.requestLink(grace), 'pending');
      const denied = store.denyPending(grace.discordId);
      assert.equal(denied?.seerrUserId, 8);
      assert.equal(store.getPendingByDiscord(grace.discordId), undefined);
      assert.equal(store.getByDiscord(grace.discordId), undefined);
      assert.equal(store.denyPending(grace.discordId), undefined);
    } finally {
      cleanup();
    }
  });
});
