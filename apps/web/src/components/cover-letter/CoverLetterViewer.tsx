'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Download } from 'lucide-react';

import {
  updateCoverLetter,
  downloadCoverLetterPdf,
  type CoverLetterDto,
} from '@/lib/coverLetterApi';
import { useApiError } from '@/hooks/useApiError';
import { ActionableError } from '@/components/ui/ActionableError';

export function CoverLetterViewer({ letter: initialLetter }: { letter: CoverLetterDto }) {
  const { getToken } = useAuth();
  const [letter, setLetter] = useState(initialLetter);
  const [content, setContent] = useState(initialLetter.content);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const saveError = useApiError();
  const downloadError = useApiError();

  const isReady = letter.status === 'generated' || letter.status === 'downloaded';
  const dirty = content !== letter.content;

  async function handleSave() {
    saveError.clear();
    setSaving(true);
    try {
      const updated = await updateCoverLetter(getToken, letter.id, content);
      setLetter(updated);
      setContent(updated.content);
    } catch (err) {
      saveError.setFromError(err, 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    downloadError.clear();
    setDownloading(true);
    try {
      await downloadCoverLetterPdf(getToken, letter.id);
    } catch (err) {
      downloadError.setFromError(err, 'Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-5 py-3 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {letter.jobTitle ?? 'Cover letter'}
            {letter.companyName ? ` — ${letter.companyName}` : ''}
          </p>
          <p className="text-xs text-gray-400 capitalize">
            {letter.tone} tone
            {letter.cv ? ` · CV: ${letter.cv.title ?? letter.cv.fileName ?? 'Uploaded CV'}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isReady && (
            <button
              onClick={() => void handleSave()}
              disabled={!dirty || saving}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
          <button
            onClick={() => void handleDownload()}
            disabled={!isReady || downloading}
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {saveError.message && (
        <p className="text-sm text-red-600">
          <ActionableError message={saveError.message} quota={saveError.quota} />
        </p>
      )}
      {downloadError.message && (
        <p className="text-sm text-red-600">
          <ActionableError message={downloadError.message} quota={downloadError.quota} />
        </p>
      )}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={28}
        disabled={!isReady}
        className="w-full rounded-xl border border-gray-200 bg-white px-6 py-5 font-mono text-sm leading-relaxed shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
        spellCheck
      />
      {isReady && (
        <p className="text-right text-xs text-gray-400">
          {dirty ? 'Unsaved changes.' : 'All changes saved.'}
        </p>
      )}
    </div>
  );
}
