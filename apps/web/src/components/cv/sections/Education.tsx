import type { CvEducationEntry } from '@cvpilot/shared';

interface EntryProps {
  entry: CvEducationEntry;
  onChange: (e: CvEducationEntry) => void;
  onRemove: () => void;
}

function EducationEntry({ entry, onChange, onRemove }: EntryProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            { key: 'institution' as const, label: 'Institution', span: true },
            { key: 'degree' as const, label: 'Degree', span: false },
            { key: 'field' as const, label: 'Field of study', span: false },
            { key: 'location' as const, label: 'Location', span: true },
            { key: 'grade' as const, label: 'Grade / GPA', span: true },
          ] satisfies Array<{ key: keyof CvEducationEntry; label: string; span: boolean }>
        ).map(({ key, label, span }) => (
          <div key={key} className={span ? 'sm:col-span-2' : ''}>
            <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
            <input
              type="text"
              value={entry[key] ?? ''}
              onChange={(e) => onChange({ ...entry, [key]: e.target.value || undefined })}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
        ))}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Start (YYYY-MM)</label>
          <input
            type="text"
            placeholder="2021-09"
            value={entry.startDate ?? ''}
            onChange={(e) => onChange({ ...entry, startDate: e.target.value || undefined })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">End (YYYY-MM)</label>
          <input
            type="text"
            placeholder="2024-06"
            value={entry.endDate ?? ''}
            onChange={(e) => onChange({ ...entry, endDate: e.target.value || undefined })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>
      <button onClick={onRemove} className="mt-3 text-xs text-red-500 hover:text-red-700">
        Remove entry
      </button>
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

  return (
    <div className="flex flex-col gap-3">
      {entries.map((e) => (
        <EducationEntry
          key={e.id}
          entry={e}
          onChange={(updated) => onChange(entries.map((x) => (x.id === e.id ? updated : x)))}
          onRemove={() => onChange(entries.filter((x) => x.id !== e.id))}
        />
      ))}
      <button
        onClick={addEntry}
        className="rounded-md border border-dashed border-indigo-300 py-2 text-sm text-indigo-600 hover:bg-indigo-50"
      >
        + Add education
      </button>
    </div>
  );
}
