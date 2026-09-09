/**
 * Cover Letter live-poll staleness guard, used by CoverLetterWorkspace's
 * startPolling(). Each call to startPolling()/stopPolling() bumps a shared
 * generation counter; every in-flight getCoverLetter() response captures
 * the counter value active when it was issued and must be compared against
 * the CURRENT counter before it's allowed to touch UI state. A response
 * whose captured generation no longer matches belongs to a poll cycle that
 * has since been superseded (e.g. by a new Regenerate) and must be ignored
 * outright — it must never overwrite fresher state, show a stale error, or
 * stop the new interval.
 *
 * Extracted as a plain, dependency-free function (rather than inlined)
 * specifically so this invariant is independently unit-testable: the rest
 * of CoverLetterWorkspace.tsx is a .tsx file that this repo's current
 * apps/web jest config (transform pattern `^.+\.(t|j)s$`, testEnvironment
 * "node") cannot import into a spec file at all.
 */
export function isCurrentPollGeneration(
  capturedGeneration: number,
  currentGeneration: number,
): boolean {
  return capturedGeneration === currentGeneration;
}
