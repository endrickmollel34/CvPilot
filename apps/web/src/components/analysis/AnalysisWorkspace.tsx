'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { Upload } from 'lucide-react';

import type { CvDto } from '@/lib/cvApi';
import { getUploadUrl, confirmUpload, getCv } from '@/lib/cvApi';
import { submitAnalysis, getAnalysis, type AnalysisDto } from '@/lib/analysisApi';
import type { UsageCounter } from '@/lib/billingApi';
import { useApiError } from '@/hooks/useApiError';
import { ActionableError } from '@/components/ui/ActionableError';
import { AnalysisResults } from '@/components/analysis/AnalysisResults';
import { UsageHint } from '@/components/billing/UsageCard';

type Phase = 'setup' | 'processing' | 'results';

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export function AnalysisWorkspace({
  initialCvs,
  usage,
}: {
  initialCvs: CvDto[];
  usage?: UsageCounter;
}) {
  const { getToken } = useAuth();

  const [uploadedCvs, setUploadedCvs] = useState<CvDto[]>(
    initialCvs.filter((c) => c.source === 'upload' && c.parseStatus === 'done'),
  );
  const [selectedCvId, setSelectedCvId] = useState<string>(
    initialCvs.find((c) => c.source === 'upload' && c.parseStatus === 'done')?.id ?? '',
  );

  const [uploading, setUploading] = useState(false);
  const uploadError = useApiError();
  const [parsePollingId, setParsePollingId] = useState<string | null>(null);

  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const formError = useApiError();

  const [phase, setPhase] = useState<Phase>('setup');
  const [analysis, setAnalysis] = useState<AnalysisDto | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const parseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (parseRef.current) clearInterval(parseRef.current);
    },
    [],
  );

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      uploadError.setMessage('Only PDF and DOCX files are supported.');
      return;
    }
    uploadError.clear();
    setUploading(true);

    try {
      const token = await getToken();
      const { uploadUrl, r2ObjectKey } = await getUploadUrl(
        token!,
        file.name,
        file.type,
        file.size,
      );

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error('File upload to storage failed.');

      const cv = await confirmUpload(token!, r2ObjectKey, file.name, file.size, file.type);
      setParsePollingId(cv.id);

      // Poll until parseStatus=done
      parseRef.current = setInterval(() => {
        void (async () => {
          try {
            const token2 = await getToken();
            const updated = await getCv(token2!, cv.id);
            if (updated.parseStatus === 'done') {
              clearInterval(parseRef.current!);
              setParsePollingId(null);
              setUploadedCvs((prev) => [updated, ...prev]);
              setSelectedCvId(updated.id);
            } else if (updated.parseStatus === 'failed') {
              clearInterval(parseRef.current!);
              setParsePollingId(null);
              uploadError.setMessage('Text extraction failed. Try a different file.');
            }
          } catch {
            /* keep polling */
          }
        })();
      }, 2000);
    } catch (err) {
      uploadError.setFromError(err, 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    formError.clear();
    if (!selectedCvId) {
      formError.setMessage('Select a CV to analyse.');
      return;
    }
    if (!jobTitle.trim()) {
      formError.setMessage('Job title is required.');
      return;
    }
    if (jobDescription.trim().length < 50) {
      formError.setMessage('Job description must be at least 50 characters.');
      return;
    }

    try {
      const token = await getToken();
      const a = await submitAnalysis(
        token!,
        selectedCvId,
        jobTitle,
        companyName || undefined,
        jobDescription,
      );
      setAnalysis(a);
      setPhase('processing');

      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            const t = await getToken();
            const updated = await getAnalysis(t!, a.id);
            if (updated.status === 'done') {
              clearInterval(pollRef.current!);
              setAnalysis(updated);
              setPhase('results');
            } else if (updated.status === 'failed') {
              clearInterval(pollRef.current!);
              formError.setMessage('Analysis failed. Please try again.');
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

  if (phase === 'processing') {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
        <p className="text-sm text-gray-600">Analysing your CV against the job description…</p>
        <p className="text-xs text-gray-400">This takes 15–30 seconds.</p>
      </div>
    );
  }

  if (phase === 'results' && analysis) {
    return (
      <AnalysisResults
        analysis={analysis}
        onNewAnalysis={() => {
          setAnalysis(null);
          setPhase('setup');
        }}
      />
    );
  }

  // Setup phase
  return (
    <div className="mx-auto max-w-3xl">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
        {/* CV selection */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Select CV to analyse</h2>
          <p className="mb-3 text-xs text-gray-500">
            Analysis works with uploaded CVs (PDF/DOCX). For builder CVs, open{' '}
            <Link href="/cvs" className="text-indigo-600 hover:underline">
              My CVs
            </Link>{' '}
            and use Job Tailoring instead.
          </p>

          {uploadedCvs.length > 0 && (
            <div className="mb-3 flex flex-col gap-2">
              {uploadedCvs.map((cv) => (
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
                  <span className="text-sm font-medium text-gray-900">
                    {cv.title ?? cv.fileName ?? 'Uploaded CV'}
                  </span>
                </label>
              ))}
            </div>
          )}

          {parsePollingId && (
            <p className="mb-3 flex items-center gap-2 text-xs text-indigo-600">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600 inline-block" />
              Extracting text from your CV…
            </p>
          )}

          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-white p-5 text-center hover:border-indigo-400 transition-colors">
            <Upload className="h-6 w-6 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">
              {uploading ? 'Uploading…' : 'Upload a CV'}
            </span>
            <span className="text-xs text-gray-400">PDF or DOCX, max 10 MB</span>
            <input
              type="file"
              accept=".pdf,.docx"
              onChange={(e) => void handleFileChange(e)}
              disabled={uploading}
              className="sr-only"
            />
          </label>
          {uploadError.message && (
            <p className="mt-2 text-xs text-red-600">
              <ActionableError message={uploadError.message} quota={uploadError.quota} />
            </p>
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
              <label className="mb-1 block text-xs font-medium text-gray-600">Company</label>
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

        {formError.message && (
          <p className="text-sm text-red-600">
            <ActionableError message={formError.message} quota={formError.quota} />
          </p>
        )}

        {usage && <UsageHint counter={usage} unit="analyses" suffix="this month" />}

        <button
          type="submit"
          disabled={uploading || !!parsePollingId}
          className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Analyse CV
        </button>
      </form>
    </div>
  );
}
