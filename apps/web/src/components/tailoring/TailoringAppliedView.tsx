import Link from 'next/link';

import type { TailoringDto } from '@/lib/tailoringApi';

const SECTION_LABELS: Record<string, string> = {
  summary: 'Summary',
  workExperience: 'Work Experience',
  education: 'Education',
  skills: 'Skills',
  languages: 'Languages',
  certifications: 'Certifications',
};

/**
 * Read-only history view for an already-applied tailoring: the original
 * suggestions plus the decisions that were actually persisted at apply
 * time (never re-derived). No accept/reject controls — re-applying an
 * already-applied tailoring is rejected by the backend (ConflictException).
 */
export function TailoringAppliedView({ tailoring }: { tailoring: TailoringDto }) {
  const suggestions = tailoring.suggestions ?? [];
  const decisionById = new Map((tailoring.decisions ?? []).map((d) => [d.suggestionId, d]));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Applied tailoring</h1>
          <p className="mt-1 text-sm text-gray-500">
            {tailoring.jobTitle ?? 'Role'}
            {tailoring.companyName ? ` at ${tailoring.companyName}` : ''} — these decisions have
            already been applied to a tailored CV.
          </p>
        </div>
        {tailoring.tailoredCv ? (
          <Link
            href={`/cvs/${tailoring.tailoredCv.id}/edit`}
            className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Open tailored CV
          </Link>
        ) : (
          <span className="shrink-0 text-xs text-gray-400">Tailored CV no longer available</span>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {suggestions.map((s) => {
          const decision = decisionById.get(s.id);
          const applied = decision?.decision === 'accepted';
          const content = decision?.editedContent ?? s.suggestedContent;

          return (
            <div
              key={s.id}
              className={`rounded-lg border p-4 ${applied ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-gray-50 opacity-70'}`}
            >
              <div className="mb-3 flex items-center gap-2 flex-wrap">
                <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                  {SECTION_LABELS[s.section] ?? s.section}
                </span>
                {s.field && <span className="text-xs text-gray-500">{s.field}</span>}
                <span
                  className={`ml-auto rounded px-2 py-0.5 text-xs font-medium ${
                    applied ? 'bg-green-600 text-white' : 'bg-gray-400 text-white'
                  }`}
                >
                  {applied ? 'Applied' : 'Rejected'}
                </span>
              </div>

              {s.originalContent && (
                <div className="mb-2">
                  <p className="mb-1 text-xs font-medium text-gray-400 uppercase tracking-wide">
                    Original
                  </p>
                  <p className="text-sm text-gray-500 line-through">{s.originalContent}</p>
                </div>
              )}

              <div>
                <p className="mb-1 text-xs font-medium text-gray-400 uppercase tracking-wide">
                  {applied ? 'Applied change' : 'Suggested (not applied)'}
                </p>
                <p className="text-sm text-gray-800">{content}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
