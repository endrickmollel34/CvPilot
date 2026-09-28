import type { CvProjectEntry } from '@cvpilot/shared';

interface EntryProps {
  entry: CvProjectEntry;
  isFirst: boolean;
  isLast: boolean;
  onChange: (e: CvProjectEntry) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

// Modelled on WorkExperience.tsx's entry editor (RABBIT_NOTEBOOK.md §54) —
// same reorder/remove/bullet-editing pattern, with `link` in place of
// company/location/current (a project has neither an employer nor an
// ongoing/past distinction the product asked for).
function ProjectEntry({
  entry,
  isFirst,
  isLast,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: EntryProps) {
  function updateBullet(i: number, text: string) {
    const bullets = [...entry.bullets];
    bullets[i] = text;
    onChange({ ...entry, bullets });
  }

  function addBullet() {
    const newIndex = entry.bullets.length;
    onChange({ ...entry, bullets: [...entry.bullets, ''] });
    requestAnimationFrame(() => {
      const next = document.getElementById(`proj-${entry.id}-bullet-${newIndex}`);
      next?.focus();
    });
  }

  function insertBulletAfter(i: number) {
    const bullets = [...entry.bullets];
    bullets.splice(i + 1, 0, '');
    onChange({ ...entry, bullets });
    requestAnimationFrame(() => {
      const next = document.getElementById(`proj-${entry.id}-bullet-${i + 1}`);
      next?.focus();
    });
  }

  function removeBullet(i: number) {
    onChange({ ...entry, bullets: entry.bullets.filter((_, idx) => idx !== i) });
  }

  function autoGrowBulletTextarea(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  const iconBtn =
    'rounded p-0.5 text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-30';

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="truncate text-xs font-medium text-gray-500">
          {entry.title || 'New project'}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label="Move project up"
            className={iconBtn}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            aria-label="Move project down"
            className={iconBtn}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove this project"
            className="rounded px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-1 focus:ring-red-400"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label
            htmlFor={`proj-${entry.id}-title`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            Project title
            <span className="ml-0.5 text-red-500" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id={`proj-${entry.id}-title`}
            type="text"
            required
            aria-required="true"
            value={entry.title}
            onChange={(e) => onChange({ ...entry, title: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="sm:col-span-2">
          <label
            htmlFor={`proj-${entry.id}-link`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            Link (optional)
          </label>
          <input
            id={`proj-${entry.id}-link`}
            type="text"
            placeholder="github.com/you/project"
            value={entry.link ?? ''}
            onChange={(e) => onChange({ ...entry, link: e.target.value || undefined })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label
            htmlFor={`proj-${entry.id}-start`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            Start (YYYY-MM or YYYY, optional)
          </label>
          <input
            id={`proj-${entry.id}-start`}
            type="text"
            placeholder="2023-06"
            value={entry.startDate ?? ''}
            onChange={(e) => onChange({ ...entry, startDate: e.target.value || undefined })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label
            htmlFor={`proj-${entry.id}-end`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            End (YYYY-MM or YYYY, optional)
          </label>
          <input
            id={`proj-${entry.id}-end`}
            type="text"
            placeholder="2023-09"
            value={entry.endDate ?? ''}
            onChange={(e) => onChange({ ...entry, endDate: e.target.value || undefined })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-1 text-xs font-medium text-gray-700">Description / bullet points</p>
        {entry.bullets.map((b, i) => (
          <div key={i} className="mb-1.5 flex gap-2">
            <textarea
              id={`proj-${entry.id}-bullet-${i}`}
              ref={autoGrowBulletTextarea}
              value={b}
              onChange={(e) => {
                updateBullet(i, e.target.value);
                autoGrowBulletTextarea(e.target);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  insertBulletAfter(i);
                }
              }}
              placeholder="Describe the project…"
              aria-label={`Bullet point ${i + 1}`}
              rows={1}
              className="flex-1 resize-none overflow-hidden rounded border border-gray-300 px-3 py-1 text-sm leading-normal focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={() => removeBullet(i)}
              aria-label={`Remove bullet point ${i + 1}`}
              className="self-start text-xs text-gray-400 hover:text-red-500 focus:outline-none"
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
  entries: CvProjectEntry[];
  onChange: (entries: CvProjectEntry[]) => void;
}

export function Projects({ entries, onChange }: Props) {
  function addEntry() {
    onChange([...entries, { id: crypto.randomUUID(), title: '', bullets: [] }]);
  }

  function updateEntry(id: string, entry: CvProjectEntry) {
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

  return (
    <div className="flex flex-col gap-3">
      {entries.map((e, idx) => (
        <ProjectEntry
          key={e.id}
          entry={e}
          isFirst={idx === 0}
          isLast={idx === entries.length - 1}
          onChange={(updated) => updateEntry(e.id, updated)}
          onRemove={() => removeEntry(e.id)}
          onMoveUp={() => moveEntry(e.id, -1)}
          onMoveDown={() => moveEntry(e.id, 1)}
        />
      ))}
      <button
        type="button"
        onClick={addEntry}
        className="rounded-md border border-dashed border-indigo-300 py-2 text-sm text-indigo-600 hover:bg-indigo-50 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        + Add project
      </button>
    </div>
  );
}
