'use client';

import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { Download } from 'lucide-react';

import type { CvDto } from '@/lib/cvApi';
import {
  submitCoverLetter,
  getCoverLetter,
  updateCoverLetter,
  regenerateCoverLetter,
  downloadCoverLetterPdf,
  type CoverLetterDto,
  type CoverLetterTone,
  type UpdateCoverLetterParams,
} from '@/lib/coverLetterApi';
import type { UsageCounter } from '@/lib/billingApi';
import type { SaveState } from '@/hooks/useAutosave';
import { useAutosave } from '@/hooks/useAutosave';
import { useApiError } from '@/hooks/useApiError';
import { ActionableError } from '@/components/ui/ActionableError';
import { UsageHint } from '@/components/billing/UsageCard';
import { isCurrentPollGeneration } from './pollGeneration';

/**
 * Cover Letter V2 — a single unified workspace for both entry points:
 * fresh creation (`/cover-letter`, no `initialLetter`) and reopening an
 * existing letter (`/cover-letters/[id]`, `initialLetter` supplied). One
 * component rather than a separate create-flow/viewer pair so save
 * behavior — the thing V1 left inconsistent (autosave on create, a manual
 * "Save changes" button on reopen) — can only ever be implemented once.
 *
 * Follows the CV Builder's split-pane/A4-preview pattern (left controls,
 * right live preview, useDeferredValue so typing never blocks the
 * preview, a mobile tab bar toggling which pane is visible) — re-derived
 * independently here, not imported from CvBuilderWorkspace or any CV
 * template component, per the explicit instruction not to touch either.
 */

const TONE_OPTIONS: Array<{ value: CoverLetterTone; label: string }> = [
  { value: 'professional', label: 'Professional' },
  { value: 'conversational', label: 'Conversational' },
  { value: 'enthusiastic', label: 'Enthusiastic' },
  { value: 'formal', label: 'Formal' },
];

interface AnalysisPrefill {
  analysisId: string;
  cvId?: string;
  jobTitle?: string;
  companyName?: string;
  jobDescription?: string;
}

interface Props {
  initialCvs: CvDto[];
  usage?: UsageCounter;
  /** Present only when reopening an existing letter. */
  initialLetter?: CoverLetterDto;
  /** Present only on a fresh /cover-letter?analysisId=... handoff. */
  prefill?: AnalysisPrefill;
}

/** True when `text` already opens with its own greeting line — mirrors
 *  cover-letter-pdf.util.ts's contentHasOwnGreeting() exactly (see that
 *  function's doc comment for why this can't be assumed either way and
 *  must be detected). Duplicated rather than shared across the frontend/
 *  backend boundary, matching this codebase's existing convention for
 *  small single-purpose helpers (see create-cover-letter.dto.ts). */
function contentHasOwnGreeting(text: string): boolean {
  return /^\s*dear\b/i.test(text);
}

/** Same defensive idea, for the closing — mirrors cover-letter-pdf.util.ts's
 *  contentHasOwnClosing() exactly (see its doc comment: the generation
 *  prompt explicitly excludes a signature block, so this should never
 *  actually trigger, but is a cheap real safety net rather than an
 *  assumption). */
function contentHasOwnClosing(text: string): boolean {
  const tail = text.trim().slice(-200).toLowerCase();
  return /\b(sincerely|regards|yours faithfully|yours truly)\b/.test(tail);
}

/** Sender (candidate) contact/address lines — NOT including the name,
 *  which is rendered separately as its own, bolder line. Mirrors
 *  cover-letter-pdf.util.ts's buildSenderLines() exactly: senderAddress
 *  (free text, split on newlines) supersedes the short `location` field
 *  when present, rather than showing both. */
function buildSenderContactLines(
  email: string | undefined,
  phone: string | undefined,
  location: string | undefined,
  senderAddress: string,
): string[] {
  const addressLines = senderAddress.trim()
    ? senderAddress
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : location
      ? [location]
      : [];
  return [...addressLines, email, phone].filter((l): l is string => Boolean(l && l.trim()));
}

function formatLetterDate(iso: string | undefined): string {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

const inputCls =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400';
const labelCls = 'mb-1 block text-xs font-medium text-gray-600';

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const label: Record<SaveState, string> = {
    idle: '',
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
  };
  const cls: Record<SaveState, string> = {
    idle: '',
    unsaved: 'text-amber-600',
    saving: 'text-gray-400',
    saved: 'text-green-600',
    error: 'text-red-600',
  };
  return (
    <span className={`text-xs ${cls[state]}`} aria-live="polite" aria-atomic="true">
      {label[state]}
    </span>
  );
}

export function CoverLetterWorkspace({ initialCvs, usage, initialLetter, prefill }: Props) {
  const { getToken } = useAuth();
  const readyCvs = initialCvs.filter((c) => c.parseStatus === 'done');

  const [letter, setLetter] = useState<CoverLetterDto | null>(initialLetter ?? null);
  const [selectedCvId, setSelectedCvId] = useState(
    initialLetter?.cvId ?? prefill?.cvId ?? readyCvs[0]?.id ?? '',
  );
  const [jobTitle, setJobTitle] = useState(initialLetter?.jobTitle ?? prefill?.jobTitle ?? '');
  const [companyName, setCompanyName] = useState(
    initialLetter?.companyName ?? prefill?.companyName ?? '',
  );
  const [recipientName, setRecipientName] = useState(initialLetter?.recipientName ?? '');
  const [recipientTitle, setRecipientTitle] = useState(initialLetter?.recipientTitle ?? '');
  const [companyAddress, setCompanyAddress] = useState(initialLetter?.companyAddress ?? '');
  // V2.1 — never prefilled from the selected CV: the CV data model has no
  // full postal address field (only a short `location` string, already
  // used on its own below), so there is nothing safe to prefill from —
  // starts blank and is purely opt-in, independent of CV selection.
  const [senderAddress, setSenderAddress] = useState(initialLetter?.senderAddress ?? '');
  const [jobDescription, setJobDescription] = useState(
    initialLetter?.jobDescription ?? prefill?.jobDescription ?? '',
  );
  const [tone, setTone] = useState<CoverLetterTone>(
    (initialLetter?.tone as CoverLetterTone) ?? 'professional',
  );
  const [content, setContent] = useState(initialLetter?.content ?? '');

  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const formError = useApiError();
  const downloadError = useApiError();

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Bumped by stopPolling()/startPolling() on every polling generation —
  // see pollGeneration.ts. An in-flight getCoverLetter() response captures
  // the generation active when it was ISSUED; if that no longer matches by
  // the time it resolves (a new Regenerate started and superseded it while
  // the old request was still in flight), the response is stale and must
  // be ignored completely — it must never overwrite fresher state, show a
  // stale "Generation failed," or clear the new interval.
  const pollGenerationRef = useRef(0);

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    pollGenerationRef.current += 1;
  }

  useEffect(() => () => stopPolling(), []);

  const status = letter?.status;
  const isBusy = status === 'queued' || status === 'processing';
  const isReady = status === 'generated' || status === 'downloaded';

  function startPolling(id: string) {
    stopPolling();
    const generation = pollGenerationRef.current;
    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const updated = await getCoverLetter(getToken, id);
          if (!isCurrentPollGeneration(generation, pollGenerationRef.current)) return;
          setLetter(updated);
          if (updated.status === 'generated' || updated.status === 'downloaded') {
            clearInterval(pollRef.current!);
            setContent(updated.content);
          } else if (updated.status === 'failed') {
            clearInterval(pollRef.current!);
            formError.setMessage('Generation failed. Please try again.');
          }
        } catch {
          /* keep polling */
        }
      })();
    }, 2000);
  }

  // Reopening a letter that was still queued/processing must pick up
  // where it left off, not sit frozen — the old detail page's "this page
  // does not auto-refresh" gap.
  useEffect(() => {
    if (
      initialLetter &&
      (initialLetter.status === 'queued' || initialLetter.status === 'processing')
    ) {
      startPolling(initialLetter.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildPatch(): UpdateCoverLetterParams {
    return {
      content: content.length > 0 ? content : undefined,
      jobTitle: jobTitle || undefined,
      companyName: companyName || undefined,
      jobDescription: jobDescription || undefined,
      tone,
      recipientName: recipientName || undefined,
      recipientTitle: recipientTitle || undefined,
      companyAddress: companyAddress || undefined,
      // Explicit `null` (not `undefined`) so clearing the field actually
      // persists the clear rather than being skipped as "unchanged" — see
      // UpdateCoverLetterDto's doc comment for the undefined-vs-null
      // distinction this relies on.
      senderAddress: senderAddress.trim() ? senderAddress : null,
    };
  }

  const letterId = letter?.id;
  const saveFn = useCallback(
    async (patch: UpdateCoverLetterParams) => {
      if (!letterId) return;
      await updateCoverLetter(getToken, letterId, patch);
    },
    [getToken, letterId],
  );

  // Autosave covers both the structured fields and the letter body on one
  // debounce/one indicator — unifies what V1 left as two inconsistent save
  // behaviors (silent autosave on create, a manual button on reopen).
  // Disabled while a generation is in flight (nothing to save yet/fields
  // are locked) — see the disabled state on the fields below.
  const saveState = useAutosave(buildPatch(), saveFn, Boolean(letter) && !isBusy);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    formError.clear();
    // Invalidate any still-in-flight poll from a previous attempt right
    // away, not just once startPolling() runs after the await below — a
    // stale response landing in that window must not be able to resurrect
    // the error we just cleared. See pollGeneration.ts.
    stopPolling();
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

    setSubmitting(true);
    try {
      const cl = await submitCoverLetter(getToken, {
        cvId: selectedCvId,
        analysisId: prefill?.analysisId,
        jobTitle,
        companyName,
        jobDescription,
        tone,
        recipientName: recipientName || undefined,
        recipientTitle: recipientTitle || undefined,
        companyAddress: companyAddress || undefined,
        senderAddress: senderAddress || undefined,
      });
      setLetter(cl);
      startPolling(cl.id);
    } catch (err) {
      formError.setFromError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegenerate() {
    if (!letter) return;
    formError.clear();
    // Same reasoning as handleGenerate(): stop and invalidate any prior
    // in-flight poll immediately, before the two awaited requests below,
    // so a late-arriving stale 'failed' response from the attempt being
    // retried can never re-show the error we just cleared.
    stopPolling();
    if (jobDescription.trim().length < 50) {
      formError.setMessage('Job description must be at least 50 characters.');
      return;
    }
    setSubmitting(true);
    try {
      // Flush field edits first — regenerate reads whatever is persisted.
      await updateCoverLetter(getToken, letter.id, buildPatch());
      const updated = await regenerateCoverLetter(getToken, letter.id);
      setLetter(updated);
      startPolling(updated.id);
    } catch (err) {
      formError.setFromError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownload() {
    if (!letter) return;
    downloadError.clear();
    setDownloading(true);
    try {
      // Flush before download so the PDF never lags behind the visible editor.
      await updateCoverLetter(getToken, letter.id, buildPatch());
      await downloadCoverLetterPdf(getToken, letter.id);
    } catch (err) {
      downloadError.setFromError(err, 'Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  const deferredContent = useDeferredValue(content);

  const selectedCvContent =
    letter?.cv?.content ?? initialCvs.find((c) => c.id === selectedCvId)?.content;
  const personalDetails = selectedCvContent?.personalDetails;
  const linkedCvLabel = letter?.cv
    ? (letter.cv.title ?? letter.cv.fileName ?? 'Uploaded CV')
    : undefined;

  const showGreeting = !contentHasOwnGreeting(deferredContent);
  const showClosing = !contentHasOwnClosing(deferredContent);
  const recipientLines = [
    recipientName,
    recipientTitle,
    companyName,
    ...(companyAddress ? companyAddress.split('\n') : []),
  ]
    .map((l) => l?.trim())
    .filter((l): l is string => Boolean(l));
  const senderContactLines = buildSenderContactLines(
    personalDetails?.email,
    personalDetails?.phone,
    personalDetails?.location,
    senderAddress,
  );

  const tabCls = (tab: 'edit' | 'preview') =>
    `flex-1 py-2 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-inset focus:ring-indigo-500 ${
      mobileTab === tab
        ? 'border-b-2 border-indigo-600 text-indigo-600'
        : 'text-gray-500 hover:text-gray-700'
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <SaveIndicator state={letter ? saveState : 'idle'} />
          {downloadError.message && (
            <span className="text-xs text-red-600">{downloadError.message}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {letter && (
            <Link href="/cover-letter" className="text-xs text-gray-500 hover:underline">
              New letter
            </Link>
          )}
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={!isReady || downloading}
            aria-label="Download cover letter as PDF"
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {/* Mobile tab bar */}
      <div
        className="flex border-b border-gray-200 bg-white lg:hidden"
        role="tablist"
        aria-label="Cover letter view"
      >
        <button
          role="tab"
          type="button"
          aria-selected={mobileTab === 'edit'}
          onClick={() => setMobileTab('edit')}
          className={tabCls('edit')}
        >
          Edit
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={mobileTab === 'preview'}
          onClick={() => setMobileTab('preview')}
          className={tabCls('preview')}
        >
          Preview
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Controls / editor panel */}
        <div
          role="tabpanel"
          aria-label="Cover letter controls"
          className={`w-full flex-col overflow-y-auto border-r border-gray-200 bg-white p-5 lg:flex lg:w-2/5 ${mobileTab === 'edit' ? 'flex' : 'hidden'}`}
        >
          <form onSubmit={(e) => void handleGenerate(e)} className="space-y-5">
            {/* CV */}
            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-700">CV</h2>
              {letter ? (
                <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  {linkedCvLabel ?? 'Source CV unavailable'}
                </p>
              ) : readyCvs.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {readyCvs.map((cv) => (
                    <label
                      key={cv.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition-colors ${
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
                <p className="text-sm text-gray-400">
                  No parsed CVs yet.{' '}
                  <a href="/cvs/new" className="font-medium text-indigo-600 underline">
                    Upload one
                  </a>
                  .
                </p>
              )}
              <p className="mt-2 text-xs text-gray-400">
                Name, email, phone, and location come from the selected CV automatically.
              </p>
            </div>

            {/* Sender address — the one piece of sender identity that never
                comes from the CV (its data model has no full postal
                address, only a short location string) — always optional,
                independent of which CV is selected, and never required to
                generate/save/regenerate/preview/download a letter. */}
            <div>
              <label className={labelCls}>Sender address (optional)</label>
              <textarea
                value={senderAddress}
                onChange={(e) => setSenderAddress(e.target.value)}
                placeholder={'e.g. 12 Baker Street\nLondon, NW1 6XE\nUnited Kingdom'}
                rows={3}
                maxLength={1000}
                disabled={isBusy}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-gray-400">
                Only used on this letter — your CV is never changed.
              </p>
            </div>

            {/* Job details */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">Job details</h2>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={labelCls}>Job title *</label>
                  <input
                    type="text"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="e.g. Software Engineer"
                    maxLength={255}
                    disabled={isBusy}
                    className={inputCls}
                  />
                </div>
                <div className="flex-1">
                  <label className={labelCls}>Company *</label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Google"
                    maxLength={255}
                    disabled={isBusy}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Job description *</label>
                <textarea
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the full job description…"
                  rows={7}
                  maxLength={10000}
                  disabled={isBusy}
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-gray-400">{jobDescription.length} / 10 000</p>
              </div>
            </div>

            {/* Recipient */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">Recipient (optional)</h2>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={labelCls}>Recipient name</label>
                  <input
                    type="text"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="e.g. Jane Smith"
                    maxLength={255}
                    disabled={isBusy}
                    className={inputCls}
                  />
                </div>
                <div className="flex-1">
                  <label className={labelCls}>Recipient title</label>
                  <input
                    type="text"
                    value={recipientTitle}
                    onChange={(e) => setRecipientTitle(e.target.value)}
                    placeholder="e.g. Head of Engineering"
                    maxLength={255}
                    disabled={isBusy}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Company address</label>
                <textarea
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  placeholder={'e.g. 1 Infinite Loop\nCupertino, CA'}
                  rows={2}
                  maxLength={1000}
                  disabled={isBusy}
                  className={inputCls}
                />
              </div>
            </div>

            {/* Tone */}
            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-700">Tone</h2>
              <div className="flex flex-wrap gap-2">
                {TONE_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTone(value)}
                    disabled={isBusy}
                    className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
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

            {usage && !letter && (
              <UsageHint counter={usage} unit="cover letters" suffix="this month" />
            )}

            {/* Generate / Regenerate */}
            {letter ? (
              <button
                type="button"
                onClick={() => void handleRegenerate()}
                disabled={isBusy || submitting}
                className="w-full rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isBusy ? 'Writing your letter…' : 'Regenerate'}
              </button>
            ) : (
              <button
                type="submit"
                disabled={readyCvs.length === 0 || submitting}
                className="w-full rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? 'Starting…' : 'Generate cover letter'}
              </button>
            )}

            {/* Editable generated letter */}
            {letter && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className={labelCls}>Letter content</label>
                  {status === 'failed' && (
                    <span className="text-xs text-red-500">
                      Generation failed — edit fields and retry.
                    </span>
                  )}
                </div>
                {isBusy ? (
                  <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-md border border-gray-200 bg-gray-50">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
                    <p className="text-xs text-gray-500">Writing your cover letter…</p>
                  </div>
                ) : (
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={16}
                    disabled={!isReady}
                    className={`${inputCls} font-mono leading-relaxed`}
                    spellCheck
                  />
                )}
              </div>
            )}
          </form>
        </div>

        {/* Live A4 preview */}
        <div
          role="tabpanel"
          aria-label="Cover letter preview"
          className={`flex-1 overflow-y-auto bg-gray-50 p-6 lg:flex ${mobileTab === 'preview' ? 'flex' : 'hidden'}`}
        >
          <div className="mx-auto w-full max-w-[210mm] rounded bg-white p-12 text-sm leading-relaxed text-gray-800 shadow-sm">
            {/* Sender block — upper right. The ONLY right-aligned content
                on the page, so it reads as visually opposite the left-
                aligned recipient block below, never a two-column table. */}
            {(personalDetails?.fullName || senderContactLines.length > 0) && (
              <div className="text-right">
                {personalDetails?.fullName && (
                  <p className="text-[15px] font-bold text-gray-900">{personalDetails.fullName}</p>
                )}
                {senderContactLines.map((line, i) => (
                  <p key={i} className="text-xs text-gray-500">
                    {line}
                  </p>
                ))}
              </div>
            )}

            {/* V2.1 micro-polish: mt-10 → mt-6 — tightens the sender-block-
                to-date gap, mirroring cover-letter-pdf.util.ts's 2.2x →
                1.2x line-height reduction. Only this gap changed — the
                closing "Sincerely," gap below (also previously mt-10)
                keeps its own separate, unrelated occurrence untouched. */}
            <p
              className={`text-gray-700 ${personalDetails?.fullName || senderContactLines.length > 0 ? 'mt-6' : ''}`}
            >
              {formatLetterDate(letter?.generatedAt ?? letter?.createdAt)}
            </p>

            {recipientLines.length > 0 && (
              <div className="mt-[12px] text-gray-700">
                {recipientLines.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}

            {showGreeting && (
              <p className="mt-6 text-gray-800">Dear {recipientName.trim() || 'Hiring Manager'},</p>
            )}

            <div className="mt-5 space-y-4 whitespace-pre-wrap text-gray-800">
              {isBusy ? (
                <p className="italic text-gray-400">Writing your cover letter…</p>
              ) : deferredContent ? (
                deferredContent
                  .split(/\n{2,}/)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((paragraph, i) => <p key={i}>{paragraph}</p>)
              ) : (
                <p className="italic text-gray-400">Your generated letter will appear here.</p>
              )}
            </div>

            {showClosing && (
              <>
                <p className="mt-10 text-gray-800">Sincerely,</p>
                {personalDetails?.fullName && (
                  <p className="mt-9 font-semibold text-gray-900">{personalDetails.fullName}</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
