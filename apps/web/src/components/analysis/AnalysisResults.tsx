import Link from 'next/link';
import { CheckCircle, XCircle } from 'lucide-react';

import type { AnalysisDto } from '@/lib/analysisApi';

export const CATEGORY_LABELS: Record<string, string> = {
  MISSING_KEYWORD: 'Missing keyword',
  WEAK_LANGUAGE: 'Weak language',
  STRUCTURE: 'Structure',
  ATS_WARNING: 'ATS warning',
};

export const PRIORITY_COLOR: Record<string, string> = {
  HIGH: 'border-l-red-400 bg-red-50',
  MEDIUM: 'border-l-amber-400 bg-amber-50',
  LOW: 'border-l-gray-300 bg-gray-50',
};

export function ScoreRing({ score }: { score: number }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 70 ? '#16a34a' : score >= 40 ? '#d97706' : '#dc2626';
  return (
    <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
      <svg width="120" height="120" viewBox="0 0 120 120" className="-rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-2xl font-bold text-gray-900">{score}</p>
        <p className="text-xs text-gray-500">/ 100</p>
      </div>
    </div>
  );
}

interface AnalysisResultsProps {
  analysis: AnalysisDto;
  /** Live workflow passes a state-resetting handler; history views omit it
   *  and get a plain link to start a new analysis instead. */
  onNewAnalysis?: () => void;
}

export function AnalysisResults({ analysis, onNewAnalysis }: AnalysisResultsProps) {
  const suggestions = analysis.suggestions ?? [];
  const atsReport = analysis.atsReport;
  const score = analysis.matchScore ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Score header */}
      <div className="flex items-center gap-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <ScoreRing score={score} />
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {score >= 70 ? 'Strong match' : score >= 40 ? 'Partial match' : 'Low match'}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {analysis.jobTitle ?? 'Role'}
            {analysis.companyName ? ` at ${analysis.companyName}` : ''}
          </p>
          {analysis.cv ? (
            <p className="mt-1 text-xs text-gray-400">
              CV: {analysis.cv.title ?? analysis.cv.fileName ?? 'Uploaded CV'}
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-400">Source CV no longer available</p>
          )}
          {atsReport?.atsScore != null && (
            <p className="mt-1 text-xs text-gray-400">ATS keyword score: {atsReport.atsScore}%</p>
          )}
          <div className="mt-4 flex gap-2">
            <Link
              href="/cover-letter"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Generate cover letter
            </Link>
            {onNewAnalysis ? (
              <button
                onClick={onNewAnalysis}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                New analysis
              </button>
            ) : (
              <Link
                href="/analyze"
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                New analysis
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ATS Keywords */}
      {atsReport && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-gray-700">ATS Keywords</h3>
          <div className="flex flex-wrap gap-2">
            {(atsReport.keywordHits ?? []).map((k) => (
              <span
                key={k.keyword}
                className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700"
              >
                <CheckCircle className="h-3 w-3" />
                {k.keyword}
              </span>
            ))}
            {(atsReport.missingKeywords ?? []).map((kw) => (
              <span
                key={kw}
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-500"
              >
                <XCircle className="h-3 w-3" />
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-gray-700">
            {suggestions.length} improvement suggestions
          </h3>
          <div className="flex flex-col gap-2">
            {suggestions.map((s, i) => (
              <div
                key={i}
                className={`rounded-lg border-l-4 p-4 text-sm ${PRIORITY_COLOR[s.priority] ?? 'bg-gray-50'}`}
              >
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {CATEGORY_LABELS[s.category] ?? s.category} · {s.priority}
                </span>
                {s.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
