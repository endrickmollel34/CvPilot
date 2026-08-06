import type { CvLanguageEntry } from '@cvpilot/shared';

interface Props {
  entries: CvLanguageEntry[];
  onChange: (entries: CvLanguageEntry[]) => void;
}

export function Languages({ entries, onChange }: Props) {
  function addEntry() {
    onChange([...entries, { id: crypto.randomUUID(), name: '' }]);
  }

  function update(id: string, field: keyof CvLanguageEntry, value: string) {
    onChange(entries.map((e) => (e.id === id ? { ...e, [field]: value || undefined } : e)));
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.map((e) => (
        <div key={e.id} className="flex gap-2">
          <input
            type="text"
            placeholder="Language"
            value={e.name}
            onChange={(ev) => update(e.id, 'name', ev.target.value)}
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Level (e.g. Native)"
            value={e.level ?? ''}
            onChange={(ev) => update(e.id, 'level', ev.target.value)}
            className="w-36 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <button
            onClick={() => onChange(entries.filter((x) => x.id !== e.id))}
            className="text-xs text-gray-400 hover:text-red-500"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={addEntry}
        className="mt-1 rounded-md border border-dashed border-indigo-300 py-2 text-sm text-indigo-600 hover:bg-indigo-50"
      >
        + Add language
      </button>
    </div>
  );
}
