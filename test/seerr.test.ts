import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SeerrClient, SeerrRequestError, posterUrl } from '../src/seerr';

type Call = { url: string; init?: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(handler: (url: string, init: RequestInit | undefined) => Response, baseUrl = 'http://seerr.test'): {
  client: SeerrClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  };
  return {
    client: new SeerrClient({ baseUrl, apiKey: 'secret-key', fetchImpl }),
    calls,
  };
}

function header(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found?.[1];
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()];
}

describe('posterUrl', () => {
  it('builds a TMDB thumbnail from a relative path', () => {
    assert.equal(posterUrl('/abc.jpg'), 'https://image.tmdb.org/t/p/w300/abc.jpg');
  });

  it('leaves absolute urls alone and drops missing posters', () => {
    assert.equal(posterUrl('https://image.tmdb.org/t/p/w600_and_h900_bestv2/abc.jpg'), 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/abc.jpg');
    assert.equal(posterUrl('https://image.tmdb.org/t/p/w600_and_h900_bestv2/null'), undefined);
    assert.equal(posterUrl(null), undefined);
  });
});

describe('SeerrClient', () => {
  it('encodes search queries with percent-encoding, including spaces and reserved characters', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { results: [] }), 'http://192.168.1.14:5055/');
    await client.search("Ocean's Eleven & A+B");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "http://192.168.1.14:5055/api/v1/search?query=Ocean's%20Eleven%20%26%20A%2BB",
    );
    assert.equal(calls[0].url.includes('+'), false);
    assert.equal(header(calls[0].init, 'X-Api-Key'), 'secret-key');
    assert.equal(calls[0].init?.method ?? 'GET', 'GET');
  });

  it('maps movie and tv hits and skips people', async () => {
    const { client } = clientWith(() =>
      jsonResponse(200, {
        results: [
          {
            id: 550,
            mediaType: 'movie',
            title: 'Fight Club',
            releaseDate: '1999-10-15',
            posterPath: '/fight.jpg',
          },
          {
            id: 1396,
            mediaType: 'tv',
            name: 'Breaking Bad',
            firstAirDate: '2008-01-20',
            posterPath: '/bb.jpg',
          },
          { id: 99, mediaType: 'person', name: 'Someone' },
          { id: 7, mediaType: 'movie', title: 'No Year' },
        ],
      }),
    );

    const hits = await client.search('fight');
    assert.deepEqual(hits, [
      { mediaType: 'movie', mediaId: 550, title: 'Fight Club', year: 1999, posterPath: '/fight.jpg' },
      { mediaType: 'tv', mediaId: 1396, title: 'Breaking Bad', year: 2008, posterPath: '/bb.jpg' },
      { mediaType: 'movie', mediaId: 7, title: 'No Year', year: undefined, posterPath: undefined },
    ]);
  });

  it('pages through the user list', async () => {
    const page = (count: number, start: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: start + index,
        jellyfinUsername: `user${start + index}`,
        plexUsername: null,
        displayName: `User ${start + index}`,
      }));
    const { client, calls } = clientWith((url) => {
      if (url.endsWith('skip=0')) {
        return jsonResponse(200, {
          pageInfo: { results: 101, page: 1, pages: 2, pageSize: 100 },
          results: page(100, 1),
        });
      }
      return jsonResponse(200, {
        pageInfo: { results: 101, page: 2, pages: 2, pageSize: 100 },
        results: [{ id: 101, jellyfinUsername: null, plexUsername: 'grace', displayName: 'Grace' }],
      });
    });

    const users = await client.listUsers();
    assert.equal(users.length, 101);
    assert.equal(users[0].jellyfinUsername, 'user1');
    assert.deepEqual(users[100], {
      id: 101,
      jellyfinUsername: null,
      plexUsername: 'grace',
      displayName: 'Grace',
    });
    assert.equal(calls[0].url, 'http://seerr.test/api/v1/user?take=100&skip=0');
    assert.equal(calls[1].url, 'http://seerr.test/api/v1/user?take=100&skip=100');
  });

  it('posts a movie request for the linked user', async () => {
    const { client, calls } = clientWith(() => jsonResponse(201, { id: 44 }));
    const result = await client.createRequest({ mediaType: 'movie', mediaId: 550, userId: 3 });
    assert.deepEqual(result, { outcome: 'created', requestId: 44 });
    assert.equal(calls[0].url, 'http://seerr.test/api/v1/request');
    assert.equal(calls[0].init?.method, 'POST');
    assert.equal(header(calls[0].init, 'Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      mediaType: 'movie',
      mediaId: 550,
      userId: 3,
    });
  });

  it('posts all seasons or a single latest season for tv', async () => {
    const { client, calls } = clientWith(() => jsonResponse(201, { id: 9 }));
    await client.createRequest({ mediaType: 'tv', mediaId: 1396, userId: 3, seasons: 'all' });
    await client.createRequest({ mediaType: 'tv', mediaId: 1396, userId: 3, seasons: [5] });
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      mediaType: 'tv',
      mediaId: 1396,
      userId: 3,
      seasons: 'all',
    });
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
      mediaType: 'tv',
      mediaId: 1396,
      userId: 3,
      seasons: [5],
    });
  });

  it('turns duplicate and already-available responses into a soft result', async () => {
    const duplicate = clientWith(() =>
      jsonResponse(409, { message: 'Request for this media already exists.' }),
    );
    assert.deepEqual(await duplicate.client.createRequest({ mediaType: 'movie', mediaId: 1, userId: 2 }), {
      outcome: 'already',
      message: 'Request for this media already exists.',
    });

    const noSeasons = clientWith(() => jsonResponse(202, { message: 'No seasons available to request' }));
    const seasons = await noSeasons.client.createRequest({
      mediaType: 'tv',
      mediaId: 1,
      userId: 2,
      seasons: 'all',
    });
    assert.equal(seasons.outcome, 'already');

    const available = clientWith(() =>
      jsonResponse(500, { message: 'This media is already available.' }),
    );
    assert.deepEqual(await available.client.createRequest({ mediaType: 'movie', mediaId: 1, userId: 2 }), {
      outcome: 'already',
      message: 'This media is already available.',
    });
  });

  it('throws SeerrRequestError for other failed requests', async () => {
    const { client } = clientWith(() => jsonResponse(403, { message: 'Series Quota exceeded.' }));
    await assert.rejects(
      client.createRequest({ mediaType: 'tv', mediaId: 1, userId: 2, seasons: [1] }),
      (error: unknown) => {
        assert.ok(error instanceof SeerrRequestError);
        assert.equal(error.status, 403);
        assert.equal(error.message, 'Series Quota exceeded.');
        return true;
      },
    );
  });

  it('loads movie details, tv seasons excluding specials, and a request summary', async () => {
    const { client, calls } = clientWith((url) => {
      if (url.endsWith('/movie/550')) {
        return jsonResponse(200, {
          id: 550,
          title: 'Fight Club',
          releaseDate: '1999-10-15',
          posterPath: '/fight.jpg',
          mediaInfo: { status: 5 },
        });
      }
      if (url.endsWith('/tv/1396')) {
        return jsonResponse(200, {
          id: 1396,
          name: 'Breaking Bad',
          firstAirDate: '2008-01-20',
          posterPath: '/bb.jpg',
          seasons: [
            { seasonNumber: 0, name: 'Specials' },
            { seasonNumber: 2, name: 'Season 2' },
            { seasonNumber: 1, name: 'Season 1' },
          ],
        });
      }
      return jsonResponse(200, {
        id: 15,
        requestedBy: { id: 3, displayName: 'Ada' },
        media: { mediaType: 'movie', tmdbId: 550 },
      });
    });

    assert.deepEqual(await client.getMovie(550), {
      mediaId: 550,
      title: 'Fight Club',
      year: 1999,
      posterPath: '/fight.jpg',
      availability: 'available',
    });
    assert.deepEqual(await client.getTv(1396), {
      mediaId: 1396,
      title: 'Breaking Bad',
      year: 2008,
      posterPath: '/bb.jpg',
      seasonNumbers: [1, 2],
    });
    assert.deepEqual(await client.getRequest(15), {
      id: 15,
      seerrUserId: 3,
      requesterName: 'Ada',
      mediaType: 'movie',
      tmdbId: 550,
    });
    assert.equal(calls[2].url, 'http://seerr.test/api/v1/request/15');
  });

  it('approves and declines by request id', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { id: 15 }));
    await client.approve(15);
    await client.decline(15);
    assert.equal(calls[0].url, 'http://seerr.test/api/v1/request/15/approve');
    assert.equal(calls[0].init?.method, 'POST');
    assert.equal(calls[1].url, 'http://seerr.test/api/v1/request/15/decline');
    assert.equal(header(calls[1].init, 'X-Api-Key'), 'secret-key');
  });

  it('reads a pending movie as already requested', async () => {
    const { client } = clientWith(() =>
      jsonResponse(200, {
        title: 'Dune',
        releaseDate: '2021-09-15',
        mediaInfo: { status: 2 },
      }),
    );
    const movie = await client.getMovie(438631);
    assert.equal(movie.availability, 'requested');
    assert.equal(movie.year, 2021);
  });
});
