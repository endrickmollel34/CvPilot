'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

import type { TailoringSuggestion, TailoringDecision } from '@cvpilot/shared';
import {
  submitTailoring,
  getTailoring,
  applyTailoring,
  type TailoringDto,
} from '@/lib/tailoringApi';
import { getFriendlyErrorMessage } from '@/lib/errorMessage';

type Phase = 'input' | 'polling' | 'review' | 'error';

type DecisionState = {
  decision: 'pending' | 'accepted' | 'rejected';
  editedContent?: string;
  editing: boolean;
};

const SECTION_LABELS: Record<string, string> = {
  summary: 'Summary',
  workExperience: 'Work Experience',
  education: 'Education',
  skills: 'Skills',
  languages: 'Languages',
  certifications: 'Certifications',
};

export function TailoringWorkspace({ masterCvId }: { masterCvId: string }) {
  const { getToken } = useAuth();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('input');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Input phase state
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [inputError, setInputError] = useState('');

  // Polling phase state
  const [tailoring, setTailoring] = useState<TailoringDto | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Review phase state
  const [decisions, setDecisions] = useState<Map<string, DecisionState>>(new Map());
  const [applying, setApplying] = useState(false);

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
      setErrorMsg(getFriendlyErrorMessage(err));
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
            const initial = new Map<string, DecisionState>(
              (t.suggestions ?? []).map((s) => [s.id, { decision: 'pending', editing: false }]),
            );
            setDecisions(initial);
            setPhase('review');
          } else if (t.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            setErrorMsg('Analysis failed. Please try again.');
            setPhase('error');
          }
        } catch {
          // transient network error — keep polling
        }
      })();
    }, 2000);
  }

  function setDecision(id: string, decision: 'accepted' | 'rejected') {
    setDecisions((prev) => {
      const next = new Map(prev);
      const current = next.get(id);
      if (current) next.set(id, { ...current, decision, editing: false });
      return next;
    });
  }

  function startEdit(id: string) {
    setDecisions((prev) => {
      const next = new Map(prev);
      const current = next.get(id);
      if (current) {
        const suggestion = tailoring?.suggestions?.find((s) => s.id === id);
        next.set(id, {
          decision: 'accepted',
          editedContent: current.editedContent ?? suggestion?.suggestedContent ?? '',
          editing: true,
        });
      }
      return next;
    });
  }

  function setEditedContent(id: string, text: string) {
    setDecisions((prev) => {
      const next = new Map(prev);
      const current = next.get(id);
      if (current) next.set(id, { ...current, editedContent: text });
      return next;
    });
  }

  function commitEdit(id: string) {
    setDecisions((prev) => {
      const next = new Map(prev);
      const current = next.get(id);
      if (current) next.set(id, { ...current, editing: false });
      return next;
    });
  }

  function acceptAll() {
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const [id, state] of next)
        next.set(id, { ...state, decision: 'accepted', editing: false });
      return next;
    });
  }

  function rejectAll() {
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const [id, state] of next)
        next.set(id, { ...state, decision: 'rejected', editing: false });
      return next;
    });
  }

  async function handleApply() {
    const suggestions = tailoring?.suggestions ?? [];
    const decisionList: TailoringDecision[] = suggestions.map((s) => {
      const state = decisions.get(s.id);
      const decision = state?.decision === 'accepted' ? 'accepted' : 'rejected';
      return {
        suggestionId: s.id,
        decision,
        editedContent: decision === 'accepted' ? state?.editedContent : undefined,
      };
    });

    const acceptedCount = decisionList.filter((d) => d.decision === 'accepted').length;
    if (acceptedCount === 0) {
      setInputError('Accept at least one suggestion before applying.');
      return;
    }

    setApplying(true);
    try {
      const token = await getToken();
      const { tailoredCvId } = await applyTailoring(token!, tailoring!.id, decisionList);
      router.push(`/cvs/${tailoredCvId}/edit`);
    } catch (err) {
      setErrorMsg(getFriendlyErrorMessage(err, 'Apply failed. Please try again.'));
      setPhase('error');
    } finally {
      setApplying(false);
    }
  }

  const acceptedCount = [...decisions.values()].filter((d) => d.decision === 'accepted').length;
  const sortedSuggestions = tailoring?.suggestions ?? [];

  if (phase === 'input') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="mb-1 text-2xl font-bold text-gray-900">Tailor your CV for a job</h1>
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
        <p className="mb-4 text-sm text-red-600">{errorMsg}</p>
        <button
          onClick={() => {
            setPhase('input');
            setErrorMsg('');
          }}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Try again
        </button>
      </div>
    );
  }

  // Review phase
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review suggestions</h1>
          <p className="mt-1 text-sm text-gray-500">
            {sortedSuggestions.length} suggestion{sortedSuggestions.length !== 1 ? 's' : ''} from
            the AI. Accept or edit the ones you want, then apply to create a tailored copy of your
            CV.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={acceptAll}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Accept all
          </button>
          <button
            onClick={rejectAll}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Reject all
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {sortedSuggestions.map((s) => (
          <SuggestionCard
            key={s.id}
            suggestion={s}
            state={decisions.get(s.id) ?? { decision: 'pending', editing: false }}
            onAccept={() => setDecision(s.id, 'accepted')}
            onReject={() => setDecision(s.id, 'rejected')}
            onEdit={() => startEdit(s.id)}
            onEditChange={(text) => setEditedContent(s.id, text)}
            onEditCommit={() => commitEdit(s.id)}
          />
        ))}
      </div>

      {inputError && <p className="mt-4 text-sm text-red-600">{inputError}</p>}

      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={() => void handleApply()}
          disabled={applying || acceptedCount === 0}
          className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {applying
            ? 'Creating tailored CV…'
            : acceptedCount === 0
              ? 'Accept suggestions to apply'
              : `Apply ${acceptedCount} suggestion${acceptedCount !== 1 ? 's' : ''} and open editor`}
        </button>
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── SuggestionCard ──────────────────────────────────────────────────────────

function SuggestionCard({
  suggestion,
  state,
  onAccept,
  onReject,
  onEdit,
  onEditChange,
  onEditCommit,
}: {
  suggestion: TailoringSuggestion;
  state: DecisionState;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  onEditChange: (text: string) => void;
  onEditCommit: () => void;
}) {
  const priorityColor: Record<string, string> = {
    HIGH: 'bg-red-100 text-red-700',
    MEDIUM: 'bg-amber-100 text-amber-700',
    LOW: 'bg-gray-100 text-gray-600',
  };
  const borderColor =
    state.decision === 'accepted'
      ? 'border-green-400 bg-green-50'
      : state.decision === 'rejected'
        ? 'border-gray-200 bg-gray-50 opacity-60'
        : 'border-gray-200 bg-white';

  const displayContent = state.editing
    ? (state.editedContent ?? suggestion.suggestedContent)
    : (state.editedContent ?? suggestion.suggestedContent);

  return (
    <div className={`rounded-lg border p-4 transition-colors ${borderColor}`}>
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
          {SECTION_LABELS[suggestion.section] ?? suggestion.section}
        </span>
        {suggestion.field && <span className="text-xs text-gray-500">{suggestion.field}</span>}
        <span
          className={`ml-auto rounded px-2 py-0.5 text-xs font-medium ${priorityColor[suggestion.priority] ?? ''}`}
        >
          {suggestion.priority}
        </span>
      </div>

      {suggestion.originalContent && (
        <div className="mb-2">
          <p className="mb-1 text-xs font-medium text-gray-400 uppercase tracking-wide">Current</p>
          <p className="text-sm text-gray-500 line-through">{suggestion.originalContent}</p>
        </div>
      )}

      <div className="mb-2">
        <p className="mb-1 text-xs font-medium text-gray-400 uppercase tracking-wide">Suggested</p>
        {state.editing ? (
          <div>
            <textarea
              value={state.editedContent ?? suggestion.suggestedContent}
              onChange={(e) => onEditChange(e.target.value)}
              rows={3}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              aria-label="Edit suggestion"
            />
            <button onClick={onEditCommit} className="mt-1 text-xs text-indigo-600 hover:underline">
              Done editing
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-800">{displayContent}</p>
        )}
      </div>

      <p className="mb-3 text-xs text-gray-500">{suggestion.reason}</p>

      <div className="flex gap-2">
        <button
          onClick={onAccept}
          aria-pressed={state.decision === 'accepted'}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
            state.decision === 'accepted'
              ? 'bg-green-600 text-white'
              : 'border border-green-500 text-green-700 hover:bg-green-50'
          }`}
        >
          Accept
        </button>
        <button
          onClick={onEdit}
          className="rounded border border-indigo-400 px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
        >
          Edit
        </button>
        <button
          onClick={onReject}
          aria-pressed={state.decision === 'rejected'}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
            state.decision === 'rejected'
              ? 'bg-gray-400 text-white'
              : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
