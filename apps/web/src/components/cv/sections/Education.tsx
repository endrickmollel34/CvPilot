import type { CvEducationEntry } from '@cvpilot/shared';

interface EntryProps {
  entry: CvEducationEntry;
  isFirst: boolean;
  isLast: boolean;
  onChange: (e: CvEducationEntry) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function EducationEntry({
  entry,
  isFirst,
  isLast,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: EntryProps) {
  const iconBtn =
    'rounded p-0.5 text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-30';

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      {/* Entry header with reorder / remove controls */}
      <div className="mb-3 flex items-center justify-between">
        <span className="truncate text-xs font-medium text-gray-500">
          {entry.institution || 'New entry'}
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
            onClick={onRemove}
            aria-label="Remove this education entry"
            className="ml-1 rounded px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-1 focus:ring-red-400"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            { key: 'institution' as const, label: 'Institution', span: true },
            { key: 'degree' as const, label: 'Degree', span: false },
            { key: 'field' as const, label: 'Field of study', span: false },
            { key: 'location' as const, label: 'Location', span: true },
            { key: 'grade' as const, label: 'Grade / GPA', span: true },
          ] satisfies Array<{ key: keyof CvEducationEntry; label: string; span: boolean }>
        ).map(({ key, label, span }) => {
          const fieldId = `edu-${entry.id}-${key}`;
          return (
            <div key={key} className={span ? 'sm:col-span-2' : ''}>
              <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-gray-700">
                {label}
              </label>
              <input
                id={fieldId}
                type="text"
                value={entry[key] ?? ''}
                onChange={(e) => onChange({ ...entry, [key]: e.target.value || undefined })}
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          );
        })}
        <div>
          <label
            htmlFor={`edu-${entry.id}-start`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            Start (YYYY-MM)
          </label>
          <input
            id={`edu-${entry.id}-start`}
            type="text"
            placeholder="2021-09"
            value={entry.startDate ?? ''}
            onChange={(e) => onChange({ ...entry, startDate: e.target.value || undefined })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label
            htmlFor={`edu-${entry.id}-end`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            End (YYYY-MM)
          </label>
          <input
            id={`edu-${entry.id}-end`}
            type="text"
            placeholder="2024-06"
            value={entry.endDate ?? ''}
            onChange={(e) => onChange({ ...entry, endDate: e.target.value || undefined })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>
    </div>
  );
}

interface Props {
  entries: CvEducationEntry[];
  onChange: (entries: CvEducationEntry[]) => void;
}

export function Education({ entries, onChange }: Props) {
  function addEntry() {
    onChange([...entries, { id: crypto.randomUUID(), institution: '', degree: '' }]);
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

  return (
    <div className="flex flex-col gap-3">
      {entries.map((e, idx) => (
        <EducationEntry
          key={e.id}
          entry={e}
          isFirst={idx === 0}
          isLast={idx === entries.length - 1}
          onChange={(updated) => onChange(entries.map((x) => (x.id === e.id ? updated : x)))}
          onRemove={() => onChange(entries.filter((x) => x.id !== e.id))}
          onMoveUp={() => moveEntry(e.id, -1)}
          onMoveDown={() => moveEntry(e.id, 1)}
        />
      ))}
      <button
        type="button"
        onClick={addEntry}
        className="rounded-md border border-dashed border-indigo-300 py-2 text-sm text-indigo-600 hover:bg-indigo-50 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        + Add education
      </button>
    </div>
  );
}
