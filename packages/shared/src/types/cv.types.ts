export type CvSection =
  | 'summary'
  | 'workExperience'
  | 'projects'
  | 'education'
  | 'skills'
  | 'languages'
  | 'certifications'
  | 'references';

export type CvSource = 'upload' | 'builder' | 'prefill' | 'tailored';

export interface CvPersonalDetails {
  fullName: string;
  email: string;
  phone?: string;
  location?: string;
  linkedIn?: string;
  website?: string;
  jobTitle?: string;
  /** Added for the Profile template's sidebar personal-details block —
   *  optional free text, never rendered by any other template. */
  nationality?: string;
}

export interface CvWorkEntry {
  id: string;
  company: string;
  title: string;
  location?: string;
  startDate: string;
  endDate?: string;
  current: boolean;
  bullets: string[];
}

export interface CvEducationEntry {
  id: string;
  institution: string;
  degree: string;
  field?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  grade?: string;
}

export interface CvSkillEntry {
  id: string;
  name: string;
  level?: string;
  /** Explicit 1-5 proficiency rating, shown as dots by templates that
   *  support it (currently only Profile). Only ever set by direct user
   *  input on that template's editor controls — never inferred/guessed
   *  from the free-text `level` field. Absent on every CV created before
   *  this field existed and on every entry the user hasn't rated. */
  rating?: number;
}

export interface CvLanguageEntry {
  id: string;
  name: string;
  level?: string;
  /** Same explicit-only 1-5 rating as CvSkillEntry.rating — see its doc
   *  comment. */
  rating?: number;
}

export interface CvCertificationEntry {
  id: string;
  name: string;
  issuer?: string;
  date?: string;
  url?: string;
}

export interface CvProjectEntry {
  id: string;
  title: string;
  /** Project URL (repo, live demo, portfolio page, ...) — free text,
   *  normalized/linked for display the same way personalDetails.website is
   *  (see format.ts's normalizeExternalUrl). Optional. */
  link?: string;
  startDate?: string;
  endDate?: string;
  /** Same shape as CvWorkEntry.bullets — a short one-line description (e.g.
   *  "Campus social media app.") is stored as a single-item array, not a
   *  separate free-text field, so every renderer only needs one code path
   *  for project content. */
  bullets: string[];
}

export interface CvReferenceEntry {
  id: string;
  fullName: string;
  jobTitle?: string;
  company?: string;
  email?: string;
  phone?: string;
  /** Free text, e.g. "Former Manager", "Lecturer", "Supervisor". */
  relationship?: string;
}

export interface CvContent {
  version: 1;
  personalDetails: CvPersonalDetails;
  summary?: string;
  workExperience: CvWorkEntry[];
  // Added after the original schema (RABBIT_NOTEBOOK.md §54) — same
  // "absent on every CV saved before this feature existed" convention as
  // `references` above: optional, and every consumer must treat a missing
  // `projects` as "no projects" (`?? []`) rather than assuming it's always
  // present.
  projects?: CvProjectEntry[];
  education: CvEducationEntry[];
  skills: CvSkillEntry[];
  languages: CvLanguageEntry[];
  certifications: CvCertificationEntry[];
  // Both added after the original schema — every CV created/saved before
  // this feature has neither key in its stored JSONB `content` at all
  // (there is no migration that backfills them). Optional here to reflect
  // that real shape truthfully; every consumer (builder UI, both
  // renderers, backend validation) must treat a missing `references` as
  // "no references" (`?? []`) and a missing
  // `referencesAvailableUponRequest` as `false` (`?? false`) rather than
  // assuming either is always present.
  references?: CvReferenceEntry[];
  referencesAvailableUponRequest?: boolean;
  /**
   * Personal qualities/traits (e.g. "Team player", "Detail-oriented"),
   * shown with square bullet markers by the Profile template's sidebar.
   * Deliberately a top-level field, not a `CvSection` — it has no
   * reorder/placement concept of its own and is never rendered by any of
   * the other six templates, so it doesn't need a slot in `sectionOrder`.
   * Absent on every CV saved before this field existed and on any CV
   * whose user hasn't added qualities.
   */
  qualities?: string[];
  sectionOrder: CvSection[];
}
