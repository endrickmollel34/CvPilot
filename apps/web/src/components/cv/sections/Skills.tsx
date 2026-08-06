'use client';

import { useState } from 'react';
import type { CvSkillEntry } from '@cvpilot/shared';

interface Props {
  entries: CvSkillEntry[];
  onChange: (entries: CvSkillEntry[]) => void;
}

export function Skills({ entries, onChange }: Props) {
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

  return (
    <div className="flex flex-col gap-3">
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-2" role="list" aria-label="Skills">
          {entries.map((e) => (
            <span
              key={e.id}
              role="listitem"
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-800"
            >
              {e.name}
              {e.level && <span className="text-indigo-500"> · {e.level}</span>}
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
