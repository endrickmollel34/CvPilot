'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

import { deleteCv, prefillCv, type CvDto } from '@/lib/cvApi';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function SourceBadge({ source }: { source: CvDto['source'] }) {
  const map: Record<CvDto['source'], { label: string; cls: string }> = {
    upload: { label: 'Uploaded', cls: 'bg-blue-100 text-blue-700' },
    builder: { label: 'Built', cls: 'bg-purple-100 text-purple-700' },
    prefill: { label: 'Prefilled', cls: 'bg-amber-100 text-amber-700' },
    tailored: { label: 'Tailored', cls: 'bg-green-100 text-green-700' },
  };
  const { label, cls } = map[source];
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

function ParseStatusHint({ status }: { status: CvDto['parseStatus'] }) {
  if (status === 'done') return null;
  const map: Record<string, string> = {
    pending: 'Waiting to extract text…',
    processing: 'Extracting text…',
    failed: 'Text extraction failed',
  };
  const isFailed = status === 'failed';
  return <p className={`text-xs ${isFailed ? 'text-red-500' : 'text-gray-400'}`}>{map[status]}</p>;
}

export function CvCard({ cv }: { cv: CvDto }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [prefillError, setPrefillError] = useState<string | null>(null);

  const title = cv.title ?? cv.fileName ?? 'Untitled CV';

  async function handleDelete() {
    setDeleting(true);
    try {
      const token = await getToken();
      await deleteCv(token!, cv.id);
      router.refresh();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handlePrefill() {
    setPrefilling(true);
    setPrefillError(null);
    try {
      const token = await getToken();
      const prefillCv_result = await prefillCv(token!, cv.id);
      router.push(`/cvs/${prefillCv_result.id}/edit`);
    } catch (err) {
      setPrefillError(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
      setPrefilling(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-900">{title}</p>
          <p className="mt-0.5 text-xs text-gray-500">Edited {formatDate(cv.updatedAt)}</p>
        </div>
        <SourceBadge source={cv.source} />
      </div>

      {cv.source === 'upload' && <ParseStatusHint status={cv.parseStatus} />}

      {prefillError && <p className="text-xs text-red-600">{prefillError}</p>}

      {confirmDelete ? (
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Confirm delete'}
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {cv.source === 'upload' && cv.parseStatus === 'done' && (
            <button
              onClick={handlePrefill}
              disabled={prefilling}
              className="w-full rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {prefilling ? 'Extracting details…' : 'Use extracted details to start editing'}
            </button>
          )}
          <div className="flex gap-2">
            {cv.source !== 'upload' && (
              <Link
                href={`/cvs/${cv.id}/edit`}
                className="flex-1 rounded bg-indigo-600 px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-indigo-700"
              >
                Edit
              </Link>
            )}
            {cv.source !== 'upload' && (
              <Link
                href={`/cvs/${cv.id}/tailor`}
                className="flex-1 rounded border border-indigo-500 px-3 py-1.5 text-center text-sm font-medium text-indigo-600 hover:bg-indigo-50"
              >
                Tailor for job
              </Link>
            )}
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
