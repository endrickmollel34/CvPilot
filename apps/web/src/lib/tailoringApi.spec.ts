import { deleteTailoring } from './tailoringApi';

function jsonResponse(status: number, body: unknown = {}): Response {
  // 204 (and 205/304) must never carry a body — the Response constructor
  // throws otherwise.
  return new Response(status === 204 ? null : JSON.stringify(body), { status });
}

describe('deleteTailoring', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('sends a DELETE request to /tailorings/:id with the auth token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(204));

    await deleteTailoring('token-a', 'tailoring-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toContain('/tailorings/tailoring-1');
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer token-a');
  });

  it('resolves without throwing on success (200 or 204)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    await expect(deleteTailoring('token-a', 'tailoring-1')).resolves.toBeUndefined();
  });

  it('surfaces the backend-provided message on failure rather than a generic override', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: 'Not allowed.' }));

    await expect(deleteTailoring('token-a', 'tailoring-1')).rejects.toMatchObject({
      message: 'Not allowed.',
      status: 403,
    });
  });

  it('falls back to a generic, non-internal message when the error body has none', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));

    await expect(deleteTailoring('token-a', 'tailoring-1')).rejects.toMatchObject({
      message: 'Could not delete this tailoring. Please try again.',
      status: 404,
    });
  });
});
