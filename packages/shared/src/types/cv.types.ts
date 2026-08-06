export type CvSection =
  | 'summary'
  | 'workExperience'
  | 'education'
  | 'skills'
  | 'languages'
  | 'certifications';

export type CvSource = 'upload' | 'builder' | 'prefill' | 'tailored';

export interface CvPersonalDetails {
  fullName: string;
  email: string;
  phone?: string;
  location?: string;
  linkedIn?: string;
  website?: string;
  jobTitle?: string;
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
}

export interface CvLanguageEntry {
  id: string;
  name: string;
  level?: string;
}

export interface CvCertificationEntry {
  id: string;
  name: string;
  issuer?: string;
  date?: string;
  url?: string;
}

export interface CvContent {
  version: 1;
  personalDetails: CvPersonalDetails;
  summary?: string;
  workExperience: CvWorkEntry[];
  education: CvEducationEntry[];
  skills: CvSkillEntry[];
  languages: CvLanguageEntry[];
  certifications: CvCertificationEntry[];
  sectionOrder: CvSection[];
}
