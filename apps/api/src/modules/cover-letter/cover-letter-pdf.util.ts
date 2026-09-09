import path from 'path';
import PDFDocument from 'pdfkit';

/**
 * Cover Letter V2/V2.1 — PDF renderer. Pulled out of CoverLetterService into
 * its own pure function (input in, Buffer out) so it's directly unit-
 * testable without mocking S3/R2, and so the "what does the downloaded PDF
 * actually contain" logic lives in one place the live preview's layout can
 * be checked against by eye.
 *
 * V2.1 — traditional two-sided business-letter composition: the sender
 * (candidate) block sits upper-right, the date/recipient block sits left
 * below it, sequentially — never two side-by-side columns on the same row.
 * Deliberately monochrome (charcoal + muted gray only, no accent color, no
 * rule/divider) and un-CV-like — a real letter's authority comes from
 * restraint and correct structure, not decoration; see the module report
 * for why a hairline divider (present in V2) was dropped here.
 *
 * Reuses the CV module's already-embedded Liberation Sans font files
 * rather than introducing a second font dependency or falling back to
 * PDFKit's built-in Helvetica, which cannot render accented Latin
 * characters (é, ü, ñ, ø, ç, ...) — see pdf-generation.service.ts's own
 * doc comment for the original investigation this avoids repeating.
 * Cover Letter's compiled output lives at dist/modules/cover-letter/, one
 * directory away from the CV module's dist/modules/cv/assets/fonts — that
 * relative path is the only thing that differs from the CV renderer's own
 * FONT_DIR constant.
 */

const FONT_DIR = path.join(__dirname, '..', 'cv', 'assets', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'LiberationSans-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'LiberationSans-Bold.ttf');

// 72pt (1 inch) — a deliberately traditional business-letter margin,
// nudged up from V2's 64pt for a more considered, less "Word default" feel.
const MARGIN = 72;
const COLOR_TEXT = '#1F2430';
const COLOR_MUTED = '#5B6570';

export interface CoverLetterPdfInput {
  candidateName?: string;
  email?: string;
  phone?: string;
  location?: string;
  /** V2.1 — a full free-text postal address, optional and never inferred.
   *  When present, supersedes `location` in the sender block (the address
   *  is assumed to already carry city/country) rather than showing both
   *  and risking a redundant "Zürich, Switzerland" appearing twice. */
  senderAddress?: string | null;
  /** The letter's own date (generatedAt if available, else createdAt) —
   *  deliberately not "today", so a downloaded PDF's date stays stable
   *  across re-downloads. */
  date: Date;
  recipientName?: string;
  recipientTitle?: string;
  companyName?: string;
  companyAddress?: string;
  content: string;
}

/** True when `content` already opens with its own greeting line (e.g.
 *  "Dear Hiring Manager,"). The generation prompt (cover-letter-ai.service.ts)
 *  explicitly excludes a signature block but does not explicitly exclude a
 *  greeting, and real generations commonly include one — rendering a second,
 *  hardcoded greeting on top would produce a visible "Dear X, Dear Y,"
 *  double opening. Detected rather than assumed either way, so this comes
 *  out correct regardless of which the model actually produced for a given
 *  letter. */
function contentHasOwnGreeting(content: string): boolean {
  return /^\s*dear\b/i.test(content);
}

/** Same defensive idea as contentHasOwnGreeting(), for the closing. The
 *  generation prompt explicitly says "no signature block", so this should
 *  never actually trigger in practice — kept as a cheap, real safety net
 *  (not a new AI-side rule) rather than assumed unnecessary, per the
 *  module report's "do the same sanity check for the closing if
 *  necessary". Checked only in the last ~200 characters so a candidate's
 *  own body text mentioning "regards" mid-paragraph can't false-positive. */
function contentHasOwnClosing(content: string): boolean {
  const tail = content.trim().slice(-200).toLowerCase();
  return /\b(sincerely|regards|yours faithfully|yours truly)\b/.test(tail);
}

function formatLetterDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Sender (candidate) block content — name plus whatever contact/address
 *  lines are actually available. `senderAddress` (free text, split on
 *  newlines) supersedes the short `location` field when present, rather
 *  than showing both — never fabricates a missing line. */
function buildSenderLines(input: CoverLetterPdfInput): { name?: string; rest: string[] } {
  const name = input.candidateName?.trim() || undefined;
  const addressLines = input.senderAddress?.trim()
    ? input.senderAddress
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : input.location
      ? [input.location]
      : [];
  const rest = [...addressLines, input.email, input.phone].filter((l): l is string =>
    Boolean(l && l.trim()),
  );
  return { name, rest };
}

export function generateCoverLetterPdf(input: CoverLetterPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
    doc.registerFont('Body', FONT_REGULAR);
    doc.registerFont('Heading', FONT_BOLD);

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width - MARGIN * 2;

    // ── Sender block — upper right ──────────────────────────────────────
    // Right-aligned within the full content width rather than a narrower
    // column: each line individually flushes right, producing a ragged-
    // left/flush-right block without needing manual column math. This is
    // the ONLY right-aligned content in the document — the date/recipient/
    // greeting/body/closing below are all left-aligned, so sender and
    // recipient read as visually opposite, never a two-column table.
    const { name: candidateName, rest: senderRest } = buildSenderLines(input);
    if (candidateName) {
      doc
        .font('Heading')
        .fontSize(11)
        .fillColor(COLOR_TEXT)
        .text(candidateName, MARGIN, doc.y, { width: pageW, align: 'right' });
    }
    if (senderRest.length) {
      if (candidateName) doc.moveDown(0.25);
      doc.font('Body').fontSize(9.5).fillColor(COLOR_MUTED);
      for (const line of senderRest) {
        doc.text(line, MARGIN, doc.y, { width: pageW, align: 'right' });
      }
    }
    // Gap below the letterhead area — still the clearest "section break"
    // in the document (right-aligned identity vs. left-aligned business
    // content), just tightened per V2.1 micro-polish review: was 2.2x
    // line-height (~23.3pt in the common case, senderRest present),
    // reduced to 1.2x (~10.6pt) — a ~10.6-12.7pt cut depending on which
    // font was last active, landing in the requested "10-15pt" range
    // without collapsing the two areas together (the date's own alignment/
    // size/color change from the sender block already reinforces the
    // visual break independent of whitespace alone).
    if (candidateName || senderRest.length) doc.moveDown(1.2);

    // ── Date — left ──────────────────────────────────────────────────────
    doc
      .font('Body')
      .fontSize(10)
      .fillColor(COLOR_TEXT)
      .text(formatLetterDate(input.date), MARGIN, doc.y, { width: pageW });
    doc.moveDown(0.65);

    // ── Recipient block — left ──────────────────────────────────────────
    const recipientLines = [
      input.recipientName,
      input.recipientTitle,
      input.companyName,
      ...(input.companyAddress
        ? input.companyAddress
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
        : []),
    ].filter((l): l is string => Boolean(l && l.trim()));

    if (recipientLines.length) {
      doc.font('Body').fontSize(10).fillColor(COLOR_TEXT);
      for (const line of recipientLines) {
        doc.text(line, MARGIN, doc.y, { width: pageW });
      }
      doc.moveDown(1.3);
    }

    // ── Greeting ─────────────────────────────────────────────────────────
    const hasOwnGreeting = contentHasOwnGreeting(input.content);
    if (!hasOwnGreeting) {
      const greeting = input.recipientName
        ? `Dear ${input.recipientName},`
        : 'Dear Hiring Manager,';
      doc
        .font('Body')
        .fontSize(10.5)
        .fillColor(COLOR_TEXT)
        .text(greeting, MARGIN, doc.y, { width: pageW });
      doc.moveDown(1.1);
    }

    // ── Body ─────────────────────────────────────────────────────────────
    // Paragraphs are split on blank lines and have internal whitespace
    // collapsed — the AI is prompted for well-structured paragraphs
    // typically separated by blank lines, but this stays robust either way.
    const paragraphs = input.content
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    doc.font('Body').fontSize(10.5).fillColor(COLOR_TEXT);
    paragraphs.forEach((paragraph, i) => {
      if (i > 0) doc.moveDown(0.9);
      doc.text(paragraph, MARGIN, doc.y, { width: pageW, align: 'left', lineGap: 4 });
    });

    // ── Closing ──────────────────────────────────────────────────────────
    // Kept together across a page break where reasonably avoidable: the
    // needed height (gap + "Sincerely," + signature gap + printed name) is
    // measured up front, and a fresh page is started rather than letting
    // PDFKit's natural flow split "Sincerely," from the name below it.
    if (!contentHasOwnClosing(input.content)) {
      doc.font('Body').fontSize(10.5);
      const bodyLineH = doc.currentLineHeight();
      const gapBeforeClosing = 1.7 * bodyLineH;
      const signatureGap = 2.4 * bodyLineH;
      const closingLabelH = doc.heightOfString('Sincerely,', { width: pageW });

      doc.font('Heading').fontSize(11);
      const nameH = candidateName ? doc.heightOfString(candidateName, { width: pageW }) : 0;

      const neededHeight =
        gapBeforeClosing + closingLabelH + (candidateName ? signatureGap + nameH : 0);
      const pageContentHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
      const spaceLeft = doc.page.height - doc.page.margins.bottom - doc.y;

      if (neededHeight > spaceLeft && neededHeight <= pageContentHeight) {
        doc.addPage();
      } else {
        doc.y += gapBeforeClosing;
      }

      doc
        .font('Body')
        .fontSize(10.5)
        .fillColor(COLOR_TEXT)
        .text('Sincerely,', MARGIN, doc.y, { width: pageW });
      if (candidateName) {
        doc.y += signatureGap;
        doc
          .font('Heading')
          .fontSize(11)
          .fillColor(COLOR_TEXT)
          .text(candidateName, MARGIN, doc.y, { width: pageW });
      }
    }

    doc.end();
  });
}
