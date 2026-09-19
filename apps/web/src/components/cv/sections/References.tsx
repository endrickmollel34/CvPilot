import type { CvReferenceEntry } from '@cvpilot/shared';

interface EntryProps {
  entry: CvReferenceEntry;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onChange: (e: CvReferenceEntry) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

const OPTIONAL_FIELDS = [
  { key: 'jobTitle' as const, label: 'Job title / position', type: 'text' },
  { key: 'company' as const, label: 'Company / Organisation', type: 'text' },
  { key: 'email' as const, label: 'Email', type: 'email' },
  { key: 'phone' as const, label: 'Phone', type: 'tel' },
  { key: 'relationship' as const, label: 'Relationship', type: 'text', span: true },
] satisfies Array<{ key: keyof CvReferenceEntry; label: string; type: string; span?: boolean }>;

function ReferenceEntry({
  entry,
  isFirst,
  isLast,
  disabled,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: EntryProps) {
  const iconBtn =
    'rounded p-0.5 text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-30';

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-gray-50 p-4 ${disabled ? 'opacity-60' : ''}`}
    >
      {/* Entry header with reorder / remove controls — same pattern as
          Education's entry header. */}
      <div className="mb-3 flex items-center justify-between">
        <span className="truncate text-xs font-medium text-gray-500">
          {entry.fullName || 'New reference'}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={disabled || isFirst}
            aria-label="Move reference up"
            className={iconBtn}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={disabled || isLast}
            aria-label="Move reference down"
            className={iconBtn}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label="Remove this reference"
            className="ml-1 rounded px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-1 focus:ring-red-400 disabled:opacity-30"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label
            htmlFor={`ref-${entry.id}-fullName`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            Full name
            <span className="ml-0.5 text-red-500" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id={`ref-${entry.id}-fullName`}
            type="text"
            required
            aria-required="true"
            disabled={disabled}
            value={entry.fullName}
            onChange={(e) => onChange({ ...entry, fullName: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100"
          />
        </div>

        {OPTIONAL_FIELDS.map(({ key, label, type, span }) => {
          const fieldId = `ref-${entry.id}-${key}`;
          return (
            <div key={key} className={span ? 'sm:col-span-2' : ''}>
              <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-gray-700">
                {label}
              </label>
              <input
                id={fieldId}
                type={type}
                disabled={disabled}
                value={entry[key] ?? ''}
                onChange={(e) => onChange({ ...entry, [key]: e.target.value || undefined })}
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  entries: CvReferenceEntry[];
  availableUponRequest: boolean;
  onChange: (entries: CvReferenceEntry[]) => void;
  onAvailableUponRequestChange: (value: boolean) => void;
}

export function References({
  entries,
  availableUponRequest,
  onChange,
  onAvailableUponRequestChange,
}: Props) {
  function addEntry() {
    onChange([...entries, { id: crypto.randomUUID(), fullName: '' }]);
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
      <label className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <input
          type="checkbox"
          checked={availableUponRequest}
          onChange={(e) => onAvailableUponRequestChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <span>
          <span className="block text-sm font-medium text-gray-800">
            References available upon request
          </span>
          {/* Explains the non-destructive behavior explicitly — entries
              below are disabled, never cleared, while this is checked. */}
          <span className="block text-xs text-gray-500">
            Shows this sentence on your CV instead of your individual references. Your entered
            references are kept and reappear if you turn this off.
          </span>
        </span>
      </label>

      {entries.map((e, idx) => (
        <ReferenceEntry
          key={e.id}
          entry={e}
          isFirst={idx === 0}
          isLast={idx === entries.length - 1}
          disabled={availableUponRequest}
          onChange={(updated) => onChange(entries.map((x) => (x.id === e.id ? updated : x)))}
          onRemove={() => onChange(entries.filter((x) => x.id !== e.id))}
          onMoveUp={() => moveEntry(e.id, -1)}
          onMoveDown={() => moveEntry(e.id, 1)}
        />
      ))}

      <button
        type="button"
        onClick={addEntry}
        disabled={availableUponRequest}
        className="rounded-md border border-dashed border-indigo-300 py-2 text-sm text-indigo-600 hover:bg-indigo-50 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        + Add another reference
      </button>
    </div>
  );
}
