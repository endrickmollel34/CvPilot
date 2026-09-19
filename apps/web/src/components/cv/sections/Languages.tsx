'use client';

import { useState } from 'react';
import type { CvLanguageEntry } from '@cvpilot/shared';

interface Props {
  entries: CvLanguageEntry[];
  onChange: (entries: CvLanguageEntry[]) => void;
  /** Same explicit 1-5 rating selector as Skills.tsx — see its own doc
   *  comment. */
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
              ? 'border-gray-600 bg-gray-600'
              : 'border-gray-300 bg-white'
          }`}
        />
      ))}
    </span>
  );
}

export function Languages({ entries, onChange, showRating = false }: Props) {
  const [draftName, setDraftName] = useState('');
  const [draftLevel, setDraftLevel] = useState('');

  function add() {
    const name = draftName.trim();
    if (!name) return;
    onChange([
      ...entries,
      { id: crypto.randomUUID(), name, level: draftLevel.trim() || undefined },
    ]);
    setDraftName('');
    setDraftLevel('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
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
        <div className="flex flex-col gap-2" role="list" aria-label="Languages">
          {entries.map((e) => (
            <span
              key={e.id}
              role="listitem"
              className="inline-flex w-fit items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
            >
              <span>
                {e.name}
                {e.level && <span className="text-gray-500"> · {e.level}</span>}
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
                className="ml-0.5 text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Language (press Enter to add)"
          aria-label="Language name"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <input
          type="text"
          value={draftLevel}
          onChange={(e) => setDraftLevel(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Level"
          aria-label="Language level"
          className="w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
    </div>
  );
}
