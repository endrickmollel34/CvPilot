// Durable, append-only quota-consumption markers written to `audit_logs`
// (via AuditService.log()) at the exact moment a generation genuinely
// succeeds — never at submission, and never on failure. Read back by
// BillingService/TailoringService via AuditService.countDistinctEntitiesSince()
// to compute "how much of this user's monthly allowance is already used".
//
// Why this exists (quota-refund fix): analyses/cover_letters/tailorings rows
// are genuinely hard-deletable by their owners (see each module's delete
// endpoint). Counting *live* rows for monthly usage — the previous approach —
// meant deleting a counted generation silently freed up its quota slot,
// letting a limited-plan user bypass their monthly allowance via
// generate → delete → generate. audit_logs is append-only (rows are never
// updated or deleted by this app), so counting *these* records instead is
// immune to that: deleting the content row never deletes the usage record.
//
// Using DISTINCT entity_id at read time (see countDistinctEntitiesSince)
// means a resource that can be regenerated in place — Cover Letter's
// regenerate() reuses the same row/id and re-triggers the same success path —
// is still only counted once per calendar month, exactly matching the old
// per-row counting semantics.
export const USAGE_ACTIONS = {
  ANALYSIS_GENERATED: 'analysis.generated',
  COVER_LETTER_GENERATED: 'cover_letter.generated',
  TAILORING_GENERATED: 'tailoring.generated',
} as const;
