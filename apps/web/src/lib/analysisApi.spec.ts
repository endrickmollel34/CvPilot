import { deleteAnalysis } from './analysisApi';

function jsonResponse(status: number, body: unknown = {}): Response {
  // 204 (and 205/304) must never carry a body — the Response constructor
  // throws otherwise.
  return new Response(status === 204 ? null : JSON.stringify(body), { status });
}

describe('deleteAnalysis', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('sends a DELETE request to /analyses/:id with the auth token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(204));

    await deleteAnalysis('token-a', 'analysis-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toContain('/analyses/analysis-1');
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer token-a');
  });

  it('resolves without throwing on success (200 or 204)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    await expect(deleteAnalysis('token-a', 'analysis-1')).resolves.toBeUndefined();
  });

  it('surfaces the backend-provided message on failure rather than a generic override', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: 'Not allowed.' }));

    await expect(deleteAnalysis('token-a', 'analysis-1')).rejects.toMatchObject({
      message: 'Not allowed.',
      status: 403,
    });
  });

  it('falls back to a generic, non-internal message when the error body has none', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));

    await expect(deleteAnalysis('token-a', 'analysis-1')).rejects.toMatchObject({
      message: 'Could not delete this analysis. Please try again.',
      status: 404,
    });
  });
});
