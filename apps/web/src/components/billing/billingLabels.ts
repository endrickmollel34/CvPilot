// A cancel-at-period-end subscription is still active and still paid — Stripe
// keeps `status: 'active'` for the rest of the period — so "Renews" would
// wrongly tell the user their card will be charged again. Kept in its own
// plain .ts module (not inline in BillingSummary.tsx) so this exact branch is
// unit-testable under this repo's existing jest setup, which only resolves
// .ts modules (no jsdom/testing-library, no .tsx in moduleFileExtensions) —
// see authFetch.spec.ts for the established plain-function test pattern.
export function resolvePeriodLabel(cancelAtPeriodEnd: boolean): string {
  return cancelAtPeriodEnd ? 'Access until' : 'Renews';
}
