import type { CvPersonalDetails } from '@cvpilot/shared';

interface Props {
  value: CvPersonalDetails;
  onChange: (v: CvPersonalDetails) => void;
}

const FIELDS: { key: keyof CvPersonalDetails; label: string; type?: string; required?: boolean }[] =
  [
    { key: 'fullName', label: 'Full name', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'phone', label: 'Phone' },
    { key: 'location', label: 'Location' },
    { key: 'jobTitle', label: 'Job title / headline' },
    { key: 'linkedIn', label: 'LinkedIn URL' },
    { key: 'website', label: 'Website' },
  ];

export function PersonalDetails({ value, onChange }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {FIELDS.map(({ key, label, type, required }) => (
        <div key={key} className={key === 'fullName' || key === 'jobTitle' ? 'sm:col-span-2' : ''}>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            {label}
            {required && <span className="ml-0.5 text-red-500">*</span>}
          </label>
          <input
            type={type ?? 'text'}
            value={value[key] ?? ''}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      ))}
    </div>
  );
}
