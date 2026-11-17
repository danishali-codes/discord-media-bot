import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isStaleDecline } from '../src/notifications';

const now = new Date('2026-11-17T00:00:00Z');

describe('isStaleDecline', () => {
  it('skips declines for requests older than the cutoff', () => {
    assert.equal(isStaleDecline({ notificationType: 'MEDIA_DECLINED', requestCreatedAt: '2024-05-01T10:00:00.000Z' }, 14, now), true);
  });

  it('keeps declines for recent requests', () => {
    assert.equal(isStaleDecline({ notificationType: 'MEDIA_DECLINED', requestCreatedAt: '2026-11-15T10:00:00.000Z' }, 14, now), false);
  });

  it('keeps declines when the request date is unknown or invalid', () => {
    assert.equal(isStaleDecline({ notificationType: 'MEDIA_DECLINED' }, 14, now), false);
    assert.equal(isStaleDecline({ notificationType: 'MEDIA_DECLINED', requestCreatedAt: 'nope' }, 14, now), false);
  });

  it('never skips other notification types', () => {
    assert.equal(isStaleDecline({ notificationType: 'MEDIA_AVAILABLE', requestCreatedAt: '2024-05-01T10:00:00.000Z' }, 14, now), false);
  });
});
