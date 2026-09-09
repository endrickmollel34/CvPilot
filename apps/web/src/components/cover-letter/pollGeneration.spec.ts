import { isCurrentPollGeneration } from './pollGeneration';

// The core invariant behind CoverLetterWorkspace's stale-poll-response fix:
// AN OLD ASYNC RESPONSE MUST NEVER BE ABLE TO MODIFY OR STOP A NEW POLL.
// isCurrentPollGeneration() is the exact comparison startPolling() runs
// immediately after every awaited getCoverLetter(), before touching any UI
// state (setLetter/setContent/formError.setMessage/clearInterval).
describe('isCurrentPollGeneration', () => {
  it('returns true when the response belongs to the generation currently being polled', () => {
    expect(isCurrentPollGeneration(3, 3)).toBe(true);
  });

  it('returns false for a stale response from a superseded generation (e.g. a pre-Regenerate poll resolving late)', () => {
    // The response was issued while generation 2 was active, but a new
    // Regenerate has since bumped the counter to 3 by the time it resolves.
    expect(isCurrentPollGeneration(2, 3)).toBe(false);
  });

  it('returns false for a response captured before any polling generation has started', () => {
    expect(isCurrentPollGeneration(0, 1)).toBe(false);
  });

  it('returns true for the very first polling generation (both start at 0 only before any startPolling() call)', () => {
    expect(isCurrentPollGeneration(1, 1)).toBe(true);
  });
});
