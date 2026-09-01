import { authFetch } from './authFetch';

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status });
}

const URL = 'https://api.example.com/thing';

describe('authFetch', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('first request succeeds — no retry, token fetched without skipCache', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const getToken = jest.fn().mockResolvedValue('token-a');

    const res = await authFetch(URL, getToken, { method: 'GET' });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledWith(undefined);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token-a');
  });

  it('first request 401 → forced refresh → retry succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const getToken = jest
      .fn()
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('fresh-token');

    const res = await authFetch(URL, getToken, { method: 'GET' });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenNthCalledWith(1, undefined);
    expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer stale-token');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token');
  });

  it('first request 401 → fresh token unavailable → fails normally with the original 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401));
    const getToken = jest.fn().mockResolvedValueOnce('stale-token').mockResolvedValueOnce(null);

    const res = await authFetch(URL, getToken, { method: 'GET' });

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('second request also 401 → no third attempt', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401)).mockResolvedValueOnce(jsonResponse(401));
    const getToken = jest
      .fn()
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('still-stale-token');

    const res = await authFetch(URL, getToken, { method: 'GET' });

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it.each([403, 404, 409, 429, 500, 503])('does not retry on a %i response', async (status) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status));
    const getToken = jest.fn().mockResolvedValue('token-a');

    const res = await authFetch(URL, getToken, { method: 'GET' });

    expect(res.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('a pre-resolved string token never triggers a retry, even on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401));

    const res = await authFetch(URL, 'server-token', { method: 'GET' });

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer server-token');
  });

  it('preserves method, headers, and body across both attempts', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const getToken = jest
      .fn()
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('fresh-token');

    const body = JSON.stringify({ title: 'Untitled CV' });
    await authFetch(URL, getToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    for (const call of fetchMock.mock.calls) {
      const [, init] = call;
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.body).toBe(body);
    }
  });
});
