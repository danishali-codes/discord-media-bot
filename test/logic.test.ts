import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAllowed, parseAllowlist } from '../src/allow';
import {
  combinedStatus,
  formatRequestLine,
  libraryLabel,
  libraryState,
  mapUserRequest,
  requestMatches,
} from '../src/check-format';
import { formatMonitor, parseKumaWebhook, parseStatusPage } from '../src/kuma';
import { classifyActivity, filterUpcoming, groupNewItems, newItemDetail } from '../src/library';
import { collectLinks, parseExtraLinks } from '../src/links';
import { buildIssue, chooseReportTarget, parseProblem } from '../src/report';
import { isScheduleDue, parseCron } from '../src/schedule';
import { posterUrl } from '../src/seerr';

describe('posterUrl', () => {
  it('builds a w342 TMDB url and keeps the w300 default', () => {
    assert.equal(posterUrl('/abc.jpg', 'w342'), 'https://image.tmdb.org/t/p/w342/abc.jpg');
    assert.equal(posterUrl('abc.jpg'), 'https://image.tmdb.org/t/p/w300/abc.jpg');
  });

  it('drops missing posters and leaves absolute urls alone', () => {
    assert.equal(posterUrl(null, 'w342'), undefined);
    assert.equal(posterUrl('  ', 'w342'), undefined);
    assert.equal(posterUrl('/null', 'w342'), undefined);
    assert.equal(posterUrl('https://image.tmdb.org/t/p/w342/abc.jpg', 'w342'), 'https://image.tmdb.org/t/p/w342/abc.jpg');
  });
});

describe('request status', () => {
  it('combines request status and media status', () => {
    assert.deepEqual(combinedStatus('pending', 'processing'), { emoji: '⏳', text: 'Pending approval' });
    assert.deepEqual(combinedStatus('approved', 'available'), { emoji: '✅', text: 'Approved · available' });
    assert.deepEqual(combinedStatus('approved', 'partial'), { emoji: '🟡', text: 'Approved · partially available' });
    assert.deepEqual(combinedStatus('approved', 'processing'), { emoji: '⬇️', text: 'Approved · downloading' });
    assert.deepEqual(combinedStatus('declined', 'processing'), { emoji: '❌', text: 'Declined' });
  });

  it('formats a line and filters by title', () => {
    const line = formatRequestLine({
      title: 'Dune',
      year: 2021,
      mediaType: 'movie',
      requestedAt: '2026-11-15T16:30:00.000Z',
      requestStatus: 'approved',
      mediaStatus: 'available',
    });
    assert.equal(line, '✅ Dune (2021) · Movie · 15 Nov 2026 · Approved · available');
    assert.equal(requestMatches('Dune', 'dun'), true);
    assert.equal(requestMatches('Dune', 'blade'), false);
    assert.equal(requestMatches('Dune', '  '), true);
  });

  it('maps a Seerr user-request payload', () => {
    const mapped = mapUserRequest({
      id: 9,
      status: 2,
      createdAt: '2026-11-01T00:00:00.000Z',
      type: 'tv',
      media: { tmdbId: 1396, tvdbId: 81189, status: 3 },
    });
    assert.equal(mapped?.requestStatus, 'approved');
    assert.equal(mapped?.mediaStatus, 'processing');
    assert.equal(mapped?.tmdbId, 1396);
    assert.equal(mapped?.tvdbId, 81189);
  });

  it('labels library availability', () => {
    assert.equal(libraryState(5), 'available');
    assert.equal(libraryState('PARTIALLY_AVAILABLE'), 'partial');
    assert.equal(libraryState(2), 'requested');
    assert.equal(libraryState(undefined), 'absent');
    assert.deepEqual(libraryLabel('requested'), { emoji: '⏳', text: 'Requested/Processing' });
    assert.deepEqual(libraryLabel(undefined), { emoji: '⬜', text: 'Not on the server' });
  });
});

describe('links', () => {
  it('keeps only configured http links and parses extras', () => {
    assert.deepEqual(
      collectLinks({
        jellyfin: 'http://192.168.1.14:8096',
        plex: '',
        seerr: 'not a url',
        status: 'https://status.example',
        extra: 'Docs|https://jellyfin.org/docs, bad, Plex App|https://app.plex.tv',
      }),
      [
        { name: 'Jellyfin', url: 'http://192.168.1.14:8096' },
        { name: 'Status', url: 'https://status.example' },
        { name: 'Docs', url: 'https://jellyfin.org/docs' },
        { name: 'Plex App', url: 'https://app.plex.tv' },
      ],
    );
    assert.deepEqual(parseExtraLinks(undefined), []);
  });
});

describe('kuma', () => {
  it('reads monitor state and 24h uptime', () => {
    const views = parseStatusPage(
      { publicGroupList: [{ name: 'Core', monitorList: [{ id: 1, name: 'Jellyfin' }, { id: 2, name: 'Seerr' }] }] },
      {
        heartbeatList: { '1': [{ status: 0 }, { status: 1 }], '2': [{ status: 0 }] },
        uptimeList: { '1_24': 0.998, '2_24': 0.9 },
      },
    );
    assert.deepEqual(views, [
      { name: 'Jellyfin', state: 'up', uptime24: 0.998 },
      { name: 'Seerr', state: 'down', uptime24: 0.9 },
    ]);
    assert.equal(formatMonitor(views[0]), '✅ Jellyfin — up · 99.8% uptime (24h)');
    assert.equal(formatMonitor(views[1]), '🔴 Seerr — down · 90.0% uptime (24h)');
  });

  it('parses a down webhook, an up webhook, and ignores other heartbeats', () => {
    assert.deepEqual(
      parseKumaWebhook({
        heartbeat: { status: 0, msg: 'timeout' },
        monitor: { name: 'Jellyfin' },
        msg: 'Jellyfin is down',
      }),
      { kind: 'down', name: 'Jellyfin', message: 'Jellyfin is down' },
    );
    assert.deepEqual(parseKumaWebhook({ heartbeat: '{"status":1}', monitor: '{"name":"Seerr"}' }), {
      kind: 'up',
      name: 'Seerr',
    });
    assert.deepEqual(parseKumaWebhook({ heartbeat: { status: 2 }, monitor: { name: 'Seerr' } }), { kind: 'ignore' });
    assert.equal(parseKumaWebhook({ heartbeat: { status: 0 } }), undefined);
  });
});

describe('report issues', () => {
  it('maps problem types onto Seerr issue numbers', () => {
    assert.equal(parseProblem('subtitles'), 'subtitles');
    assert.equal(parseProblem('nope'), undefined);
    assert.deepEqual(
      buildIssue({ problem: 'video', description: 'Black screen', mediaId: 4, reporter: 'ada#1' }),
      { issueType: 1, mediaId: 4, message: 'Video\nBlack screen\n\nReported on Discord by ada#1' },
    );
    assert.equal(buildIssue({ problem: 'missing', description: 'S02E03', mediaId: 8, reporter: 'ada' }).issueType, 4);
    assert.match(
      buildIssue({ problem: 'missing', description: 'S02E03', mediaId: 8, reporter: 'ada' }).message,
      /^Missing episode/,
    );
  });

  it('picks one on-server match, an exact title, or a menu', () => {
    const dune = { mediaType: 'movie' as const, tmdbId: 1, title: 'Dune', seerrMediaId: 10, onServer: true };
    const duneOld = { mediaType: 'movie' as const, tmdbId: 2, title: 'Dune', year: 1984, seerrMediaId: 11, onServer: true };
    const missing = { mediaType: 'movie' as const, tmdbId: 3, title: 'Nope', onServer: false };
    assert.equal(chooseReportTarget([dune, missing], 'anything').action, 'use');
    assert.equal(chooseReportTarget([missing], 'nope').action, 'none');
    const exact = chooseReportTarget(
      [dune, { ...duneOld, title: 'Blade Runner' }],
      'blade runner',
    );
    assert.equal(exact.action, 'use');
    if (exact.action === 'use') assert.equal(exact.candidate.tmdbId, 2);
    assert.equal(chooseReportTarget([dune, duneOld], 'dune').action, 'choose');
  });
});

describe('new items', () => {
  it('groups episodes by series and keeps movies separate', () => {
    const grouped = groupNewItems([
      { kind: 'episode', title: 'Pilot', seriesTitle: 'The Bear', seriesKey: 's1', createdAt: '2026-11-10T00:00:00.000Z', tmdbId: 5 },
      { kind: 'episode', title: 'Review', seriesTitle: 'The Bear', seriesKey: 's1', createdAt: '2026-11-14T00:00:00.000Z' },
      { kind: 'series', title: 'The Bear', seriesKey: 's1', year: 2022, createdAt: '2026-11-01T00:00:00.000Z' },
      { kind: 'movie', title: 'Dune', year: 2021, createdAt: '2026-11-12T00:00:00.000Z', tmdbId: 9 },
      { kind: 'episode', title: 'Ep 1', seriesTitle: 'Slow Horses', createdAt: '2026-11-11T00:00:00.000Z' },
    ]);
    assert.deepEqual(
      grouped.map((item) => ({ title: item.title, detail: newItemDetail(item), tmdbId: item.tmdbId, year: item.year })),
      [
        { title: 'The Bear', detail: '2 new episodes', tmdbId: 5, year: 2022 },
        { title: 'Dune', detail: 'Movie', tmdbId: 9, year: 2021 },
        { title: 'Slow Horses', detail: '1 new episode', tmdbId: undefined, year: undefined },
      ],
    );
  });
});

describe('upcoming', () => {
  it('keeps episodes whose show matches a requested tmdb or tvdb id', () => {
    const episodes = [
      { show: 'The Bear', season: 3, episode: 1, tmdbId: 5 },
      { show: 'Other', tvdbId: 99 },
      { show: 'Slow Horses', tvdbId: 40, tmdbId: 8 },
      { show: 'No ids' },
    ];
    assert.deepEqual(filterUpcoming(episodes, { tmdbIds: [5], tvdbIds: [40] }).map((episode) => episode.show), [
      'The Bear',
      'Slow Horses',
    ]);
  });
});

describe('allowlist', () => {
  it('parses container names and rejects anything outside the list', () => {
    assert.deepEqual(parseAllowlist(' sonarr, jellyfin, sonarr, bad:name , '), ['sonarr', 'jellyfin']);
    assert.equal(isAllowed(['sonarr'], 'sonarr'), true);
    assert.equal(isAllowed(['sonarr'], 'sonarr2'), false);
    assert.equal(isAllowed(['sonarr'], 'Sonarr'), false);
  });
});

describe('schedule', () => {
  it('parses a Sunday 20:00 cron and matches Asia/Dubai', () => {
    assert.deepEqual(parseCron('0 20 * * 0'), { minute: 0, hour: 20, weekday: 0 });
    assert.deepEqual(parseCron('0 20 * * SUN'), { minute: 0, hour: 20, weekday: 0 });
    assert.deepEqual(parseCron('0 20 * * 7'), { minute: 0, hour: 20, weekday: 0 });
    assert.equal(parseCron('0 20 * * *'), undefined);
    assert.equal(parseCron('*/5 20 * * 0'), undefined);

    const sundayDubai = new Date('2026-11-15T16:00:00.000Z');
    const first = isScheduleDue(parseCron('0 20 * * 0')!, sundayDubai, 'Asia/Dubai', undefined);
    assert.equal(first.due, true);
    assert.equal(isScheduleDue(parseCron('0 20 * * 0')!, sundayDubai, 'Asia/Dubai', first.key).due, false);
    assert.equal(isScheduleDue(parseCron('0 20 * * 0')!, new Date('2026-11-15T16:01:00.000Z'), 'Asia/Dubai', undefined).due, false);
    assert.equal(isScheduleDue(parseCron('0 20 * * 1')!, sundayDubai, 'Asia/Dubai', undefined).due, false);
  });
});

describe('inactivity', () => {
  const now = new Date('2026-11-16T12:00:00.000Z');

  it('flags a matched user with no recent activity and skips unknowns', () => {
    const old = new Date('2026-08-01T00:00:00.000Z');
    const recent = new Date('2026-11-10T00:00:00.000Z');
    assert.equal(classifyActivity([{ matched: true, at: old }], now, 60), 'inactive');
    assert.equal(classifyActivity([{ matched: true, at: recent }], now, 60), 'active');
    assert.equal(classifyActivity([{ matched: true }], now, 60), 'inactive');
    assert.equal(classifyActivity([{ matched: false }], now, 60), 'unknown');
    assert.equal(
      classifyActivity(
        [
          { matched: true, at: old },
          { matched: true, at: recent },
        ],
        now,
        60,
      ),
      'active',
    );
  });
});
