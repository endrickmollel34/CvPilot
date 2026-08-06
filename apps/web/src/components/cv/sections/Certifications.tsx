import type { CvCertificationEntry } from '@cvpilot/shared';

interface Props {
  entries: CvCertificationEntry[];
  onChange: (entries: CvCertificationEntry[]) => void;
}

export function Certifications({ entries, onChange }: Props) {
  function addEntry() {
    onChange([...entries, { id: crypto.randomUUID(), name: '' }]);
  }

  function update(id: string, field: keyof CvCertificationEntry, value: string) {
    onChange(entries.map((e) => (e.id === id ? { ...e, [field]: value || undefined } : e)));
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map((e) => (
        <div key={e.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { key: 'name' as const, label: 'Certification name', span: true },
                { key: 'issuer' as const, label: 'Issuer', span: false },
                { key: 'date' as const, label: 'Date (YYYY-MM)', span: false },
                { key: 'url' as const, label: 'URL', span: true },
              ] satisfies Array<{ key: keyof CvCertificationEntry; label: string; span: boolean }>
            ).map(({ key, label, span }) => (
              <div key={key} className={span ? 'sm:col-span-2' : ''}>
                <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
                <input
                  type="text"
                  value={e[key] ?? ''}
                  onChange={(ev) => update(e.id, key, ev.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
          <button
            onClick={() => onChange(entries.filter((x) => x.id !== e.id))}
            className="mt-2 text-xs text-red-500 hover:text-red-700"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        onClick={addEntry}
        className="rounded-md border border-dashed border-indigo-300 py-2 text-sm text-indigo-600 hover:bg-indigo-50"
      >
        + Add certification
      </button>
    </div>
  );
}
