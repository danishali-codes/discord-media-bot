import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchSeerrUser, type MatchableUser } from '../src/match';

const users: MatchableUser[] = [
  { id: 1, jellyfinUsername: 'Ada', plexUsername: null, displayName: 'Ada Lovelace' },
  { id: 2, jellyfinUsername: null, plexUsername: 'Grace', displayName: 'Grace Hopper' },
  { id: 3, jellyfinUsername: 'linus', plexUsername: 'torvalds', displayName: 'Linus Torvalds' },
  { id: 6, jellyfinUsername: 'not-linus', plexUsername: null, displayName: 'linus' },
  { id: 4, jellyfinUsername: null, plexUsername: null, displayName: 'Sam' },
  { id: 5, jellyfinUsername: 'other', plexUsername: null, displayName: 'Sam' },
];

describe('matchSeerrUser', () => {
  it('matches a Jellyfin username without caring about case or surrounding space', () => {
    const result = matchSeerrUser(users, '  ada  ', 'jellyfin');
    assert.equal(result.status, 'found');
    if (result.status === 'found') assert.equal(result.user.id, 1);
  });

  it('matches a Plex username', () => {
    const result = matchSeerrUser(users, 'GRACE', 'plex');
    assert.equal(result.status, 'found');
    if (result.status === 'found') assert.equal(result.user.id, 2);
  });

  it('falls back to display name when the service username does not match', () => {
    const result = matchSeerrUser(users, 'ada lovelace', 'jellyfin');
    assert.equal(result.status, 'found');
    if (result.status === 'found') assert.equal(result.user.id, 1);
  });

  it('prefers the service username over someone else\'s display name', () => {
    const result = matchSeerrUser(users, 'linus', 'jellyfin');
    assert.equal(result.status, 'found');
    if (result.status === 'found') assert.equal(result.user.id, 3);
  });

  it('does not treat the other service username as a match', () => {
    const result = matchSeerrUser(users, 'torvalds', 'jellyfin');
    assert.equal(result.status, 'none');
  });

  it('reports none when nothing matches', () => {
    assert.deepEqual(matchSeerrUser(users, 'nobody', 'plex'), { status: 'none' });
  });

  it('reports none for a blank username', () => {
    assert.deepEqual(matchSeerrUser(users, '   ', 'jellyfin'), { status: 'none' });
  });

  it('reports ambiguous when two display names match and no service username does', () => {
    assert.deepEqual(matchSeerrUser(users, 'sam', 'plex'), { status: 'ambiguous' });
  });

  it('reports ambiguous when two service usernames match', () => {
    const duplicated: MatchableUser[] = [
      { id: 8, jellyfinUsername: 'Twin', displayName: 'One' },
      { id: 9, jellyfinUsername: 'twin', displayName: 'Two' },
    ];
    assert.deepEqual(matchSeerrUser(duplicated, 'Twin', 'jellyfin'), { status: 'ambiguous' });
  });
});
