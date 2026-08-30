export type TailoringSection =
  | 'summary'
  | 'workExperience'
  | 'education'
  | 'skills'
  | 'languages'
  | 'certifications';

export type TailoringPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export type TailoringStatus = 'pending' | 'processing' | 'done' | 'failed' | 'applied';

export interface TailoringSuggestion {
  id: string;
  section: TailoringSection;
  /** Human-readable entry identifier, e.g. "Acme Corp | Software Engineer" */
  field?: string;
  /** Exact current content — used for matching during apply */
  originalContent: string;
  /** AI-recommended replacement */
  suggestedContent: string;
  /**
   * For 'skills'/'languages' suggestions that add a new entry: an exact quote
   * from the candidate's CV that supports the addition (e.g. the bullet that
   * mentions it). Never the job description — see skill-grounding.util.ts in
   * apps/api, which independently verifies this quote actually appears in
   * the CV before the suggestion is shown to the user or ever applied.
   */
  evidence?: string;
  /** Why this change improves the match */
  reason: string;
  priority: TailoringPriority;
}

export interface TailoringDecision {
  suggestionId: string;
  decision: 'accepted' | 'rejected';
  /** User-edited version of suggestedContent, overrides suggestedContent when set */
  editedContent?: string;
}
