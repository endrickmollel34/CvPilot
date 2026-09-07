/**
 * Pure formatting helpers shared between the React preview
 * (classic-document.tsx) and the PDFKit renderer (apps/api's
 * pdf-generation.service.ts) — the one class of logic that genuinely can be
 * shared as plain functions even though the two renderers' actual
 * layout/drawing code cannot be (see the Template Foundation decision
 * report). Kept deliberately tiny.
 */

/** "2021-03" + current → "Mar 2021 – Present"; matches the format both
 *  renderers have always used. */
export function formatDateRange(start?: string, end?: string, current?: boolean): string {
  if (!start) return '';
  const fmt = (ym: string): string => {
    const [y, m] = ym.split('-');
    if (!m) return y ?? '';
    const date = new Date(Number(y), Number(m) - 1);
    return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  };
  return `${fmt(start)} – ${current ? 'Present' : end ? fmt(end) : ''}`;
}

/**
 * Normalizes a candidate-entered LinkedIn/website value into a real,
 * dereferenceable URL a hyperlink can point at — candidates commonly type
 * "linkedin.com/in/x" without a scheme. Returns undefined for empty input
 * so callers can decide whether to render a plain-text fallback.
 */
export function normalizeExternalUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  // Already has a scheme (http(s):// or something else, e.g. mailto:) — use as-is.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Collapses any run of whitespace (including blank/double-newlines some
 * candidates paste into a summary field) into a single space. Presentation
 * only — never removes, reorders, or alters a single word of the actual
 * text — fixing the specific case of an unintentional mid-paragraph blank
 * line rendering as a large, unbalanced visual gap.
 */
export function normalizeParagraph(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Produces a short, display-friendly label for a URL-ish contact value
 * (LinkedIn/website) — strips the scheme and a leading "www.", and
 * truncates with an ellipsis past `maxLen` so a long URL never dominates
 * a compact contact row. Display-only: the underlying hyperlink (built
 * from the untruncated value via normalizeExternalUrl) always still
 * points at the full original URL, and stored CV data is never altered.
 */
export function shortenUrlLabel(raw: string, maxLen = 34): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  let label = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '');
  label = label.replace(/\/$/, '');
  if (label.length > maxLen) {
    label = `${label.slice(0, maxLen - 1)}…`;
  }
  return label;
}
