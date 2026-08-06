import type { CvWorkEntry } from '@cvpilot/shared';

interface EntryProps {
  entry: CvWorkEntry;
  isFirst: boolean;
  isLast: boolean;
  onChange: (e: CvWorkEntry) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
}

function WorkExperienceEntry({
  entry,
  isFirst,
  isLast,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  onDuplicate,
}: EntryProps) {
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

  const iconBtn =
    'rounded p-0.5 text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-30';

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      {/* Entry header with reorder / duplicate / remove controls */}
      <div className="mb-3 flex items-center justify-between">
        <span className="truncate text-xs font-medium text-gray-500">
          {entry.company || 'New entry'}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label="Move entry up"
            className={iconBtn}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            aria-label="Move entry down"
            className={iconBtn}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            aria-label="Duplicate entry"
            className="ml-1 rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove this work experience entry"
            className="rounded px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-1 focus:ring-red-400"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            { key: 'company' as const, label: 'Company', span: true },
            { key: 'title' as const, label: 'Job title', span: true },
            { key: 'location' as const, label: 'Location', span: false },
          ] satisfies Array<{ key: keyof CvWorkEntry; label: string; span: boolean }>
        ).map(({ key, label, span }) => {
          const fieldId = `we-${entry.id}-${key}`;
          return (
            <div key={key} className={span ? 'sm:col-span-2' : ''}>
              <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-gray-700">
                {label}
              </label>
              <input
                id={fieldId}
                type="text"
                value={entry[key] ?? ''}
                onChange={(e) => onChange({ ...entry, [key]: e.target.value })}
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          );
        })}
        <div>
          <label
            htmlFor={`we-${entry.id}-start`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            Start (YYYY-MM)
          </label>
          <input
            id={`we-${entry.id}-start`}
            type="text"
            placeholder="2023-06"
            value={entry.startDate}
            onChange={(e) => onChange({ ...entry, startDate: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label
            htmlFor={`we-${entry.id}-end`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            End (YYYY-MM)
          </label>
          <input
            id={`we-${entry.id}-end`}
            type="text"
            placeholder="2024-01 or leave blank if current"
            value={entry.endDate ?? ''}
            onChange={(e) => onChange({ ...entry, endDate: e.target.value || undefined })}
            disabled={entry.current}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100"
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
              aria-label={`Bullet point ${i + 1}`}
              className="flex-1 rounded border border-gray-300 px-3 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={() => removeBullet(i)}
              aria-label={`Remove bullet point ${i + 1}`}
              className="text-xs text-gray-400 hover:text-red-500 focus:outline-none"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addBullet}
          className="mt-1 text-xs text-indigo-600 hover:underline focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          + Add bullet
        </button>
      </div>
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

  function moveEntry(id: string, direction: -1 | 1) {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const next = [...entries];
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx]!, next[idx]!];
    onChange(next);
  }

  function duplicateEntry(id: string) {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const copy = { ...entries[idx]!, id: crypto.randomUUID() };
    const next = [...entries.slice(0, idx + 1), copy, ...entries.slice(idx + 1)];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map((e, idx) => (
        <WorkExperienceEntry
          key={e.id}
          entry={e}
          isFirst={idx === 0}
          isLast={idx === entries.length - 1}
          onChange={(updated) => updateEntry(e.id, updated)}
          onRemove={() => removeEntry(e.id)}
          onMoveUp={() => moveEntry(e.id, -1)}
          onMoveDown={() => moveEntry(e.id, 1)}
          onDuplicate={() => duplicateEntry(e.id)}
        />
      ))}
      <button
        type="button"
        onClick={addEntry}
        className="rounded-md border border-dashed border-indigo-300 py-2 text-sm text-indigo-600 hover:bg-indigo-50 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        + Add work experience
      </button>
    </div>
  );
}
