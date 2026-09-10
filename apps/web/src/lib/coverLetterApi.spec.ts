import { deleteCoverLetter } from './coverLetterApi';

function jsonResponse(status: number, body: unknown = {}): Response {
  // 204 (and 205/304) must never carry a body — the Response constructor
  // throws otherwise.
  return new Response(status === 204 ? null : JSON.stringify(body), { status });
}

// Covers the frontend half of the R2-first-then-DB deletion contract (see
// cover-letter.service.ts / r2-storage.service.ts): a success must actually
// have happened on the backend, and a failure must surface the backend's
// own safe, non-internal message rather than a generic one.
describe('deleteCoverLetter', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('sends a DELETE request to /cover-letters/:id with the auth token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(204));

    await deleteCoverLetter('token-a', 'letter-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toContain('/cover-letters/letter-1');
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer token-a');
  });

  it('resolves without throwing on success (200 or 204)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    await expect(deleteCoverLetter('token-a', 'letter-1')).resolves.toBeUndefined();
  });

  it('surfaces the backend-provided message on a 503 R2-cleanup failure — never a generic override', async () => {
    const backendMessage =
      "We couldn't delete this cover letter's stored file right now. Please try again in a moment.";
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { message: backendMessage }));

    await expect(deleteCoverLetter('token-a', 'letter-1')).rejects.toMatchObject({
      message: backendMessage,
      status: 503,
    });
  });

  it('falls back to a generic, non-internal message when the error body has none', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));

    await expect(deleteCoverLetter('token-a', 'letter-1')).rejects.toMatchObject({
      message: 'Could not delete this cover letter. Please try again.',
      status: 404,
    });
  });
});
