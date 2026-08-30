'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { Upload, CheckCircle, XCircle } from 'lucide-react';

import type { CvDto } from '@/lib/cvApi';
import { getUploadUrl, confirmUpload, getCv } from '@/lib/cvApi';
import { submitAnalysis, getAnalysis, type AnalysisDto } from '@/lib/analysisApi';
import { getFriendlyErrorMessage } from '@/lib/errorMessage';

type Phase = 'setup' | 'processing' | 'results';

const CATEGORY_LABELS: Record<string, string> = {
  MISSING_KEYWORD: 'Missing keyword',
  WEAK_LANGUAGE: 'Weak language',
  STRUCTURE: 'Structure',
  ATS_WARNING: 'ATS warning',
};

const PRIORITY_COLOR: Record<string, string> = {
  HIGH: 'border-l-red-400 bg-red-50',
  MEDIUM: 'border-l-amber-400 bg-amber-50',
  LOW: 'border-l-gray-300 bg-gray-50',
};

function ScoreRing({ score }: { score: number }) {
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

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export function AnalysisWorkspace({ initialCvs }: { initialCvs: CvDto[] }) {
  const { getToken } = useAuth();

  const [uploadedCvs, setUploadedCvs] = useState<CvDto[]>(
    initialCvs.filter((c) => c.source === 'upload' && c.parseStatus === 'done'),
  );
  const [selectedCvId, setSelectedCvId] = useState<string>(
    initialCvs.find((c) => c.source === 'upload' && c.parseStatus === 'done')?.id ?? '',
  );

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [parsePollingId, setParsePollingId] = useState<string | null>(null);

  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [formError, setFormError] = useState('');

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
      setUploadError('Only PDF and DOCX files are supported.');
      return;
    }
    setUploadError('');
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
              setUploadError('Text extraction failed. Try a different file.');
            }
          } catch {
            /* keep polling */
          }
        })();
      }, 2000);
    } catch (err) {
      setUploadError(getFriendlyErrorMessage(err, 'Upload failed. Please try again.'));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!selectedCvId) {
      setFormError('Select a CV to analyse.');
      return;
    }
    if (!jobTitle.trim()) {
      setFormError('Job title is required.');
      return;
    }
    if (jobDescription.trim().length < 50) {
      setFormError('Job description must be at least 50 characters.');
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
              setFormError('Analysis failed. Please try again.');
              setPhase('setup');
            }
          } catch {
            /* keep polling */
          }
        })();
      }, 2000);
    } catch (err) {
      setFormError(getFriendlyErrorMessage(err));
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
              <button
                onClick={() => {
                  setAnalysis(null);
                  setPhase('setup');
                }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                New analysis
              </button>
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
          {uploadError && <p className="mt-2 text-xs text-red-600">{uploadError}</p>}
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

        {formError && <p className="text-sm text-red-600">{formError}</p>}

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
