export type SuggestionCategory = 'MISSING_KEYWORD' | 'WEAK_LANGUAGE' | 'STRUCTURE' | 'ATS_WARNING';

export type SuggestionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export type AnalysisStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface Suggestion {
  category: SuggestionCategory;
  priority: SuggestionPriority;
  text: string;
}

export interface AtsKeyword {
  keyword: string;
  found: boolean;
}

export interface AnalysisResult {
  matchScore: number;
  suggestions: Suggestion[];
  atsKeywords: AtsKeyword[];
}

export interface CoverLetterStatus {
  status: 'draft' | 'generated' | 'downloaded';
}
