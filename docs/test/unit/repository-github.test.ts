import {describe, expect, it, vi} from 'vitest';
import {readProfiles} from '../../plugins/repository-activity/github';

describe('GitHub profile batch', () => {
  it('queries commit authors in one request and returns no unassociated author', async () => {
    const send = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            data: {
              repository: {
                c0: {
                  author: {
                    user: {
                      login: 'alice',
                      name: 'Alice',
                      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
                      location: 'Kenya',
                    },
                  },
                },
                c1: {author: {user: null}},
              },
            },
          }),
          {status: 200},
        ),
    );
    const result = await readProfiles(
      ['a'.repeat(40), 'b'.repeat(40)],
      'token',
      send as typeof fetch,
    );
    expect(result).toEqual([
      {
        login: 'alice',
        name: 'Alice',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1',
        location: 'Kenya',
      },
      null,
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0]?.[1]?.body)).toContain('avatarUrl(size: 92)');
  });
  it('rejects API errors, missing objects and malformed commit IDs', async () => {
    const failing = vi.fn(
      async () => new Response(JSON.stringify({errors: [{message: 'denied'}]}), {status: 200}),
    );
    await expect(
      readProfiles(['a'.repeat(40)], 'token', failing as typeof fetch),
    ).rejects.toThrow();
    await expect(readProfiles(['invalid'], 'token', failing as typeof fetch)).rejects.toThrow();
    await expect(
      readProfiles(['a'.repeat(41)], 'token', failing as typeof fetch),
    ).rejects.toThrow();
  });
});

it('includes curated core profiles in the same GraphQL request', async () => {
  const maintainer = {
    login: 'profd2004',
    name: 'Darlington',
    avatarUrl: 'https://avatars.githubusercontent.com/u/2',
    location: 'Kenya',
  };
  const send = vi.fn(
    async () =>
      new Response(
        JSON.stringify({data: {repository: {c0: {author: {user: null}}}, u0: maintainer}}),
      ),
  );
  const result = await readProfiles(['a'.repeat(40)], 'token', send as typeof fetch, ['profd2004']);
  expect(send).toHaveBeenCalledOnce();
  expect(result).toEqual([null, maintainer]);
});

it('keeps valid contributors when a curated core profile no longer exists', async () => {
  const send = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: {repository: {c0: {author: {user: null}}}, u0: null},
          errors: [{path: ['u0'], message: 'not found'}],
        }),
      ),
  );
  expect(await readProfiles(['a'.repeat(40)], 'token', send as typeof fetch, ['gone'])).toEqual([
    null,
    null,
  ]);
});
