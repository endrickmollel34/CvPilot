'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

import { deleteCv, type CvDto } from '@/lib/cvApi';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function SourceBadge({ source }: { source: CvDto['source'] }) {
  const label = source === 'upload' ? 'Uploaded' : 'Built';
  const cls = source === 'upload' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700';
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

export function CvCard({ cv }: { cv: CvDto }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-900">{title}</p>
          <p className="mt-0.5 text-xs text-gray-500">Edited {formatDate(cv.updatedAt)}</p>
        </div>
        <SourceBadge source={cv.source} />
      </div>

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
        <div className="flex gap-2">
          {cv.source !== 'upload' && (
            <Link
              href={`/cvs/${cv.id}/edit`}
              className="flex-1 rounded bg-indigo-600 px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-indigo-700"
            >
              Edit
            </Link>
          )}
          <button
            onClick={() => setConfirmDelete(true)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
