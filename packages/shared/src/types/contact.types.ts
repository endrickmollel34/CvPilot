// Shared between apps/web (the /contact form's category <select>) and
// apps/api (SubmitContactDto's @IsIn validation) so the two can never drift
// out of sync — the frontend never needs its own copy of the valid category
// list, and a category the backend doesn't recognise can never reach the
// dropdown.
export const CONTACT_CATEGORIES = [
  'general',
  'support',
  'billing',
  'privacy',
  'feedback',
  'other',
] as const;

export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  general: 'General question',
  support: 'Account or technical support',
  billing: 'Billing',
  privacy: 'Privacy / data request',
  feedback: 'Feedback',
  other: 'Other',
};
