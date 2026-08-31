'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

import { submitTailoring, getTailoring, type TailoringDto } from '@/lib/tailoringApi';
import type { UsageCounter } from '@/lib/billingApi';
import { useApiError } from '@/hooks/useApiError';
import { ActionableError } from '@/components/ui/ActionableError';
import { TailoringReview } from '@/components/tailoring/TailoringReview';

type Phase = 'input' | 'polling' | 'review' | 'error';

// Tailoring is gated entirely on Free (limit 0), so this needs bespoke
// copy rather than the generic "X of Y used" UsageHint phrasing.
function TailoringUsageNote({ usage }: { usage?: UsageCounter }) {
  if (!usage) return null;
  return (
    <p className="text-xs text-gray-400">
      {usage.limit === null ? 'Unlimited' : 'Tailoring is available on Pro and Student plans'}
    </p>
  );
}

export function TailoringWorkspace({
  masterCvId,
  usage,
}: {
  masterCvId: string;
  usage?: UsageCounter;
}) {
  const { getToken } = useAuth();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('input');
  const error = useApiError();
  const [submitting, setSubmitting] = useState(false);

  // Input phase state
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [inputError, setInputError] = useState('');

  // Polling phase state
  const [tailoring, setTailoring] = useState<TailoringDto | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInputError('');

    if (jobDescription.trim().length < 50) {
      setInputError('Job description must be at least 50 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const token = await getToken();
      const t = await submitTailoring(
        token!,
        masterCvId,
        jobTitle || undefined,
        companyName || undefined,
        jobDescription,
      );
      setTailoring(t);
      setPhase('polling');
      startPolling(t.id);
    } catch (err) {
      error.setFromError(err);
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  }

  function startPolling(tailoringId: string) {
    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const token = await getToken();
          const t = await getTailoring(token!, tailoringId);
          setTailoring(t);

          if (t.status === 'done') {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase('review');
          } else if (t.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            error.setMessage('Analysis failed. Please try again.');
            setPhase('error');
          }
        } catch {
          // transient network error — keep polling
        }
      })();
    }, 2000);
  }

  if (phase === 'input') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="mb-1 flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Tailor your CV for a job</h1>
          <Link href="/tailorings" className="shrink-0 text-sm text-indigo-600 hover:underline">
            Previous tailorings →
          </Link>
        </div>
        <p className="mb-8 text-sm text-gray-500">
          Paste the job description and our AI will suggest targeted improvements to your CV.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700">Job title</label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g. Backend Engineer"
                maxLength={255}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700">Company</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Acme Corp"
                maxLength={255}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Job description <span className="text-red-500">*</span>
            </label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the full job description here…"
              required
              rows={12}
              maxLength={10000}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-400">{jobDescription.length} / 10000</p>
          </div>

          {inputError && <p className="text-sm text-red-600">{inputError}</p>}

          <TailoringUsageNote usage={usage} />

          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Analyse and tailor'}
          </button>
        </form>
      </div>
    );
  }

  if (phase === 'polling') {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-4 py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
        <p className="text-sm text-gray-600">Analysing your CV against the job description…</p>
        <p className="text-xs text-gray-400">This usually takes 15–30 seconds.</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="mb-4 text-sm text-red-600">
          <ActionableError message={error.message} quota={error.quota} />
        </p>
        <button
          onClick={() => {
            setPhase('input');
            error.clear();
          }}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Try again
        </button>
      </div>
    );
  }

  // Review phase
  return <TailoringReview tailoring={tailoring!} onCancel={() => router.back()} />;
}
