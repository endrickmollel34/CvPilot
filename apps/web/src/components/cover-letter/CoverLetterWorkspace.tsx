'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Download } from 'lucide-react';

import type { CvDto } from '@/lib/cvApi';
import {
  submitCoverLetter,
  getCoverLetter,
  updateCoverLetter,
  downloadCoverLetterPdf,
  type CoverLetterDto,
} from '@/lib/coverLetterApi';
import type { UsageCounter } from '@/lib/billingApi';
import { useApiError } from '@/hooks/useApiError';
import { ActionableError } from '@/components/ui/ActionableError';
import { UsageHint } from '@/components/billing/UsageCard';

type Phase = 'setup' | 'processing' | 'editor';

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'conversational', label: 'Conversational' },
  { value: 'enthusiastic', label: 'Enthusiastic' },
  { value: 'formal', label: 'Formal' },
] as const;

type Tone = (typeof TONE_OPTIONS)[number]['value'];

export function CoverLetterWorkspace({
  initialCvs,
  usage,
}: {
  initialCvs: CvDto[];
  usage?: UsageCounter;
}) {
  const { getToken } = useAuth();

  const readyCvs = initialCvs.filter((c) => c.parseStatus === 'done');
  const [selectedCvId, setSelectedCvId] = useState<string>(readyCvs[0]?.id ?? '');
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [tone, setTone] = useState<Tone>('professional');
  const formError = useApiError();

  const [phase, setPhase] = useState<Phase>('setup');
  const [letter, setLetter] = useState<CoverLetterDto | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    formError.clear();
    if (!selectedCvId) {
      formError.setMessage('Select a CV.');
      return;
    }
    if (!jobTitle.trim()) {
      formError.setMessage('Job title is required.');
      return;
    }
    if (!companyName.trim()) {
      formError.setMessage('Company name is required.');
      return;
    }
    if (jobDescription.trim().length < 50) {
      formError.setMessage('Job description must be at least 50 characters.');
      return;
    }

    try {
      const cl = await submitCoverLetter(getToken, {
        cvId: selectedCvId,
        jobTitle,
        companyName,
        jobDescription,
        tone,
      });
      setLetter(cl);
      setPhase('processing');

      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            const updated = await getCoverLetter(getToken, cl.id);
            if (updated.status === 'generated' || updated.status === 'downloaded') {
              clearInterval(pollRef.current!);
              setLetter(updated);
              setEditorContent(updated.content);
              setPhase('editor');
            } else if (updated.status === 'failed') {
              clearInterval(pollRef.current!);
              formError.setMessage('Generation failed. Please try again.');
              setPhase('setup');
            }
          } catch {
            /* keep polling */
          }
        })();
      }, 2000);
    } catch (err) {
      formError.setFromError(err);
    }
  }

  function handleContentChange(val: string) {
    setEditorContent(val);
    setSaveError('');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void (async () => {
        if (!letter) return;
        setSaving(true);
        try {
          await updateCoverLetter(getToken, letter.id, val);
        } catch {
          setSaveError('Auto-save failed.');
        } finally {
          setSaving(false);
        }
      })();
    }, 1200);
  }

  async function handleDownload() {
    if (!letter) return;
    setDownloading(true);
    try {
      await downloadCoverLetterPdf(getToken, letter.id);
    } catch {
      setSaveError('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  if (phase === 'processing') {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
        <p className="text-sm text-gray-600">Writing your cover letter…</p>
        <p className="text-xs text-gray-400">This takes 15–30 seconds.</p>
      </div>
    );
  }

  if (phase === 'editor' && letter) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {/* Header bar */}
        <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-5 py-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {letter.jobTitle ?? 'Cover letter'}
              {letter.companyName ? ` — ${letter.companyName}` : ''}
            </p>
            <p className="text-xs text-gray-400 capitalize">{letter.tone} tone</p>
          </div>
          <div className="flex items-center gap-3">
            {saving && <span className="text-xs text-gray-400">Saving…</span>}
            {saveError && <span className="text-xs text-red-500">{saveError}</span>}
            <button
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {downloading ? 'Preparing…' : 'Download PDF'}
            </button>
            <button
              onClick={() => {
                setLetter(null);
                setEditorContent('');
                setPhase('setup');
              }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              New letter
            </button>
          </div>
        </div>

        {/* Editor */}
        <textarea
          value={editorContent}
          onChange={(e) => handleContentChange(e.target.value)}
          rows={28}
          className="w-full rounded-xl border border-gray-200 bg-white px-6 py-5 font-mono text-sm leading-relaxed shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          spellCheck
        />
        <p className="text-right text-xs text-gray-400">Changes are saved automatically.</p>
      </div>
    );
  }

  // Setup
  return (
    <div className="mx-auto max-w-3xl">
      {readyCvs.length === 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          You have no parsed CVs yet. Upload a CV on the{' '}
          <a href="/cvs/new" className="font-medium underline">
            CVs page
          </a>{' '}
          first.
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
        {/* CV selection */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Select CV</h2>
          {readyCvs.length > 0 ? (
            <div className="flex flex-col gap-2">
              {readyCvs.map((cv) => (
                <label
                  key={cv.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    selectedCvId === cv.id
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="cv"
                    value={cv.id}
                    checked={selectedCvId === cv.id}
                    onChange={() => setSelectedCvId(cv.id)}
                    className="text-indigo-600"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {cv.title ?? cv.fileName ?? 'CV'}
                    </p>
                    <p className="text-xs capitalize text-gray-400">{cv.source}</p>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No CVs available.</p>
          )}
        </div>

        {/* Job details */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Job details</h2>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-600">Job title *</label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g. Software Engineer"
                maxLength={255}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-600">Company *</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Google"
                maxLength={255}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Job description *
            </label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the full job description…"
              rows={10}
              maxLength={10000}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-400">{jobDescription.length} / 10 000</p>
          </div>
        </div>

        {/* Tone */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Tone</h2>
          <div className="flex flex-wrap gap-2">
            {TONE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTone(value)}
                className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-colors ${
                  tone === value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {formError.message && (
          <p className="text-sm text-red-600">
            <ActionableError message={formError.message} quota={formError.quota} />
          </p>
        )}

        {usage && <UsageHint counter={usage} unit="cover letters" suffix="this month" />}

        <button
          type="submit"
          disabled={readyCvs.length === 0}
          className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Generate cover letter
        </button>
      </form>
    </div>
  );
}
