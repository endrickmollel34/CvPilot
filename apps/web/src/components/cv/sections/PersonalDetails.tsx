import type { CvPersonalDetails } from '@cvpilot/shared';

interface Props {
  value: CvPersonalDetails;
  onChange: (v: CvPersonalDetails) => void;
}

const FIELDS: {
  key: keyof CvPersonalDetails;
  label: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}[] = [
  { key: 'fullName', label: 'Full name', autoComplete: 'name', required: true },
  { key: 'email', label: 'Email', type: 'email', autoComplete: 'email', required: true },
  { key: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
  { key: 'location', label: 'Location', autoComplete: 'address-level2' },
  { key: 'jobTitle', label: 'Job title / headline' },
  { key: 'linkedIn', label: 'LinkedIn URL', type: 'url' },
  { key: 'website', label: 'Website', type: 'url' },
];

export function PersonalDetails({ value, onChange }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {FIELDS.map(({ key, label, type, autoComplete, required }) => {
        const id = `pd-${key}`;
        const isFullWidth = key === 'fullName' || key === 'jobTitle';
        return (
          <div key={key} className={isFullWidth ? 'sm:col-span-2' : ''}>
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">
              {label}
              {required && (
                <span className="ml-0.5 text-red-500" aria-hidden="true">
                  *
                </span>
              )}
            </label>
            <input
              id={id}
              type={type ?? 'text'}
              autoComplete={autoComplete}
              required={required}
              value={value[key] ?? ''}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
              aria-required={required}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        );
      })}
    </div>
  );
}
