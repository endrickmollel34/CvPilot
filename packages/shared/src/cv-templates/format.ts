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

/**
 * Full (never-truncated) display label for a LinkedIn profile URL —
 * strips the scheme, a leading "www.", any query string (tracking
 * parameters like "?trk=..." or "?utm_source=...") and hash fragment, and
 * a trailing slash: "https://www.linkedin.com/in/alex-johnson/?trk=public"
 * becomes "linkedin.com/in/alex-johnson". Unlike `shortenUrlLabel`, this
 * never truncates with an ellipsis — the caller is expected to let this
 * wrap across multiple lines instead of shrinking or clipping it
 * (RABBIT_NOTEBOOK.md: "Improve LinkedIn address rendering"). Every
 * meaningful profile-path character (the "/in/handle" segment and
 * anything else before the query string) is preserved.
 *
 * Display-only, same convention as `shortenUrlLabel`: the underlying
 * hyperlink (built from the untruncated RAW value via
 * `normalizeExternalUrl`, unchanged by this function) still points at the
 * complete original URL, tracking parameters included — this only affects
 * what's shown on the page/PDF, never the actual link destination or the
 * stored CV data.
 */
export function formatLinkedInLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  let label = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '');
  // Strip tracking query parameters and any hash fragment first — neither
  // is part of the profile's own path, and stripping them AFTER a trailing
  // slash removal (like shortenUrlLabel does) would leave a stray slash
  // right before the "?"/"#" in some inputs.
  label = label.split(/[?#]/)[0] ?? label;
  label = label.replace(/\/$/, '');
  return label;
}

/**
 * Inserts an invisible break opportunity (U+200B, zero-width space) so an
 * email/URL with no spaces at all — which otherwise gives the browser's
 * CSS wrapping no legal break point, and it falls back to an arbitrary
 * character position instead (observed: "alex.johnson@university.ac.uk"
 * wrapping as "alex.johnson@university.ac.u" / "k", stranding a single
 * character alone on its own line) — has somewhere sensible to wrap.
 *
 * For an email specifically (anything containing "@"), only ONE hint is
 * added, right after the "@" — this prefers keeping the whole domain
 * ("university.ac.uk") together on one line rather than also offering
 * break points inside it, matching profile-pdf-renderer.ts's
 * wrapContactText preference exactly (same outcome, via the renderer-
 * appropriate mechanism each side actually needs — see that function's own
 * doc comment for why the PDF side can't use this same U+200B approach).
 * If the domain itself still doesn't fit on one line at this width,
 * `.cvpf-pd-list li`'s own `overflow-wrap: anywhere` (buildProfileCss) is
 * the existing fallback — this never leaves text unable to wrap at all.
 *
 * For non-email text (a website/location with "."s but no "@"), a hint is
 * added after every "." instead, same as before.
 *
 * Display-only, same convention as shortenUrlLabel: never applied to the
 * actual href/mailto target, only to what's shown on the page. A copy-
 * pasted result may carry the invisible character; the visible/printed
 * text is identical either way.
 */
export function insertWrapHints(text: string): string {
  const atIndex = text.indexOf('@');
  if (atIndex !== -1) {
    return `${text.slice(0, atIndex + 1)}\u200B${text.slice(atIndex + 1)}`;
  }
  return text.replace(/\./g, '.\u200B');
}
