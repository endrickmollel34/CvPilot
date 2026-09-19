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
 */
export function Qualities({ qualities, onChange }: Props) {
  const [draft, setDraft] = useState('');

  function add() {
    const value = draft.trim();
    if (!value) return;
    onChange([...qualities, value]);
    setDraft('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  }

  function remove(index: number) {
    onChange(qualities.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-500">
        Personal qualities shown with square markers in your Profile template&apos;s sidebar (e.g.
        &quot;Team player&quot;, &quot;Detail-oriented&quot;).
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
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a quality and press Enter…"
        aria-label="Add quality"
        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  );
}
