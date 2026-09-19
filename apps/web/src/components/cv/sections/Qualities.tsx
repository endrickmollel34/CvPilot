'use client';

import { useState } from 'react';

interface Props {
  qualities: string[];
  onChange: (qualities: string[]) => void;
}

/**
 * Profile-template-specific panel — see CvBuilderWorkspace.tsx, which only
 * renders this when `templateId === 'profile'`. `CvContent.qualities` is a
 * top-level field, not a `CvSection`, precisely so this doesn't need a slot
 * in the six frozen renderers' shared section list (see its own doc
 * comment in cv.types.ts).
 *
 * Fix (RABBIT_NOTEBOOK.md): CvBuilderWorkspace.tsx only mounts this
 * component while its accordion panel is expanded — collapsing it (or
 * switching to another panel) UNMOUNTS it. The typed-but-not-yet-committed
 * `draft` text lived only in this component's own local state, with no
 * bridge to `content.qualities` until Enter was pressed — so a user who
 * typed a value (e.g. "Time management, Team working, Collaboration") and
 * then clicked elsewhere without pressing Enter had it silently discarded
 * on unmount: never reached `onChange`, never autosaved, never rendered in
 * the preview or PDF, with no error or warning anywhere. `content`'s own
 * "Saved" indicator (CvBuilderWorkspace.tsx's `SaveIndicator`) only ever
 * reflects `content` itself, so it stayed technically accurate throughout —
 * but from the user's point of view, typing a value and seeing "Saved"
 * elsewhere on the page reasonably implied the quality was saved too.
 *
 * Fixed with three changes, all converging on "never silently lose typed
 * text": (1) an explicit, visible "Add" button alongside Enter, so
 * committing is discoverable without relying on the placeholder text alone;
 * (2) committing on blur too (`handleBlur`), so leaving the field for any
 * reason — including the accordion collapsing, which blurs the input a
 * synchronous tick before the collapse itself unmounts this component —
 * commits whatever was typed instead of losing it; (3) splitting on commas
 * on commit, since the reported input was itself a single comma-separated
 * string ("Time management, Team working, Collaboration") intended as three
 * separate qualities, not one.
 */
export function Qualities({ qualities, onChange }: Props) {
  const [draft, setDraft] = useState('');

  function add() {
    const candidates = draft
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (candidates.length === 0) {
      setDraft('');
      return;
    }
    const existingLower = new Set(qualities.map((q) => q.toLowerCase()));
    const deduped: string[] = [];
    for (const candidate of candidates) {
      const key = candidate.toLowerCase();
      if (existingLower.has(key)) continue;
      existingLower.add(key);
      deduped.push(candidate);
    }
    if (deduped.length > 0) onChange([...qualities, ...deduped]);
    setDraft('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  }

  function handleBlur() {
    if (draft.trim()) add();
  }

  function remove(index: number) {
    onChange(qualities.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-500">
        Personal qualities shown with square markers in your Profile template&apos;s sidebar (e.g.
        &quot;Team player&quot;, &quot;Detail-oriented&quot;). Separate multiple qualities with
        commas. Press Enter, click <strong>Add</strong>, or click away to add them — typing alone
        does not save them.
      </p>
      {qualities.length > 0 && (
        <div className="flex flex-wrap gap-2" role="list" aria-label="Qualities">
          {qualities.map((q, i) => (
            <span
              key={i}
              role="listitem"
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-800"
            >
              {q}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${q}`}
                className="ml-0.5 rounded-full text-blue-400 hover:text-blue-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder="Type a quality (or several, comma-separated)…"
          aria-label="Add quality"
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="button"
          // Prevents the button from stealing focus from the input on
          // mousedown — without this, clicking Add would first blur the
          // input (firing handleBlur's own add()) and then fire this
          // button's onClick too, double-committing the same draft text
          // before React has re-rendered with the cleared draft/updated
          // qualities in between the two calls.
          onMouseDown={(e) => e.preventDefault()}
          onClick={add}
          className="shrink-0 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          Add
        </button>
      </div>
    </div>
  );
}
