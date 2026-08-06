import type { CvWorkEntry } from '@cvpilot/shared';

interface EntryProps {
  entry: CvWorkEntry;
  onChange: (e: CvWorkEntry) => void;
  onRemove: () => void;
}

function WorkExperienceEntry({ entry, onChange, onRemove }: EntryProps) {
  function updateBullet(i: number, text: string) {
    const bullets = [...entry.bullets];
    bullets[i] = text;
    onChange({ ...entry, bullets });
  }

  function addBullet() {
    onChange({ ...entry, bullets: [...entry.bullets, ''] });
  }

  function removeBullet(i: number) {
    onChange({ ...entry, bullets: entry.bullets.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            { key: 'company' as const, label: 'Company', span: true },
            { key: 'title' as const, label: 'Job title', span: true },
            { key: 'location' as const, label: 'Location', span: false },
          ] satisfies Array<{ key: keyof CvWorkEntry; label: string; span: boolean }>
        ).map(({ key, label, span }) => (
          <div key={key} className={span ? 'sm:col-span-2' : ''}>
            <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
            <input
              type="text"
              value={entry[key] ?? ''}
              onChange={(e) => onChange({ ...entry, [key]: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        ))}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Start (YYYY-MM)</label>
          <input
            type="text"
            placeholder="2023-06"
            value={entry.startDate}
            onChange={(e) => onChange({ ...entry, startDate: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">End (YYYY-MM)</label>
          <input
            type="text"
            placeholder="2024-01 or leave blank if current"
            value={entry.endDate ?? ''}
            onChange={(e) => onChange({ ...entry, endDate: e.target.value || undefined })}
            disabled={entry.current}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-100"
          />
        </div>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
        <input
          type="checkbox"
          checked={entry.current}
          onChange={(e) => onChange({ ...entry, current: e.target.checked, endDate: undefined })}
          className="rounded border-gray-300"
        />
        Current role
      </label>

      <div className="mt-3">
        <p className="mb-1 text-xs font-medium text-gray-700">Bullet points</p>
        {entry.bullets.map((b, i) => (
          <div key={i} className="mb-1.5 flex gap-2">
            <input
              type="text"
              value={b}
              onChange={(e) => updateBullet(i, e.target.value)}
              placeholder="Describe an achievement or responsibility…"
              className="flex-1 rounded border border-gray-300 px-3 py-1 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <button
              onClick={() => removeBullet(i)}
              className="text-xs text-gray-400 hover:text-red-500"
            >
              ✕
            </button>
          </div>
        ))}
        <button onClick={addBullet} className="mt-1 text-xs text-indigo-600 hover:underline">
          + Add bullet
        </button>
      </div>

      <button onClick={onRemove} className="mt-3 text-xs text-red-500 hover:text-red-700">
        Remove entry
      </button>
    </div>
  );
}

interface Props {
  entries: CvWorkEntry[];
  onChange: (entries: CvWorkEntry[]) => void;
}

export function WorkExperience({ entries, onChange }: Props) {
  function addEntry() {
    onChange([
      ...entries,
      {
        id: crypto.randomUUID(),
        company: '',
        title: '',
        startDate: '',
        current: false,
        bullets: [],
      },
    ]);
  }

  function updateEntry(id: string, entry: CvWorkEntry) {
    onChange(entries.map((e) => (e.id === id ? entry : e)));
  }

  function removeEntry(id: string) {
    onChange(entries.filter((e) => e.id !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map((e) => (
        <WorkExperienceEntry
          key={e.id}
          entry={e}
          onChange={(updated) => updateEntry(e.id, updated)}
          onRemove={() => removeEntry(e.id)}
        />
      ))}
      <button
        onClick={addEntry}
        className="rounded-md border border-dashed border-indigo-300 py-2 text-sm text-indigo-600 hover:bg-indigo-50"
      >
        + Add work experience
      </button>
    </div>
  );
}
