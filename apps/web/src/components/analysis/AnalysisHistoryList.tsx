'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { Trash2 } from 'lucide-react';

import { deleteAnalysis, type AnalysisDto } from '@/lib/analysisApi';
import { useApiError } from '@/hooks/useApiError';
import { ActionableError } from '@/components/ui/ActionableError';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing',
  done: 'Done',
  failed: 'Failed',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  processing: 'bg-indigo-100 text-indigo-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70
      ? 'bg-green-100 text-green-700'
      : score >= 40
        ? 'bg-amber-100 text-amber-700'
        : 'bg-red-100 text-red-700';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}
    >
      {score}%
    </span>
  );
}

// The Link only ever wraps the info block (never the score/status badge or
// delete cluster) — so a click on Delete/Confirm/Cancel structurally can
// never bubble into the row's navigation. Mirrors CoverLetterHistoryList.
function AnalysisHistoryRow({
  analysis,
  onDeleted,
}: {
  analysis: AnalysisDto;
  onDeleted: (id: string) => void;
}) {
  const { getToken } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteError = useApiError();

  async function handleDelete() {
    setDeleting(true);
    deleteError.clear();
    try {
      await deleteAnalysis(getToken, analysis.id);
      onDeleted(analysis.id);
    } catch (err) {
      // Row stays — deletion did not actually happen.
      deleteError.setFromError(err, 'Could not delete this analysis. Please try again.');
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-gray-50">
      <Link href={`/analyses/${analysis.id}`} className="flex min-w-0 flex-1 items-center">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">
            {analysis.jobTitle ?? 'Untitled role'}
            {analysis.companyName ? ` — ${analysis.companyName}` : ''}
          </p>
          <p className="text-xs text-gray-400">
            {analysis.cv
              ? (analysis.cv.title ?? analysis.cv.fileName ?? 'Uploaded CV')
              : 'Source CV unavailable'}{' '}
            · {formatDate(analysis.createdAt)}
          </p>
          {deleteError.message && (
            <p className="mt-1 text-xs text-red-600">
              <ActionableError message={deleteError.message} quota={deleteError.quota} />
            </p>
          )}
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-2">
        {analysis.status === 'done' && analysis.matchScore != null ? (
          <ScoreBadge score={analysis.matchScore} />
        ) : (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[analysis.status] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {STATUS_LABELS[analysis.status] ?? analysis.status}
          </span>
        )}

        {confirming ? (
          <div className="flex items-center gap-1.5">
            <span className="hidden text-xs text-gray-600 sm:inline">
              Delete? This cannot be undone.
            </span>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label="Delete analysis"
            title="Delete this analysis? This cannot be undone."
            className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function AnalysisHistoryList({ initialItems }: { initialItems: AnalysisDto[] }) {
  const [items, setItems] = useState(initialItems);

  function handleDeleted(id: string) {
    setItems((prev) => prev.filter((a) => a.id !== id));
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white py-16 text-center">
        <p className="text-sm text-gray-400">You have not run any analyses yet.</p>
        <Link
          href="/analyze"
          className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Run your first analysis
        </Link>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
      {items.map((analysis) => (
        <AnalysisHistoryRow key={analysis.id} analysis={analysis} onDeleted={handleDeleted} />
      ))}
    </div>
  );
}
