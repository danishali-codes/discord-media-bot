import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodePurge, encodePurge, selectPage, splitByAge, type PurgeSpec } from '../src/purge';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 18);
const msg = (id: string, ageDays: number, extra: Partial<{ pinned: boolean; authorId: string }> = {}) => ({
  id,
  createdTimestamp: now - ageDays * DAY,
  pinned: extra.pinned ?? false,
  authorId: extra.authorId ?? '1',
});

describe('purge button id', () => {
  it('round-trips a spec', () => {
    const spec: PurgeSpec = { mode: 'days', amount: 3, userId: '219895146681073675', pinned: true };
    assert.deepEqual(decodePurge(encodePurge(spec)), spec);
    assert.deepEqual(decodePurge(encodePurge({ mode: 'count', amount: 50, pinned: false })), {
      mode: 'count',
      amount: 50,
      userId: undefined,
      pinned: false,
    });
  });

  it('rejects tampered or out-of-range ids', () => {
    assert.equal(decodePurge('purge:yes:count:5000:-:0'), undefined);
    assert.equal(decodePurge('purge:yes:days:31:-:0'), undefined);
    assert.equal(decodePurge('purge:yes:all:5:-:0'), undefined);
    assert.equal(decodePurge('purge:yes:count:5:abc:0'), undefined);
    assert.equal(decodePurge('restart:yes:x'), undefined);
  });
});

describe('selectPage', () => {
  it('stops at the requested count and skips pins by default', () => {
    const page = [msg('a', 0), msg('b', 0, { pinned: true }), msg('c', 1), msg('d', 2)];
    const out = selectPage(page, { mode: 'count', amount: 2, pinned: false }, 0, now);
    assert.deepEqual(out.picked.map((m) => m.id), ['a', 'c']);
    assert.equal(out.done, true);
  });

  it('counts across pages', () => {
    const out = selectPage([msg('x', 0), msg('y', 0)], { mode: 'count', amount: 3, pinned: false }, 2, now);
    assert.deepEqual(out.picked.map((m) => m.id), ['x']);
    assert.equal(out.done, true);
  });

  it('stops at the day cutoff and filters by user', () => {
    const page = [msg('a', 0.5, { authorId: '2' }), msg('b', 1, { authorId: '1' }), msg('c', 1.5, { authorId: '2' }), msg('d', 3, { authorId: '2' })];
    const out = selectPage(page, { mode: 'days', amount: 2, userId: '2', pinned: false }, 0, now);
    assert.deepEqual(out.picked.map((m) => m.id), ['a', 'c']);
    assert.equal(out.done, true);
  });

  it('keeps paging when the cutoff is not reached', () => {
    const out = selectPage([msg('a', 0), msg('b', 1)], { mode: 'days', amount: 5, pinned: false }, 0, now);
    assert.equal(out.done, false);
  });
});

describe('splitByAge', () => {
  it('sends messages near or past 14 days to single deletes', () => {
    const { bulk, single } = splitByAge([msg('a', 1), msg('b', 13.99), msg('c', 14), msg('d', 20)], now);
    assert.deepEqual(bulk.map((m) => m.id), ['a']);
    assert.deepEqual(single.map((m) => m.id), ['b', 'c', 'd']);
  });
});
