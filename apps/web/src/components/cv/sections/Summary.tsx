interface Props {
  value?: string;
  onChange: (v: string) => void;
}

export function Summary({ value, onChange }: Props) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700">Professional summary</label>
      <textarea
        rows={4}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="A brief overview of your experience and career goals…"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  );
}
