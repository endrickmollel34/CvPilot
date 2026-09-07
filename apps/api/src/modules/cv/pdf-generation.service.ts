import { PassThrough } from 'stream';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { Injectable } from '@nestjs/common';
import type {
  CvContent,
  CvSection,
  CvWorkEntry,
  CvEducationEntry,
  CvCertificationEntry,
  TemplateId,
} from '@cvpilot/shared';
import {
  DEFAULT_SECTION_ORDER,
  formatDateRange,
  getTemplate,
  normalizeExternalUrl,
  normalizeParagraph,
  shortenUrlLabel,
  type TemplateDefinition,
} from '@cvpilot/shared';

/**
 * CV Template Foundation, Phase 1 — Classic, PDFKit side.
 *
 * Root cause of the pre-Phase-1 basic look: hardcoded colors/margins/font
 * choices duplicated (and already drifting) between here and the browser
 * preview (apps/web's classic-document.tsx / old AtsClassic.tsx), and
 * PDFKit's built-in Helvetica base font being WinAnsi-only (no support for
 * many accented European characters).
 *
 * Fixed here by:
 *  1. Reading every color/size/spacing/margin value from `CLASSIC_TEMPLATE`
 *     (@cvpilot/shared) — the SAME tokens the React preview's CSS is built
 *     from (see classic-document.tsx's buildClassicCss) — rather than
 *     separately hardcoded constants. This does not make the two renderers
 *     share layout code (PDFKit has no CSS/flexbox engine — see the
 *     Template Foundation decision report for why that isn't attempted),
 *     but it makes color/font/spacing drift structurally impossible.
 *  2. Embedding Liberation Sans (SIL Open Font License 1.1 — see
 *     assets/fonts/LICENSE-LiberationSans.txt; explicitly permits
 *     embedding/redistribution with software) via `doc.registerFont()`,
 *     replacing the base Helvetica font. Liberation Sans is an
 *     Arial-metric-compatible general-purpose Latin font with full
 *     Latin-1 + Latin Extended-A coverage — resolves accented European
 *     characters (é, ü, ñ, ø, ç, ...) that Helvetica/WinAnsi could not
 *     render correctly. CJK/non-Latin scripts are explicitly out of scope
 *     for this phase (see the Template Foundation decision report).
 *
 * `generateStream` resolves `templateId` via the shared registry
 * (getTemplate, falling back to Classic for an unrecognized/omitted id),
 * then dispatches on `template.layout` to the matching render method —
 * `classicRender` (single-column) or `modernRender` (Phase 2, two-column;
 * see its own doc comment for the page-break strategy that doesn't share
 * layout code with Classic, the same way modern-document.tsx is a
 * separate React component from classic-document.tsx).
 */

const FONT_DIR = path.join(__dirname, 'assets', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'LiberationSans-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'LiberationSans-Bold.ttf');

// Minimum vertical space (pt) before drawing a section heading — if less
// remains on the page, a new page is added so headings are never orphaned.
const HEADING_MIN_SPACE = 60;

const CONTACT_SEPARATOR = '   ·   ';

@Injectable()
export class PdfGenerationService {
  // Returns a PassThrough stream that emits the PDF as it is generated.
  // StreamableFile accepts a Readable, so this pipes directly to the HTTP
  // response without buffering the full document in memory.
  generateStream(content: CvContent, docTitle?: string, templateId?: TemplateId): PassThrough {
    const template = getTemplate(templateId);
    const doc = new PDFDocument({
      size: 'A4',
      margins: template.margins,
      info: { Title: docTitle ?? content.personalDetails.fullName ?? 'CV' },
    });
    doc.registerFont('Body', FONT_REGULAR);
    doc.registerFont('Heading', FONT_BOLD);

    const pass = new PassThrough();
    doc.pipe(pass);
    try {
      if (template.layout === 'sidebar-main') {
        this.modernRender(doc, content, template);
      } else {
        this.classicRender(doc, content, template);
      }
    } catch (err) {
      // Propagate synchronous render errors to the stream consumer.
      doc.end();
      pass.destroy(err as Error);
      return pass;
    }
    doc.end();
    return pass;
  }

  private classicRender(doc: PDFKit.PDFDocument, content: CvContent, t: TemplateDefinition): void {
    const lm = t.margins.left;
    const pageW = doc.page.width - lm - t.margins.right;
    const { personalDetails: pd } = content;

    // ── Header ───────────────────────────────────────────────────────────
    doc
      .font('Heading')
      .fontSize(t.typography.nameSize)
      .fillColor(t.colors.text)
      .text(pd.fullName || 'Your Name', lm, doc.y, { align: 'center', width: pageW });

    if (pd.jobTitle) {
      doc.moveDown(0.25);
      doc
        .font('Body')
        .fontSize(t.typography.jobTitleSize)
        .fillColor(t.colors.muted)
        .text(pd.jobTitle, lm, doc.y, { align: 'center', width: pageW });
    }

    this.contactLine(doc, pd, lm, pageW, t);

    doc.moveDown(0.9);

    // ── Body sections ────────────────────────────────────────────────────
    const order = content.sectionOrder.length > 0 ? content.sectionOrder : DEFAULT_SECTION_ORDER;
    for (const section of order) {
      this.renderSection(doc, content, section, lm, pageW, t);
    }
  }

  /** Centered contact line with real clickable PDF links for LinkedIn/
   *  website — plain text for email/phone/location, which are not URLs. */
  private contactLine(
    doc: PDFKit.PDFDocument,
    pd: CvContent['personalDetails'],
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const segments: Array<{ text: string; url?: string }> = [];
    if (pd.email) segments.push({ text: pd.email });
    if (pd.phone) segments.push({ text: pd.phone });
    if (pd.location) segments.push({ text: pd.location });
    if (pd.linkedIn) segments.push({ text: pd.linkedIn, url: normalizeExternalUrl(pd.linkedIn) });
    if (pd.website) segments.push({ text: pd.website, url: normalizeExternalUrl(pd.website) });
    if (!segments.length) return;

    doc.moveDown(0.3);
    doc
      .font('Body')
      .fontSize(t.typography.metaSize - 0.5)
      .fillColor(t.colors.muted);

    let totalWidth = 0;
    segments.forEach((seg, i) => {
      totalWidth += doc.widthOfString(seg.text);
      if (i < segments.length - 1) totalWidth += doc.widthOfString(CONTACT_SEPARATOR);
    });
    const startX = lm + Math.max(0, (pageW - totalWidth) / 2);
    const y = doc.y;

    segments.forEach((seg, i) => {
      const isFirst = i === 0;
      const isLast = i === segments.length - 1;
      const segX = isFirst ? startX : doc.x;
      const segY = isFirst ? y : doc.y;

      if (isFirst) {
        doc.text(seg.text, startX, y, { continued: true });
      } else {
        doc.text(seg.text, { continued: true });
      }
      if (seg.url) {
        doc.link(segX, segY, doc.widthOfString(seg.text), doc.currentLineHeight(), seg.url);
      }
      doc.text(isLast ? '' : CONTACT_SEPARATOR, { continued: !isLast });
    });

    doc.fillColor(t.colors.text);
  }

  private renderSection(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    switch (section) {
      case 'summary':
        if (!content.summary) return;
        this.heading(doc, 'Summary', lm, pageW, t);
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text(content.summary, lm, doc.y, { width: pageW, lineGap: t.spacing.lineGap });
        doc.moveDown(0.8);
        break;

      case 'workExperience':
        if (!content.workExperience.length) return;
        this.heading(doc, 'Work Experience', lm, pageW, t);
        for (const e of content.workExperience) this.workEntry(doc, e, lm, pageW, t);
        doc.moveDown(0.2);
        break;

      case 'education':
        if (!content.education.length) return;
        this.heading(doc, 'Education', lm, pageW, t);
        for (const e of content.education) this.educationEntry(doc, e, lm, pageW, t);
        doc.moveDown(0.2);
        break;

      case 'skills':
        if (!content.skills.length) return;
        this.heading(doc, 'Skills', lm, pageW, t);
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text(
            content.skills.map((s) => (s.level ? `${s.name} (${s.level})` : s.name)).join('  ·  '),
            lm,
            doc.y,
            { width: pageW, lineGap: t.spacing.lineGap },
          );
        doc.moveDown(0.8);
        break;

      case 'languages':
        if (!content.languages.length) return;
        this.heading(doc, 'Languages', lm, pageW, t);
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text(
            content.languages
              .map((l) => (l.level ? `${l.name} (${l.level})` : l.name))
              .join('  ·  '),
            lm,
            doc.y,
            { width: pageW, lineGap: t.spacing.lineGap },
          );
        doc.moveDown(0.8);
        break;

      case 'certifications':
        if (!content.certifications.length) return;
        this.heading(doc, 'Certifications', lm, pageW, t);
        for (const c of content.certifications) {
          this.ensureSpace(doc, t, doc.heightOfString(c.name, { width: pageW }) + 20);
          doc
            .font('Heading')
            .fontSize(t.typography.bodySize)
            .fillColor(t.colors.text)
            .text(c.name, lm, doc.y, {
              width: pageW,
            });
          const meta = [c.issuer, c.date].filter(Boolean).join(' · ');
          if (meta) {
            doc
              .font('Body')
              .fontSize(t.typography.metaSize)
              .fillColor(t.colors.muted)
              .text(meta, lm, doc.y, { width: pageW });
          }
          doc.moveDown(0.4);
        }
        doc.moveDown(0.3);
        break;
    }
  }

  private heading(
    doc: PDFKit.PDFDocument,
    label: string,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    // moveTo/lineTo/stroke does NOT trigger PDFKit's automatic page-break
    // logic. If less than HEADING_MIN_SPACE remains, start a new page so
    // the rule and label are never orphaned at the bottom with content
    // starting on the next page.
    this.ensureSpace(doc, t, HEADING_MIN_SPACE);

    const y = doc.y;
    doc
      .moveTo(lm, y)
      .lineTo(lm + pageW, y)
      .lineWidth(0.5)
      .strokeColor(t.colors.rule)
      .stroke();
    doc.moveDown(0.3);
    doc
      .font('Heading')
      .fontSize(t.typography.headingSize)
      .fillColor(t.colors.heading)
      .text(label.toUpperCase(), lm, doc.y, { width: pageW, characterSpacing: 0.8 });
    doc.moveDown(0.5);
    doc.fillColor(t.colors.text);
  }

  /** Adds a new page if fewer than `neededHeight` points remain — used both
   *  for headings (fixed threshold) and, below, to keep a work/education
   *  entry from splitting across a page break whenever it can reasonably
   *  fit whole on a fresh page. Never forces a page break for an entry too
   *  tall to ever fit on one page — that would just loop uselessly. */
  private ensureSpace(doc: PDFKit.PDFDocument, t: TemplateDefinition, neededHeight: number): void {
    const spaceLeft = doc.page.height - t.margins.bottom - doc.y;
    const pageContentHeight = doc.page.height - t.margins.top - t.margins.bottom;
    if (neededHeight > spaceLeft && neededHeight <= pageContentHeight) {
      doc.addPage();
    }
  }

  private measureEntryHeight(
    doc: PDFKit.PDFDocument,
    titleColW: number,
    pageW: number,
    title: string,
    subtitle: string | undefined,
    meta: string | undefined,
    bullets: string[],
    t: TemplateDefinition,
  ): number {
    doc.font('Heading').fontSize(t.typography.bodySize);
    let height = doc.heightOfString(title, { width: titleColW });
    if (subtitle) {
      doc.font('Body').fontSize(t.typography.bodySize - 1);
      height += doc.heightOfString(subtitle, { width: pageW }) + 1;
    }
    if (meta) {
      doc.font('Body').fontSize(t.typography.metaSize);
      height += doc.heightOfString(meta, { width: pageW }) + 1;
    }
    const nonEmptyBullets = bullets.filter((b) => b.trim());
    if (nonEmptyBullets.length) {
      doc.font('Body').fontSize(t.typography.bodySize);
      for (const b of nonEmptyBullets) {
        height += doc.heightOfString(b, { width: pageW - 14 }) + t.spacing.bulletGap;
      }
    }
    return height + t.spacing.entryGap;
  }

  private workEntry(
    doc: PDFKit.PDFDocument,
    entry: CvWorkEntry,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate, entry.current);
    const dateColW = 100;
    const titleColW = pageW - dateColW;
    const companyLine = [entry.company, entry.location].filter(Boolean).join(', ');

    this.ensureSpace(
      doc,
      t,
      this.measureEntryHeight(
        doc,
        titleColW,
        pageW,
        entry.title,
        companyLine,
        undefined,
        entry.bullets,
        t,
      ),
    );

    const rowY = doc.y;
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize)
      .fillColor(t.colors.text)
      .text(entry.title, lm, rowY, {
        width: titleColW,
      });
    const afterTitle = doc.y;

    if (dateStr) {
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(dateStr, lm + titleColW, rowY, { width: dateColW, align: 'right' });
      if (doc.y < afterTitle) doc.y = afterTitle;
    }

    if (companyLine) {
      doc
        .font('Body')
        .fontSize(t.typography.bodySize - 1)
        .fillColor(t.colors.muted)
        .text(companyLine, lm, doc.y, { width: pageW });
    }

    const bullets = entry.bullets.filter((b) => b.trim());
    if (bullets.length) {
      doc.moveDown(0.2);
      for (const b of bullets) {
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text(`•  ${b}`, lm + 4, doc.y, { width: pageW - 4, lineGap: t.spacing.lineGap - 1 });
      }
    }

    doc.moveDown(0.65);
    doc.fillColor(t.colors.text);
  }

  private educationEntry(
    doc: PDFKit.PDFDocument,
    entry: CvEducationEntry,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate);
    const dateColW = 100;
    const degColW = pageW - dateColW;
    const degreeText = entry.field ? `${entry.degree} — ${entry.field}` : entry.degree;
    const instLine = [entry.institution, entry.location].filter(Boolean).join(', ');

    this.ensureSpace(
      doc,
      t,
      this.measureEntryHeight(doc, degColW, pageW, degreeText, instLine, entry.grade, [], t),
    );

    const rowY = doc.y;
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize)
      .fillColor(t.colors.text)
      .text(degreeText, lm, rowY, {
        width: degColW,
      });
    const afterDeg = doc.y;

    if (dateStr) {
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(dateStr, lm + degColW, rowY, { width: dateColW, align: 'right' });
      if (doc.y < afterDeg) doc.y = afterDeg;
    }

    if (instLine) {
      doc
        .font('Body')
        .fontSize(t.typography.bodySize - 1)
        .fillColor(t.colors.muted)
        .text(instLine, lm, doc.y, { width: pageW });
    }
    if (entry.grade) {
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(entry.grade, lm, doc.y, { width: pageW });
    }

    doc.moveDown(0.65);
    doc.fillColor(t.colors.text);
  }

  // ── Modern (Phase 2) ──────────────────────────────────────────────────
  //
  // Full-width header, then two columns: a narrow sidebar (Skills/
  // Languages/Certifications — `t.sidebarSections`) and a wider main
  // column (Summary/Work Experience/Education). PDFKit has no native
  // multi-column-with-page-flow support, so this is hand-managed:
  //
  //  1. The sidebar is rendered ONCE, entirely on page 1 — Skills/
  //     Languages/Certifications are realistically always short enough to
  //     fit a single page for any real CV. (Known limitation: a
  //     pathologically long list would run past the bottom margin rather
  //     than being silently truncated — see the module's report.)
  //  2. The main column starts at the SAME top y as the sidebar, in its
  //     own narrower width, so the two columns visually align on page 1.
  //  3. If the main column's content needs a page break, every page AFTER
  //     the first switches the main column to the FULL content width
  //     (there is no sidebar to run alongside on a continuation page) —
  //     a deliberate, common convention for two-column CVs, tracked via
  //     the mutable `column` object passed through every main-column
  //     helper below.
  //  4. (V3) Every such continuation page also gets a small running header
  //     (candidate name + thin rule) via modernContinuationHeader — see
  //     its doc comment for the deliberate reasoning, not a guess.
  private modernRender(doc: PDFKit.PDFDocument, content: CvContent, t: TemplateDefinition): void {
    const lm = t.margins.left;
    const pageW = doc.page.width - lm - t.margins.right;
    const { personalDetails: pd } = content;

    // ── Header (left-aligned — a deliberately different composition from
    // Classic's centered header) ────────────────────────────────────────
    doc
      .font('Heading')
      .fontSize(t.typography.nameSize)
      .fillColor(t.colors.text)
      .text(pd.fullName || 'Your Name', lm, doc.y, { width: pageW });

    if (pd.jobTitle) {
      doc.moveDown(0.2);
      doc
        .font('Body')
        .fontSize(t.typography.jobTitleSize)
        .fillColor(t.colors.accent)
        .text(pd.jobTitle, lm, doc.y, { width: pageW });
    }

    doc.moveDown(0.5);
    const ruleY = doc.y;
    doc
      .moveTo(lm, ruleY)
      .lineTo(lm + 54, ruleY)
      .lineWidth(2.5)
      .strokeColor(t.colors.accent)
      .stroke();
    doc.moveDown(0.6);

    this.modernContactLine(doc, pd, lm, pageW, t);
    doc.moveDown(1.3);

    // ── Two-column body ──────────────────────────────────────────────────
    const contentTop = doc.y;
    const gap = t.spacing.sectionGap;
    const sidebarRatio = t.sidebarWidthRatio ?? 0.34;
    const sidebarW = pageW * sidebarRatio - gap / 2;
    const mainW = pageW - sidebarW - gap;
    const sidebarX = lm;
    const mainX = lm + sidebarW + gap;

    // Sidebar background — a full-bleed tint from just below the header to
    // the bottom of the page (NOT just wrapping around the sidebar's own
    // text), so the sidebar reads as a deliberately designed region
    // regardless of how little content it holds — solving the "sparse
    // sidebar looks unfinished" problem structurally rather than by
    // stretching spacing or inventing content. Bleeds to the physical page
    // edge (x=0) for a confident, intentional composition; sidebar TEXT
    // still starts at the normal margin (sidebarX = lm) below. Starts a
    // few points BELOW contentTop (never above it) — an earlier revision
    // bled upward and visibly clipped into the contact line's own text row.
    const sidebarBgTop = contentTop + 5;
    if (t.sidebarBackground) {
      doc
        .rect(0, sidebarBgTop, mainX - gap / 2, doc.page.height - sidebarBgTop)
        .fillColor(t.sidebarBackground)
        .fill();
    }

    const order = content.sectionOrder.length > 0 ? content.sectionOrder : DEFAULT_SECTION_ORDER;
    const sidebarSet = new Set(t.sidebarSections ?? []);
    const sidebarSections = order.filter((s) => sidebarSet.has(s));
    const mainSections = order.filter((s) => !sidebarSet.has(s));

    // Sidebar — own local cursor, always page 1 (see class doc comment).
    doc.y = contentTop;
    for (const section of sidebarSections) {
      this.modernSidebarSection(doc, content, section, sidebarX, sidebarW, t);
    }

    // Main column — independent cursor, starts level with the sidebar.
    doc.y = contentTop;
    const column: ModernColumn = {
      x: mainX,
      width: mainW,
      isFirstPage: true,
      candidateName: pd.fullName || 'CV',
    };
    for (const section of mainSections) {
      this.modernMainSection(doc, content, section, column, lm, pageW, t);
    }
    doc.fillColor(t.colors.text);
  }

  /** Left-aligned contact line — same clickable-link approach as Classic's
   *  contactLine, without the centering math. */
  private modernContactLine(
    doc: PDFKit.PDFDocument,
    pd: CvContent['personalDetails'],
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const segments: Array<{ text: string; url?: string }> = [];
    if (pd.email) segments.push({ text: pd.email });
    if (pd.phone) segments.push({ text: pd.phone });
    if (pd.location) segments.push({ text: pd.location });
    // Displayed label is shortened (scheme/www stripped, long paths
    // truncated) so a long LinkedIn/website value can't dominate the
    // header row; the link destination (url) is always the full,
    // untruncated value — only the on-page text is shortened.
    if (pd.linkedIn) {
      segments.push({ text: shortenUrlLabel(pd.linkedIn), url: normalizeExternalUrl(pd.linkedIn) });
    }
    if (pd.website) {
      segments.push({ text: shortenUrlLabel(pd.website), url: normalizeExternalUrl(pd.website) });
    }
    if (!segments.length) return;

    doc.font('Body').fontSize(t.typography.metaSize).fillColor(t.colors.muted);
    const y = doc.y;

    segments.forEach((seg, i) => {
      const isFirst = i === 0;
      const isLast = i === segments.length - 1;
      const segX = doc.x;
      const segY = doc.y;

      if (isFirst) {
        doc.text(seg.text, lm, y, { continued: true, width: pageW });
      } else {
        doc.text(seg.text, { continued: true });
      }
      if (seg.url) {
        doc.link(segX, segY, doc.widthOfString(seg.text), doc.currentLineHeight(), seg.url);
      }
      doc.text(isLast ? '' : MODERN_CONTACT_SEPARATOR, { continued: !isLast });
    });

    doc.fillColor(t.colors.text);
  }

  /** Adds a page if `neededHeight` doesn't fit; on the FIRST such break for
   *  a main-column render, widens `column` to the full page width for
   *  every page after page 1 (see modernRender's doc comment). Every page
   *  this adds (not just the first) gets the continuation running header —
   *  see modernContinuationHeader's doc comment for the page-2+ design
   *  decision this implements. */
  private modernEnsureSpace(
    doc: PDFKit.PDFDocument,
    t: TemplateDefinition,
    neededHeight: number,
    column: ModernColumn,
    lm: number,
    pageW: number,
  ): void {
    const spaceLeft = doc.page.height - t.margins.bottom - doc.y;
    const pageContentHeight = doc.page.height - t.margins.top - t.margins.bottom;
    if (neededHeight > spaceLeft && neededHeight <= pageContentHeight) {
      doc.addPage();
      if (column.isFirstPage) {
        column.x = lm;
        column.width = pageW;
        column.isFirstPage = false;
      }
      this.modernContinuationHeader(doc, column.candidateName, lm, pageW, t);
    }
  }

  /**
   * V3 page-2+ decision (documented per the task's explicit request — this
   * was chosen deliberately, not guessed):
   *
   * The sidebar (Skills/Languages/Certifications) always finishes entirely
   * on page 1 — see modernRender's doc comment. That means a continuation
   * page has nothing to put in a second column, so the two options
   * considered were (a) bleed the sidebar tint across the FULL page width
   * on continuation pages purely for color continuity, or (b) leave
   * continuation pages plain white, full-width, with a small running
   * header identifying the document. (a) was rejected: a full-width tinted
   * page would visually read as a completely different, heavier page than
   * page 1's restrained accent tint, and risks looking like an unrelated
   * colored panel rather than a considered choice. (b) is what's
   * implemented here — a compact candidate-name + thin accent-toned rule
   * at the top margin of every page after the first, so a continuation
   * page reads as "page 2 of one intentional document" rather than
   * overflow debris, while staying within the "no unnecessary graphics"
   * constraint (it's plain text + a 0.75pt rule, using the same design
   * language as the rest of Modern, not a new decorative element).
   */
  private modernContinuationHeader(
    doc: PDFKit.PDFDocument,
    candidateName: string,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    doc
      .font('Heading')
      .fontSize(t.typography.metaSize + 1)
      .fillColor(t.colors.muted)
      .text(candidateName, lm, doc.y, { width: pageW, characterSpacing: 0.3 });
    const ruleY = doc.y + 5;
    doc
      .moveTo(lm, ruleY)
      .lineTo(lm + pageW, ruleY)
      .lineWidth(0.75)
      .strokeColor(t.colors.rule)
      .stroke();
    doc.y = ruleY + 16;
    doc.fillColor(t.colors.text);
  }

  private modernHeading(
    doc: PDFKit.PDFDocument,
    label: string,
    x: number,
    width: number,
    t: TemplateDefinition,
  ): void {
    doc
      .font('Heading')
      .fontSize(t.typography.headingSize)
      .fillColor(t.colors.heading)
      .text(label, x, doc.y, { width });
    const afterLabelY = doc.y;
    doc
      .moveTo(x, afterLabelY + 3)
      .lineTo(x + 26, afterLabelY + 3)
      .lineWidth(2)
      .strokeColor(t.colors.accent)
      .stroke();
    doc.y = afterLabelY + 9;
    doc.fillColor(t.colors.text);
  }

  private modernSidebarSection(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    x: number,
    width: number,
    t: TemplateDefinition,
  ): void {
    switch (section) {
      case 'skills':
        if (!content.skills.length) return;
        this.modernHeading(doc, 'Skills', x, width, t);
        this.modernChips(
          doc,
          content.skills.map((s) => (s.level ? `${s.name} · ${s.level}` : s.name)),
          x,
          width,
          t,
        );
        doc.moveDown(1.1);
        break;

      case 'languages':
        if (!content.languages.length) return;
        this.modernHeading(doc, 'Languages', x, width, t);
        for (const l of content.languages) {
          doc
            .font('Heading')
            .fontSize(t.typography.bodySize - 0.5)
            .fillColor(t.colors.text)
            .text(l.name, x, doc.y, {
              width,
              continued: Boolean(l.level),
            });
          if (l.level) {
            doc
              .font('Body')
              .fontSize(t.typography.metaSize)
              .fillColor(t.colors.muted)
              .text(`  ${l.level}`, { continued: false });
          }
          doc.moveDown(0.3);
        }
        doc.moveDown(0.85);
        break;

      case 'certifications':
        if (!content.certifications.length) return;
        this.modernHeading(doc, 'Certifications', x, width, t);
        for (const c of content.certifications) {
          this.modernCertification(doc, c, x, width, t);
        }
        break;

      default:
        break;
    }
    doc.fillColor(t.colors.text);
  }

  private modernCertification(
    doc: PDFKit.PDFDocument,
    c: CvCertificationEntry,
    x: number,
    width: number,
    t: TemplateDefinition,
  ): void {
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.5)
      .fillColor(t.colors.text)
      .text(c.name, x, doc.y, {
        width,
      });
    const meta = [c.issuer, c.date].filter(Boolean).join(' · ');
    if (meta) {
      doc.moveDown(0.05);
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(meta, x, doc.y, { width });
    }
    doc.moveDown(0.65);
  }

  /** Draws the chip's white-fill / thin-teal-border box — chips must stay
   *  clearly visible against the sidebar's own light teal background tint,
   *  not blend into it (an earlier revision's chip fill was nearly the
   *  same color as the sidebar tint). */
  private drawChipBox(
    doc: PDFKit.PDFDocument,
    chipX: number,
    chipY: number,
    chipW: number,
    chipH: number,
  ): void {
    doc
      .roundedRect(chipX, chipY, chipW, chipH, 3)
      .fillColor('#FFFFFF')
      .fill()
      .roundedRect(chipX, chipY, chipW, chipH, 3)
      .lineWidth(0.75)
      .strokeColor('#BFE0DC')
      .stroke();
  }

  /**
   * Wrapped chip-style tags for Skills — plain text pills, never a
   * proficiency indicator (see the module report: no dots/bars unless the
   * data genuinely has a rating, which CvSkillEntry.level — free text —
   * does not).
   *
   * A skill name is FACTUAL CV content and must never be silently
   * truncated (a prior revision ellipsized an unusually long name, which
   * lost part of it from the PDF's text layer — fixed here). Three tiers,
   * cheapest/most-common first:
   *  1. Fits on one line — a normal compact chip, packed into the current
   *     row alongside others.
   *  2. Doesn't fit on one line, but every individual word does — the chip
   *     gets its own full-width row and wraps to multiple lines, still a
   *     bordered chip, just taller.
   *  3. A single word alone is wider than the sidebar (pathological,
   *     unrealistic data) — no chip box can hold it without clipping, so
   *     it falls back to a plain wrapped label with no chip styling
   *     (same treatment as Certifications/Languages) so the complete text
   *     is always rendered.
   * A wrapped/fallback item (tiers 2–3) always starts and ends its own row
   * — it's never packed beside another chip — so row heights stay simple.
   */
  private modernChips(
    doc: PDFKit.PDFDocument,
    labels: string[],
    x: number,
    width: number,
    t: TemplateDefinition,
  ): void {
    const chipPadX = 6;
    const chipPadY = 4;
    const chipGap = 5;
    const rowGap = 5;
    const chipH = t.typography.metaSize + 8;
    const maxLabelW = Math.max(width - chipPadX * 2, 20);

    let curX = x;
    let curY = doc.y;
    let rowH = 0;

    for (const label of labels) {
      doc.font('Heading').fontSize(t.typography.metaSize);
      const naturalW = doc.widthOfString(label);

      if (naturalW <= maxLabelW) {
        const chipW = naturalW + chipPadX * 2;
        if (curX !== x && curX + chipW > x + width) {
          curX = x;
          curY += rowH + rowGap;
          rowH = 0;
        }
        this.drawChipBox(doc, curX, curY, chipW, chipH);
        doc
          .fillColor(t.colors.heading)
          .text(label, curX + chipPadX, curY + 4, { width: naturalW, lineBreak: false });
        curX += chipW + chipGap;
        rowH = Math.max(rowH, chipH);
        continue;
      }

      // Doesn't fit on one line — always give it a fresh row.
      if (curX !== x) {
        curX = x;
        curY += rowH + rowGap;
        rowH = 0;
      }

      const words = label.split(/\s+/).filter(Boolean);
      const widestWord = words.length ? Math.max(...words.map((w) => doc.widthOfString(w))) : 0;

      if (widestWord <= maxLabelW) {
        const textH = doc.heightOfString(label, { width: maxLabelW, lineGap: 1 });
        const chipW = maxLabelW + chipPadX * 2;
        const wrappedChipH = textH + chipPadY * 2;
        this.drawChipBox(doc, curX, curY, chipW, wrappedChipH);
        doc
          .fillColor(t.colors.heading)
          .text(label, curX + chipPadX, curY + chipPadY, { width: maxLabelW, lineGap: 1 });
        rowH = wrappedChipH;
      } else {
        const textH = doc.heightOfString(label, { width, lineGap: 1 });
        doc.fillColor(t.colors.heading).text(label, curX, curY, { width, lineGap: 1 });
        rowH = textH;
      }

      curX = x;
      curY += rowH + rowGap;
      rowH = 0;
    }

    doc.y = curY + rowH;
    doc.x = x;
  }

  private modernMainSection(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    column: ModernColumn,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    switch (section) {
      case 'summary':
        if (!content.summary) return;
        this.modernEnsureSpace(doc, t, HEADING_MIN_SPACE, column, lm, pageW);
        this.modernHeading(doc, 'Summary', column.x, column.width, t);
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          // normalizeParagraph collapses stray blank lines a candidate may
          // have pasted into the summary field — presentation only, never
          // alters the actual words (see format.ts's doc comment). Fixes
          // an unbalanced double-gap seen in production-shaped content.
          .text(normalizeParagraph(content.summary), column.x, doc.y, {
            width: column.width,
            lineGap: t.spacing.lineGap,
          });
        doc.moveDown(1.1);
        break;

      case 'workExperience':
        if (!content.workExperience.length) return;
        this.modernEnsureSpace(doc, t, HEADING_MIN_SPACE, column, lm, pageW);
        this.modernHeading(doc, 'Work Experience', column.x, column.width, t);
        for (const e of content.workExperience) this.modernWorkEntry(doc, e, column, lm, pageW, t);
        break;

      case 'education':
        if (!content.education.length) return;
        this.modernEnsureSpace(doc, t, HEADING_MIN_SPACE, column, lm, pageW);
        this.modernHeading(doc, 'Education', column.x, column.width, t);
        for (const e of content.education) this.modernEducationEntry(doc, e, column, lm, pageW, t);
        break;

      default:
        break;
    }
  }

  /**
   * Measures the actual formatted date string and sizes the date column to
   * fit it (clamped to a sensible min/max), rather than assuming a fixed
   * width — a hardcoded width let long date strings ("September 2016 –
   * Present") wrap or crowd against the title column on a fixture-specific
   * basis. The title column always gets whatever remains, so title and
   * date can never overlap regardless of either string's length.
   */
  private modernDateColWidth(
    doc: PDFKit.PDFDocument,
    dateStr: string,
    t: TemplateDefinition,
    columnWidth: number,
  ): number {
    doc.font('Body').fontSize(t.typography.metaSize);
    const measured = doc.widthOfString(dateStr);
    const minW = 68;
    const maxW = Math.min(columnWidth * 0.42, 170);
    return Math.min(Math.max(measured, minW), maxW);
  }

  private modernWorkEntry(
    doc: PDFKit.PDFDocument,
    entry: CvWorkEntry,
    column: ModernColumn,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate, entry.current);
    const dateGap = dateStr ? 8 : 0;
    const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, column.width) : 0;
    const titleColW = column.width - dateColW - dateGap;
    const orgLine = entry.company + (entry.location ? ` · ${entry.location}` : '');

    this.modernEnsureSpace(
      doc,
      t,
      this.measureEntryHeight(
        doc,
        titleColW,
        column.width,
        entry.title,
        orgLine,
        undefined,
        entry.bullets,
        t,
      ),
      column,
      lm,
      pageW,
    );

    const rowY = doc.y;
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize)
      .fillColor(t.colors.text)
      .text(entry.title, column.x, rowY, {
        width: titleColW,
      });
    const afterTitle = doc.y;

    if (dateStr) {
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(dateStr, column.x + column.width - dateColW, rowY, {
          width: dateColW,
          align: 'right',
        });
      if (doc.y < afterTitle) doc.y = afterTitle;
    }

    doc.moveDown(0.08);
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.7)
      .fillColor(t.colors.accent)
      .text(orgLine, column.x, doc.y, { width: column.width, characterSpacing: 0.1 });

    const bullets = entry.bullets.filter((b) => b.trim());
    if (bullets.length) {
      doc.moveDown(0.3);
      bullets.forEach((b, i) => {
        // Explicit inter-bullet gap (spacing.bulletGap) — text() calls back
        // to back have zero gap between them by default; without this,
        // bullets read as visually cramped on content-dense CVs.
        if (i > 0) doc.y += t.spacing.bulletGap;
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text(`•  ${b}`, column.x + 5, doc.y, {
            width: column.width - 5,
            lineGap: t.spacing.lineGap - 1,
          });
      });
    }

    doc.moveDown(0.8);
    doc.fillColor(t.colors.text);
  }

  private modernEducationEntry(
    doc: PDFKit.PDFDocument,
    entry: CvEducationEntry,
    column: ModernColumn,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate);
    const dateGap = dateStr ? 8 : 0;
    const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, column.width) : 0;
    const degColW = column.width - dateColW - dateGap;
    const degreeText = entry.field ? `${entry.degree} — ${entry.field}` : entry.degree;
    const instLine = entry.institution + (entry.location ? ` · ${entry.location}` : '');

    this.modernEnsureSpace(
      doc,
      t,
      this.measureEntryHeight(doc, degColW, column.width, degreeText, instLine, entry.grade, [], t),
      column,
      lm,
      pageW,
    );

    const rowY = doc.y;
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize)
      .fillColor(t.colors.text)
      .text(degreeText, column.x, rowY, {
        width: degColW,
      });
    const afterDeg = doc.y;

    if (dateStr) {
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(dateStr, column.x + column.width - dateColW, rowY, {
          width: dateColW,
          align: 'right',
        });
      if (doc.y < afterDeg) doc.y = afterDeg;
    }

    doc.moveDown(0.08);
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.7)
      .fillColor(t.colors.accent)
      .text(instLine, column.x, doc.y, { width: column.width, characterSpacing: 0.1 });

    if (entry.grade) {
      // The schema's `grade` field is free text with no declared scale
      // (could be a GPA, a percentage, a classification, ...) — see the
      // module report for why this uses the neutral, schema-name-matching
      // "Grade:" label rather than guessing a specific scale like "GPA:".
      doc.moveDown(0.05);
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(`Grade: ${entry.grade}`, column.x, doc.y, { width: column.width });
    }

    doc.moveDown(0.8);
    doc.fillColor(t.colors.text);
  }
}

/** Mutable main-column geometry for Modern — see modernRender's doc
 *  comment on why it switches to full page width after the first page
 *  break. */
interface ModernColumn {
  x: number;
  width: number;
  isFirstPage: boolean;
  /** Candidate name, carried along so a page break can draw the
   *  continuation-page running header (see modernEnsureSpace) without
   *  threading an extra parameter through every main-column helper. */
  candidateName: string;
}

const MODERN_CONTACT_SEPARATOR = '   ·   ';
