'use client';

import { useState } from 'react';
import type { CvSkillEntry } from '@cvpilot/shared';

interface Props {
  entries: CvSkillEntry[];
  onChange: (entries: CvSkillEntry[]) => void;
  /** Shows an explicit 1-5 rating selector per skill — scoped to the
   *  Profile template (see CvBuilderWorkspace.tsx), the only template that
   *  renders `CvSkillEntry.rating`. Never inferred from `level` — the
   *  rating is either explicitly set here or left unset. */
  showRating?: boolean;
}

function RatingSelector({
  value,
  onChange,
  label,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-0.5" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(value === n ? undefined : n)}
          aria-label={`${n} out of 5`}
          className={`h-3.5 w-3.5 rounded-full border focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
            value !== undefined && n <= value
              ? 'border-indigo-500 bg-indigo-500'
              : 'border-indigo-300 bg-white'
          }`}
        />
      ))}
    </span>
  );
}

export function Skills({ entries, onChange, showRating = false }: Props) {
  const [draft, setDraft] = useState('');

  function add() {
    const name = draft.trim();
    if (!name) return;
    onChange([...entries, { id: crypto.randomUUID(), name }]);
    setDraft('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  }

  function remove(id: string) {
    onChange(entries.filter((e) => e.id !== id));
  }

  function setRating(id: string, rating: number | undefined) {
    onChange(entries.map((e) => (e.id === id ? { ...e, rating } : e)));
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.length > 0 && (
        <div className="flex flex-col gap-2" role="list" aria-label="Skills">
          {entries.map((e) => (
            <span
              key={e.id}
              role="listitem"
              className="inline-flex w-fit items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-800"
            >
              <span>
                {e.name}
                {e.level && <span className="text-indigo-500"> · {e.level}</span>}
              </span>
              {showRating && (
                <RatingSelector
                  value={e.rating}
                  onChange={(v) => setRating(e.id, v)}
                  label={`Rate ${e.name}`}
                />
              )}
              <button
                type="button"
                onClick={() => remove(e.id)}
                aria-label={`Remove ${e.name}`}
                className="ml-0.5 rounded-full text-indigo-400 hover:text-indigo-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
        placeholder="Type a skill and press Enter…"
        aria-label="Add skill"
        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  );
}
