'use client';

import { useState } from 'react';
import type { CvLanguageEntry } from '@cvpilot/shared';

interface Props {
  entries: CvLanguageEntry[];
  onChange: (entries: CvLanguageEntry[]) => void;
}

export function Languages({ entries, onChange }: Props) {
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

  return (
    <div className="flex flex-col gap-3">
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-2" role="list" aria-label="Languages">
          {entries.map((e) => (
            <span
              key={e.id}
              role="listitem"
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
            >
              {e.name}
              {e.level && <span className="text-gray-500"> · {e.level}</span>}
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
