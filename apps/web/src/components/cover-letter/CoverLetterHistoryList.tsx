'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { Trash2 } from 'lucide-react';

import { deleteCoverLetter, type CoverLetterDto } from '@/lib/coverLetterApi';
import { useApiError } from '@/hooks/useApiError';
import { ActionableError } from '@/components/ui/ActionableError';

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  processing: 'Processing',
  generated: 'Ready',
  downloaded: 'Downloaded',
  failed: 'Failed',
};

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-600',
  processing: 'bg-indigo-100 text-indigo-700',
  generated: 'bg-green-100 text-green-700',
  downloaded: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// The Link only ever wraps the info block (never the status badge/delete
// cluster) — so a click on Delete/Confirm/Cancel structurally can never
// bubble into the row's navigation, without needing stopPropagation.
function CoverLetterHistoryRow({
  letter,
  onDeleted,
}: {
  letter: CoverLetterDto;
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
      await deleteCoverLetter(getToken, letter.id);
      onDeleted(letter.id);
    } catch (err) {
      // Row stays — deletion did not actually happen.
      deleteError.setFromError(err, 'Could not delete this cover letter. Please try again.');
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-gray-50">
      <Link href={`/cover-letters/${letter.id}`} className="flex min-w-0 flex-1 items-center">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">
            {letter.jobTitle ?? 'Untitled role'}
            {letter.companyName ? ` — ${letter.companyName}` : ''}
          </p>
          <p className="text-xs capitalize text-gray-400">
            {letter.cv
              ? (letter.cv.title ?? letter.cv.fileName ?? 'Uploaded CV')
              : 'Source CV unavailable'}{' '}
            · {letter.tone} · {formatDate(letter.createdAt)}
          </p>
          {deleteError.message && (
            <p className="mt-1 text-xs text-red-600">
              <ActionableError message={deleteError.message} quota={deleteError.quota} />
            </p>
          )}
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[letter.status] ?? 'bg-gray-100 text-gray-600'}`}
        >
          {STATUS_LABELS[letter.status] ?? letter.status}
        </span>

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
            aria-label="Delete cover letter"
            title="Delete this cover letter? This cannot be undone."
            className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function CoverLetterHistoryList({ initialItems }: { initialItems: CoverLetterDto[] }) {
  const [items, setItems] = useState(initialItems);

  function handleDeleted(id: string) {
    setItems((prev) => prev.filter((l) => l.id !== id));
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white py-16 text-center">
        <p className="text-sm text-gray-400">You have not generated any cover letters yet.</p>
        <Link
          href="/cover-letter"
          className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Generate your first letter
        </Link>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
      {items.map((letter) => (
        <CoverLetterHistoryRow key={letter.id} letter={letter} onDeleted={handleDeleted} />
      ))}
    </div>
  );
}
