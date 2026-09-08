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
 * then dispatches BY ID to the matching render method — `classicRender`
 * (single-column), `modernRender` (Phase 2, two-column; see its own doc
 * comment for the page-break strategy), `minimalRender` (Phase 3,
 * single-column editorial — see its own doc comment), `professionalRender`
 * (Phase 4, navy-header two-column — see its own doc comment),
 * `compactRender` (Phase 5, single-column with a horizontal footer band —
 * see its own doc comment), or `signatureRender` (Phase 6, single-column
 * editorial with an asymmetric two-zone header and a label:value detail
 * panel — see its own doc comment). Each is a separate implementation, the
 * same way each template has its own React component (classic-document.tsx /
 * modern-document.tsx / minimal-document.tsx / professional-document.tsx /
 * compact-document.tsx / signature-document.tsx) — see the Template
 * Foundation decision report for why that residual duplication is an
 * accepted trade-off rather than one shared layout engine. Dispatch is by
 * `id`, never by `layout` alone — Modern and Professional both use
 * `layout: 'sidebar-main'` (the same structural shape: full-width header,
 * then two columns) but have completely different renderers, so `layout`
 * can't be the discriminant. Minimal, Modern, Professional, Compact, and
 * Signature DO reuse a few of Classic's/each other's generic pagination
 * helpers (`ensureSpace`, `measureEntryHeight`, `modernDateColWidth`) where
 * the logic is genuinely template-agnostic — see each helper's doc
 * comment.
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
      if (template.id === 'modern') {
        this.modernRender(doc, content, template);
      } else if (template.id === 'minimal') {
        this.minimalRender(doc, content, template);
      } else if (template.id === 'professional') {
        this.professionalRender(doc, content, template);
      } else if (template.id === 'compact') {
        this.compactRender(doc, content, template);
      } else if (template.id === 'signature') {
        this.signatureRender(doc, content, template);
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

  // ── Minimal (Phase 3) ────────────────────────────────────────────────
  //
  // Single-column, editorial "quiet luxury" — see the module report for
  // the full design brief and MINIMAL_TEMPLATE's doc comment (template-
  // types.ts) for the palette/spacing rationale. Gets its personality
  // from typography/whitespace/proportion, not color or structure: no
  // sidebar, no tinted regions, no chips/bars/icons. Reuses the SAME
  // generic pagination primitives Classic already uses (`ensureSpace`,
  // `measureEntryHeight`) and Modern's date-column-width solver
  // (`modernDateColWidth`) rather than re-deriving fragile layout math a
  // third time — each of those helpers takes a `TemplateDefinition` and
  // doesn't hardcode which template it's serving, so sharing them across
  // templates is safe and doesn't touch Classic's or Modern's own
  // behavior.
  private minimalRender(doc: PDFKit.PDFDocument, content: CvContent, t: TemplateDefinition): void {
    const lm = t.margins.left;
    const pageW = doc.page.width - lm - t.margins.right;
    const { personalDetails: pd } = content;
    const candidateName = pd.fullName || 'CV';

    // ── Header — large name, understated title, two deliberately grouped
    // contact lines (factual details, then professional links) rather
    // than one long dumped line, then a single thin accent rule — the
    // template's ONE restrained accent use in the header. ───────────────
    const nameSize = this.minimalNameFontSize(doc, candidateName, pageW, t.typography.nameSize);
    doc
      .font('Heading')
      .fontSize(nameSize)
      .fillColor(t.colors.text)
      .text(candidateName, lm, doc.y, { width: pageW });

    if (pd.jobTitle) {
      doc.moveDown(0.35);
      doc
        .font('Body')
        .fontSize(t.typography.jobTitleSize)
        .fillColor(t.colors.muted)
        .text(pd.jobTitle, lm, doc.y, { width: pageW, characterSpacing: 0.2 });
    }

    doc.moveDown(0.9);
    this.minimalContactBlock(doc, pd, lm, pageW, t);

    doc.moveDown(1.1);
    const ruleY = doc.y;
    doc
      .moveTo(lm, ruleY)
      .lineTo(lm + 130, ruleY)
      .lineWidth(0.75)
      .strokeColor(t.colors.accent)
      .stroke();
    doc.moveDown(1.6);

    // ── Body — single column, full width, strong vertical rhythm driven
    // entirely by the template's own (deliberately generous) spacing
    // tokens — no sidebar, no column math. See minimalRenderBody's doc
    // comment for the borderline-pagination decision (V1.1). ────────────
    this.minimalRenderBody(doc, content, lm, pageW, t, candidateName);
    doc.fillColor(t.colors.text);
  }

  /**
   * V1.1 header-proportion fix (documented per the task's explicit
   * request — found via manual QA on an unusually long candidate name):
   * the fixed 32pt name size read as excessively large once a long name
   * wrapped to 3+ lines. Normal names (the overwhelming majority — e.g.
   * "Amelia Novak", "François Müller-Østergaard") are completely
   * unaffected, since they already fit in 1-2 lines at 32pt and this
   * loop exits immediately. Only a name that would actually produce 3+
   * lines at the base size steps down (in MINIMAL_NAME_STEP increments),
   * only as far as needed to reach 2 lines, and never below
   * MINIMAL_NAME_FLOOR_SIZE. An absurdly long name that still doesn't
   * fit in 2 lines even at the floor size is left at the floor — this is
   * a bounded adjustment, not a promise every name fits in 1-2 lines
   * regardless of length. Natural word-wrapping and the full name text
   * are always preserved; only the font size changes. */
  private minimalNameFontSize(
    doc: PDFKit.PDFDocument,
    name: string,
    pageW: number,
    baseSize: number,
  ): number {
    let size = baseSize;
    while (size > MINIMAL_NAME_FLOOR_SIZE) {
      doc.font('Heading').fontSize(size);
      const lines = Math.round(
        doc.heightOfString(name, { width: pageW }) / doc.currentLineHeight(),
      );
      if (lines <= 2) return size;
      size -= MINIMAL_NAME_STEP;
    }
    return MINIMAL_NAME_FLOOR_SIZE;
  }

  /**
   * V1.2 pagination policy (documented per the task's explicit request):
   * the V1.1 "avoid a tiny page-2 tail" fix over-corrected. Manual visual
   * QA found it pulling complete, already-fitting sections (e.g.
   * Education, Skills) off page 1 solely to make page 2 look more
   * substantial — leaving page 1 with a large block of genuinely usable
   * whitespace. That traded one visual problem (a sparse page 2) for a
   * worse one (an artificially unfinished-looking page 1).
   *
   * Reverted to natural, content-driven page utilization: sections
   * render in order, and each one lands wherever it actually fits —
   * governed entirely by minimalEnsureSpace's existing per-heading
   * (MINIMAL_HEADING_MIN_SPACE) and per-entry (measureEntryHeight-based)
   * safety checks, the same mechanism Classic and Modern already use for
   * their own page breaks. No whole-document lookahead, no page-2-
   * content-ratio target, no compact-spacing mode — page 1 always fills
   * with as much complete content as genuinely fits, never artificially
   * less. Font sizes, margins, and spacing are exactly the approved
   * values at all times; nothing here shrinks or compresses anything.
   *
   * V1.3 addition — a narrow orphan-final-section safeguard (see
   * minimalShouldKeepWithNext's doc comment for the exact rule). This is
   * NOT a return to V1.1's whole-document lookahead: it only ever
   * examines the last two sections in the document, and only ever moves
   * at most one small predecessor to keep a small final section company.
   * Every other section is completely unaffected and renders through the
   * plain sequential loop below exactly as in V1.2.
   */
  private minimalRenderBody(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    const order = content.sectionOrder.length > 0 ? content.sectionOrder : DEFAULT_SECTION_ORDER;
    const sections = order.filter((s) => this.minimalHasContent(content, s));
    if (!sections.length) return;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (section === undefined) continue;

      if (i === sections.length - 2) {
        const nextSection = sections[i + 1];
        if (
          nextSection !== undefined &&
          this.minimalShouldKeepWithNext(doc, content, section, nextSection, pageW, t)
        ) {
          doc.addPage();
          this.minimalContinuationHeader(doc, candidateName, lm, pageW, t);
          this.minimalSection(doc, content, section, lm, pageW, t, candidateName);
          this.minimalSection(doc, content, nextSection, lm, pageW, t, candidateName);
          return;
        }
      }

      this.minimalSection(doc, content, section, lm, pageW, t, candidateName);
    }
  }

  private minimalHasContent(content: CvContent, section: CvSection): boolean {
    switch (section) {
      case 'summary':
        return Boolean(content.summary);
      case 'workExperience':
        return content.workExperience.length > 0;
      case 'education':
        return content.education.length > 0;
      case 'skills':
        return content.skills.length > 0;
      case 'languages':
        return content.languages.length > 0;
      case 'certifications':
        return content.certifications.length > 0;
      default:
        return false;
    }
  }

  /**
   * V1.3 orphan-final-section safeguard: true only when ALL of the
   * following hold for the LAST TWO sections in the document (this is
   * never called for any other pair):
   *
   *  1. `section` (the second-to-last) itself fits in what's left of the
   *     current page, using the SAME gate minimalEnsureSpace already
   *     uses for every heading (MINIMAL_HEADING_MIN_SPACE, not raw
   *     measured content height — matching the real mechanism means
   *     this safeguard's predictions can never disagree with what the
   *     actual render does). If `section` doesn't clear that gate, it
   *     already moves to a new page on its own via the existing organic
   *     mechanism, and `nextSection` — landing right after it on a fresh
   *     page — is naturally grouped with it with no special handling
   *     needed here at all.
   *  2. Both `section` and `nextSection` are individually small
   *     (<= MINIMAL_SMALL_SECTION_MAX_HEIGHT, a fixed, modest, non-
   *     percentage bound — see its own doc comment). This is the
   *     guardrail against ever moving a large section like Experience or
   *     a multi-entry Education: measured height, not section identity,
   *     decides "small", but a real Experience/Education section with
   *     actual entries reliably measures well past this bound.
   *  3. After `section` renders (consuming its own measured height),
   *     `nextSection`'s own heading would NOT clear the same
   *     MINIMAL_HEADING_MIN_SPACE gate — i.e. `nextSection` would
   *     otherwise be orphaned alone at the top of a new page.
   *
   * When all three hold, the caller moves BOTH sections to a new page
   * together. This can never cascade to a third section (only the single
   * immediate predecessor of the true last section is ever considered)
   * and never fires at all for any section pair other than the final
   * two — the opposite of V1.1's whole-document, ratio-driven lookahead.
   */
  private minimalShouldKeepWithNext(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    nextSection: CvSection,
    pageW: number,
    t: TemplateDefinition,
  ): boolean {
    const spaceLeft = doc.page.height - t.margins.bottom - doc.y;
    if (MINIMAL_HEADING_MIN_SPACE > spaceLeft) {
      // `section` already breaks to a new page on its own — nothing for
      // this safeguard to do (see point 1 above).
      return false;
    }

    const sectionH = this.minimalMeasureSection(doc, content, section, pageW, t);
    if (sectionH > MINIMAL_SMALL_SECTION_MAX_HEIGHT) {
      return false;
    }
    const nextH = this.minimalMeasureSection(doc, content, nextSection, pageW, t);
    if (nextH > MINIMAL_SMALL_SECTION_MAX_HEIGHT) {
      return false;
    }

    const remainingAfterSection = spaceLeft - sectionH;
    return MINIMAL_HEADING_MIN_SPACE > remainingAfterSection;
  }

  /** Rough (deliberately approximate — a planning heuristic, not a
   *  pixel-perfect replica of the real render) height a fully-rendered
   *  section would consume at normal spacing. Reuses the SAME
   *  measurement helpers the real render's page-break safety checks use
   *  (measureEntryHeight, heightOfString) so it can never drift far from
   *  reality. Used ONLY by minimalShouldKeepWithNext's narrow orphan-
   *  final-section check — not a general-purpose whole-document planning
   *  pass, and never applied to more than the last two sections. */
  private minimalMeasureSection(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    pageW: number,
    t: TemplateDefinition,
  ): number {
    doc.font('Heading').fontSize(t.typography.headingSize);
    const headingOverhead = doc.currentLineHeight() * 1.5;
    doc.font('Body').fontSize(t.typography.bodySize);
    const bodyLineHeight = doc.currentLineHeight();

    switch (section) {
      case 'summary': {
        doc.font('Body').fontSize(t.typography.bodySize);
        const bodyH = doc.heightOfString(normalizeParagraph(content.summary ?? ''), {
          width: pageW,
          lineGap: t.spacing.lineGap,
        });
        return headingOverhead + bodyH + bodyLineHeight * 1.2;
      }
      case 'workExperience': {
        let h = headingOverhead;
        for (const e of content.workExperience) {
          const dateStr = formatDateRange(e.startDate, e.endDate, e.current);
          const dateGap = dateStr ? 10 : 0;
          const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
          const titleColW = pageW - dateColW - dateGap;
          const orgLine = e.company + (e.location ? ` · ${e.location}` : '');
          h += this.measureEntryHeight(
            doc,
            titleColW,
            pageW,
            e.title,
            orgLine,
            undefined,
            e.bullets,
            t,
          );
        }
        return h;
      }
      case 'education': {
        let h = headingOverhead;
        for (const e of content.education) {
          const dateStr = formatDateRange(e.startDate, e.endDate);
          const dateGap = dateStr ? 10 : 0;
          const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
          const degColW = pageW - dateColW - dateGap;
          const degreeText = e.field ? `${e.degree} — ${e.field}` : e.degree;
          const instLine = e.institution + (e.location ? ` · ${e.location}` : '');
          h += this.measureEntryHeight(doc, degColW, pageW, degreeText, instLine, e.grade, [], t);
        }
        return h;
      }
      case 'skills': {
        doc.font('Body').fontSize(t.typography.bodySize);
        const listText = content.skills
          .map((s) => (s.level ? `${s.name} · ${s.level}` : s.name))
          .join(MINIMAL_SEPARATOR);
        const bodyH = doc.heightOfString(listText, { width: pageW, lineGap: t.spacing.lineGap });
        return headingOverhead + bodyH + bodyLineHeight * 1.2;
      }
      case 'languages': {
        doc.font('Body').fontSize(t.typography.bodySize);
        const listText = content.languages
          .map((l) => (l.level ? `${l.name} (${l.level})` : l.name))
          .join(MINIMAL_SEPARATOR);
        const bodyH = doc.heightOfString(listText, { width: pageW, lineGap: t.spacing.lineGap });
        return headingOverhead + bodyH + bodyLineHeight * 1.2;
      }
      case 'certifications': {
        let h = headingOverhead;
        for (const c of content.certifications) {
          doc.font('Heading').fontSize(t.typography.bodySize - 0.5);
          const nameH = doc.heightOfString(c.name, { width: pageW });
          const meta = [c.issuer, c.date].filter(Boolean).join(' · ');
          doc.font('Body').fontSize(t.typography.metaSize);
          const metaH = meta ? doc.heightOfString(meta, { width: pageW }) : 0;
          h += nameH + metaH + doc.currentLineHeight() * 0.75;
        }
        return h;
      }
      default:
        return 0;
    }
  }

  /** Two deliberate contact groups — factual personal details on one
   *  line, professional links on the next — rather than one long dumped
   *  line (see the module report's contact-row brief; this also isolates
   *  long URLs onto their own line instead of crowding email/phone/
   *  location). Real clickable PDF links for LinkedIn/website with
   *  shortened on-page labels (shortenUrlLabel) — same full-URL-
   *  preserving approach as Modern's contact line. */
  private minimalContactBlock(
    doc: PDFKit.PDFDocument,
    pd: CvContent['personalDetails'],
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const personal: string[] = [];
    if (pd.email) personal.push(pd.email);
    if (pd.phone) personal.push(pd.phone);
    if (pd.location) personal.push(pd.location);

    const links: Array<{ text: string; url?: string }> = [];
    if (pd.linkedIn) {
      links.push({ text: shortenUrlLabel(pd.linkedIn), url: normalizeExternalUrl(pd.linkedIn) });
    }
    if (pd.website) {
      links.push({ text: shortenUrlLabel(pd.website), url: normalizeExternalUrl(pd.website) });
    }
    if (!personal.length && !links.length) return;

    doc.font('Body').fontSize(t.typography.metaSize).fillColor(t.colors.muted);

    if (personal.length) {
      doc.text(personal.join(MINIMAL_SEPARATOR), lm, doc.y, { width: pageW });
    }

    if (links.length) {
      if (personal.length) doc.moveDown(0.3);
      const y = doc.y;
      links.forEach((seg, i) => {
        const isFirst = i === 0;
        const isLast = i === links.length - 1;
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
        doc.text(isLast ? '' : MINIMAL_SEPARATOR, { continued: !isLast });
      });
    }

    doc.fillColor(t.colors.text);
  }

  /** Adds a page if `neededHeight` doesn't fit, drawing Minimal's own
   *  continuation-page header on every page this adds — see
   *  minimalContinuationHeader's doc comment for the page-2+ design
   *  decision (deliberately NOT a copy of Modern's). No column-width
   *  bookkeeping is needed here (unlike Modern) since Minimal is a single
   *  full-width column on every page. */
  private minimalEnsureSpace(
    doc: PDFKit.PDFDocument,
    t: TemplateDefinition,
    neededHeight: number,
    lm: number,
    pageW: number,
    candidateName: string,
  ): void {
    const spaceLeft = doc.page.height - t.margins.bottom - doc.y;
    const pageContentHeight = doc.page.height - t.margins.top - t.margins.bottom;
    if (neededHeight > spaceLeft && neededHeight <= pageContentHeight) {
      doc.addPage();
      this.minimalContinuationHeader(doc, candidateName, lm, pageW, t);
    }
  }

  /**
   * V1 page-2+ decision for Minimal (documented deliberately, not copied
   * from Modern — the task explicitly asked for a choice grounded in this
   * template's own identity):
   *
   * Modern's continuation header (bold Heading-weight name + a 0.75pt
   * rule right at the top margin) reads as confident and structural —
   * appropriate there because Modern's whole page-1 identity already uses
   * bold colored rules and a tinted sidebar. Reusing that treatment
   * verbatim on Minimal would contradict Minimal's entire premise: quiet,
   * typography-and-whitespace-led restraint. So Minimal's continuation
   * header is instead a small, muted, letter-spaced candidate-name label
   * set in the regular (non-bold) body font — closer to a running head in
   * a printed editorial document than a UI element — followed by a
   * hairline rule at HALF Modern's weight (0.5pt vs 0.75pt) in the
   * neutral rule color, never the accent color, so it reads as quiet
   * structure rather than a design flourish. More whitespace follows it
   * than Modern's equivalent, consistent with Minimal's generous rhythm
   * elsewhere. The one deliberate exception to "never render all-caps"
   * elsewhere in this template: a small tracked running head in caps is a
   * long-established, genuinely restrained editorial convention (chapter
   * headers in printed books), used here exactly once, only on
   * continuation pages.
   *
   * characterSpacing is deliberately modest (0.8, matching Classic's own
   * tracked-label precedent) rather than the more dramatic value first
   * tried — PDF text extraction verification (see the module's test
   * suite) caught that a large characterSpacing value makes PDFKit emit
   * visible space characters between individual letters in the PDF's
   * text layer ("F R A N Ç O I S" instead of "FRANÇOIS"), degrading
   * extraction for this label. 0.8 stays refined-looking without
   * triggering that.
   */
  private minimalContinuationHeader(
    doc: PDFKit.PDFDocument,
    candidateName: string,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    doc
      .font('Body')
      .fontSize(t.typography.metaSize - 0.5)
      .fillColor(t.colors.muted)
      .text(candidateName.toUpperCase(), lm, doc.y, { width: pageW, characterSpacing: 0.8 });
    const ruleY = doc.y + 7;
    doc
      .moveTo(lm, ruleY)
      .lineTo(lm + pageW, ruleY)
      .lineWidth(0.5)
      .strokeColor(t.colors.rule)
      .stroke();
    doc.y = ruleY + 22;
    doc.fillColor(t.colors.text);
  }

  /** Title-case, refined letter-spacing, NO rule and NO uppercase — the
   *  section break itself is communicated by generous whitespace
   *  (spacing.sectionGap, applied by the caller via minimalEnsureSpace's
   *  page-break math and moveDown calls between sections) rather than a
   *  drawn line or color. Deliberately distinct from Classic's rule-above
   *  uppercase label and Modern's colored rule-below label. */
  private minimalHeading(
    doc: PDFKit.PDFDocument,
    label: string,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    doc
      .font('Heading')
      .fontSize(t.typography.headingSize)
      .fillColor(t.colors.heading)
      .text(label, lm, doc.y, { width: pageW, characterSpacing: 0.3 });
    doc.moveDown(0.5);
    doc.fillColor(t.colors.text);
  }

  private minimalSection(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    switch (section) {
      case 'summary':
        if (!content.summary) return;
        this.minimalEnsureSpace(doc, t, MINIMAL_HEADING_MIN_SPACE, lm, pageW, candidateName);
        this.minimalHeading(doc, 'Summary', lm, pageW, t);
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text(normalizeParagraph(content.summary), lm, doc.y, {
            width: pageW,
            lineGap: t.spacing.lineGap,
          });
        doc.moveDown(1.2);
        break;

      case 'workExperience':
        if (!content.workExperience.length) return;
        this.minimalEnsureSpace(doc, t, MINIMAL_HEADING_MIN_SPACE, lm, pageW, candidateName);
        this.minimalHeading(doc, 'Experience', lm, pageW, t);
        for (const e of content.workExperience) {
          this.minimalWorkEntry(doc, e, lm, pageW, t, candidateName);
        }
        break;

      case 'education':
        if (!content.education.length) return;
        this.minimalEnsureSpace(doc, t, MINIMAL_HEADING_MIN_SPACE, lm, pageW, candidateName);
        this.minimalHeading(doc, 'Education', lm, pageW, t);
        for (const e of content.education) {
          this.minimalEducationEntry(doc, e, lm, pageW, t, candidateName);
        }
        break;

      case 'skills':
        // Plain typographic list, not Modern's bordered chips — every
        // skill is preserved completely (ordinary wrapped text, never
        // truncated) and reads as elegant rather than tag-like.
        if (!content.skills.length) return;
        this.minimalEnsureSpace(doc, t, MINIMAL_HEADING_MIN_SPACE, lm, pageW, candidateName);
        this.minimalHeading(doc, 'Skills', lm, pageW, t);
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text(
            content.skills
              .map((s) => (s.level ? `${s.name} · ${s.level}` : s.name))
              .join(MINIMAL_SEPARATOR),
            lm,
            doc.y,
            { width: pageW, lineGap: t.spacing.lineGap },
          );
        doc.moveDown(1.2);
        break;

      case 'languages':
        if (!content.languages.length) return;
        this.minimalEnsureSpace(doc, t, MINIMAL_HEADING_MIN_SPACE, lm, pageW, candidateName);
        this.minimalHeading(doc, 'Languages', lm, pageW, t);
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text(
            content.languages
              .map((l) => (l.level ? `${l.name} (${l.level})` : l.name))
              .join(MINIMAL_SEPARATOR),
            lm,
            doc.y,
            { width: pageW, lineGap: t.spacing.lineGap },
          );
        doc.moveDown(1.2);
        break;

      case 'certifications':
        if (!content.certifications.length) return;
        this.minimalEnsureSpace(doc, t, MINIMAL_HEADING_MIN_SPACE, lm, pageW, candidateName);
        this.minimalHeading(doc, 'Certifications', lm, pageW, t);
        for (const c of content.certifications) {
          this.minimalCertification(doc, c, lm, pageW, t, candidateName);
        }
        break;

      default:
        break;
    }
  }

  private minimalCertification(
    doc: PDFKit.PDFDocument,
    c: CvCertificationEntry,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    const meta = [c.issuer, c.date].filter(Boolean).join(' · ');
    doc.font('Heading').fontSize(t.typography.bodySize - 0.5);
    const nameH = doc.heightOfString(c.name, { width: pageW });
    const metaH = meta
      ? doc.font('Body').fontSize(t.typography.metaSize).heightOfString(meta, { width: pageW })
      : 0;
    this.minimalEnsureSpace(doc, t, nameH + metaH + 24, lm, pageW, candidateName);

    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.5)
      .fillColor(t.colors.text)
      .text(c.name, lm, doc.y, { width: pageW });
    if (meta) {
      doc.moveDown(0.05);
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(meta, lm, doc.y, { width: pageW });
    }
    doc.moveDown(0.75);
    doc.fillColor(t.colors.text);
  }

  private minimalWorkEntry(
    doc: PDFKit.PDFDocument,
    entry: CvWorkEntry,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate, entry.current);
    const dateGap = dateStr ? 10 : 0;
    const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
    const titleColW = pageW - dateColW - dateGap;
    const orgLine = entry.company + (entry.location ? ` · ${entry.location}` : '');

    this.minimalEnsureSpace(
      doc,
      t,
      this.measureEntryHeight(
        doc,
        titleColW,
        pageW,
        entry.title,
        orgLine,
        undefined,
        entry.bullets,
        t,
      ),
      lm,
      pageW,
      candidateName,
    );

    const rowY = doc.y;
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize)
      .fillColor(t.colors.text)
      .text(entry.title, lm, rowY, { width: titleColW });
    const afterTitle = doc.y;

    if (dateStr) {
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(dateStr, lm + pageW - dateColW, rowY, { width: dateColW, align: 'right' });
      if (doc.y < afterTitle) doc.y = afterTitle;
    }

    doc.moveDown(0.12);
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.5)
      .fillColor(t.colors.accent)
      .text(orgLine, lm, doc.y, { width: pageW });

    const bullets = entry.bullets.filter((b) => b.trim());
    if (bullets.length) {
      doc.moveDown(0.4);
      bullets.forEach((b, i) => {
        if (i > 0) doc.y += t.spacing.bulletGap;
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          // An en dash, not Modern's bullet dot — a quieter, more
          // editorial marker consistent with Minimal's identity.
          .text(`–  ${b}`, lm + 4, doc.y, { width: pageW - 4, lineGap: t.spacing.lineGap - 1 });
      });
    }

    doc.moveDown(0.9);
    doc.fillColor(t.colors.text);
  }

  private minimalEducationEntry(
    doc: PDFKit.PDFDocument,
    entry: CvEducationEntry,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate);
    const dateGap = dateStr ? 10 : 0;
    const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
    const degColW = pageW - dateColW - dateGap;
    const degreeText = entry.field ? `${entry.degree} — ${entry.field}` : entry.degree;
    const instLine = entry.institution + (entry.location ? ` · ${entry.location}` : '');

    this.minimalEnsureSpace(
      doc,
      t,
      this.measureEntryHeight(doc, degColW, pageW, degreeText, instLine, entry.grade, [], t),
      lm,
      pageW,
      candidateName,
    );

    const rowY = doc.y;
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize)
      .fillColor(t.colors.text)
      .text(degreeText, lm, rowY, { width: degColW });
    const afterDeg = doc.y;

    if (dateStr) {
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(dateStr, lm + pageW - dateColW, rowY, { width: dateColW, align: 'right' });
      if (doc.y < afterDeg) doc.y = afterDeg;
    }

    doc.moveDown(0.12);
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.5)
      .fillColor(t.colors.accent)
      .text(instLine, lm, doc.y, { width: pageW });

    if (entry.grade) {
      // Neutral "Grade:" label — same convention as Classic/Modern (see
      // modernEducationEntry's doc comment): the schema's `grade` field
      // has no declared scale, so this never guesses GPA/percentage/etc.
      doc.moveDown(0.08);
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(`Grade: ${entry.grade}`, lm, doc.y, { width: pageW });
    }

    doc.moveDown(0.9);
    doc.fillColor(t.colors.text);
  }

  // ── Professional (Phase 4) ──────────────────────────────────────────
  //
  // Premium corporate: a full-bleed navy header band (name in white,
  // title/contact in softened white — see PROFESSIONAL_TEMPLATE's doc
  // comment in template-types.ts for the full design brief), then a
  // white body split into a dominant main column (Profile/Experience/
  // Education, ~65%) and a narrower secondary column (Expertise/
  // Languages/Certifications, ~35%) separated by a thin rule — never a
  // second tinted region (that's Modern's signature, not Professional's).
  //
  // Structurally this reuses the SAME two-cursor, secondary-column-once-
  // on-page-1 convention Modern established (PDFKit has no native multi-
  // column page flow) and the SAME narrow orphan-final-section safeguard
  // proven on Minimal (professionalShouldKeepWithNext — only ever
  // examines the main column's own last two sections, never a whole-
  // document lookahead; see minimalShouldKeepWithNext's doc comment for
  // why that shape of rule can't recreate a V1.1-style over-correction).
  private professionalRender(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    t: TemplateDefinition,
  ): void {
    const lm = t.margins.left;
    const pageW = doc.page.width - lm - t.margins.right;
    const { personalDetails: pd } = content;
    const candidateName = pd.fullName || 'CV';
    const headerBg = t.colors.headerBackground ?? t.colors.text;
    const headerText = t.colors.headerText ?? '#FFFFFF';
    const headerMuted = t.colors.headerMutedText ?? t.colors.muted;

    const nameSize = this.professionalNameFontSize(
      doc,
      candidateName,
      pageW,
      t.typography.nameSize,
    );

    // ── Measure the header content FIRST, so the navy band can be drawn
    // BEHIND the text at exactly the right height — PDFKit has no
    // z-index, so a rect drawn after the text would paint over it. ─────
    const headerPadTop = 28;
    const headerPadBottom = 24;
    const gapAfterName = 6;
    const gapAfterTitle = 10;

    doc.font('Heading').fontSize(nameSize);
    const nameH = doc.heightOfString(candidateName, { width: pageW });

    let titleH = 0;
    if (pd.jobTitle) {
      doc.font('Body').fontSize(t.typography.jobTitleSize);
      titleH = doc.heightOfString(pd.jobTitle, { width: pageW });
    }

    const personal: string[] = [];
    if (pd.email) personal.push(pd.email);
    if (pd.phone) personal.push(pd.phone);
    if (pd.location) personal.push(pd.location);
    const links: Array<{ text: string; url?: string }> = [];
    if (pd.linkedIn) {
      links.push({ text: shortenUrlLabel(pd.linkedIn), url: normalizeExternalUrl(pd.linkedIn) });
    }
    if (pd.website) {
      links.push({ text: shortenUrlLabel(pd.website), url: normalizeExternalUrl(pd.website) });
    }

    doc.font('Body').fontSize(t.typography.metaSize);
    const personalH = personal.length
      ? doc.heightOfString(personal.join(PROFESSIONAL_SEPARATOR), { width: pageW })
      : 0;
    const linksH = links.length
      ? doc.heightOfString(links.map((l) => l.text).join(PROFESSIONAL_SEPARATOR), { width: pageW })
      : 0;
    const contactGap = personalH && linksH ? 3 : 0;
    const contactH = personalH + contactGap + linksH;

    const bandHeight =
      headerPadTop +
      nameH +
      (titleH > 0 ? gapAfterName + titleH : 0) +
      (contactH > 0 ? gapAfterTitle + contactH : 0) +
      headerPadBottom;

    doc.rect(0, 0, doc.page.width, bandHeight).fillColor(headerBg).fill();

    // ── Header text, drawn on top of the band ───────────────────────────
    doc.y = headerPadTop;
    doc
      .font('Heading')
      .fontSize(nameSize)
      .fillColor(headerText)
      .text(candidateName, lm, doc.y, { width: pageW });

    if (titleH > 0) {
      doc.y += gapAfterName;
      doc
        .font('Body')
        .fontSize(t.typography.jobTitleSize)
        .fillColor(headerMuted)
        .text(pd.jobTitle as string, lm, doc.y, { width: pageW, characterSpacing: 0.2 });
    }

    if (contactH > 0) {
      doc.y += gapAfterTitle;
      this.professionalContactBlock(doc, personal, links, lm, pageW, t, headerMuted);
    }

    // Snap to the precomputed band bottom regardless of minor rounding
    // drift between the measurement pass and the real render, so the
    // band edge and the body's start line up exactly.
    doc.y = bandHeight;

    // ── Body — dominant main column + narrower secondary column ────────
    doc.y = bandHeight + t.spacing.sectionGap + 6;
    const contentTop = doc.y;
    const gap = t.spacing.sectionGap;
    const secondaryRatio = t.sidebarWidthRatio ?? 0.35;
    const secondaryW = pageW * secondaryRatio - gap / 2;
    const mainW = pageW - secondaryW - gap;
    const mainX = lm;
    const secondaryX = lm + mainW + gap;

    const order = content.sectionOrder.length > 0 ? content.sectionOrder : DEFAULT_SECTION_ORDER;
    const secondarySet = new Set(t.sidebarSections ?? []);
    const secondarySections = order.filter((s) => secondarySet.has(s));

    // Secondary column — own local cursor, always page 1 only (same
    // convention as Modern's sidebar, for the same reason).
    doc.y = contentTop;
    for (const section of secondarySections) {
      this.professionalSecondarySection(doc, content, section, secondaryX, secondaryW, t);
    }
    const secondaryBottom = doc.y;

    // Thin vertical divider — NOT a tinted background. Professional
    // deliberately does not repeat Modern's full-height-tint mechanic for
    // its secondary column (see this method's doc comment) — spacing,
    // typography, and this single hairline rule do the differentiation.
    if (secondaryBottom > contentTop) {
      const ruleX = secondaryX - gap / 2;
      doc
        .moveTo(ruleX, contentTop)
        .lineTo(ruleX, secondaryBottom)
        .lineWidth(0.75)
        .strokeColor(t.colors.rule)
        .stroke();
    }

    // Main column — independent cursor, starts level with the secondary
    // column.
    doc.y = contentTop;
    const column: ProfessionalColumn = {
      x: mainX,
      width: mainW,
      isFirstPage: true,
      candidateName,
    };
    this.professionalRenderMainColumn(doc, content, column, lm, pageW, t);
    doc.fillColor(t.colors.text);
  }

  /**
   * Adaptive name-size treatment — same technique proven on Minimal (see
   * minimalNameFontSize's doc comment for the full rationale), re-derived
   * here with Professional's own base/floor/step rather than calling
   * Minimal's private method: normal names (the overwhelming majority)
   * are completely unaffected; only a name that would actually wrap to
   * 3+ lines at the base size steps down, only as far as needed to reach
   * 2 lines, never below PROFESSIONAL_NAME_FLOOR_SIZE. Natural word-
   * wrapping and the full name text are always preserved.
   */
  private professionalNameFontSize(
    doc: PDFKit.PDFDocument,
    name: string,
    pageW: number,
    baseSize: number,
  ): number {
    let size = baseSize;
    while (size > PROFESSIONAL_NAME_FLOOR_SIZE) {
      doc.font('Heading').fontSize(size);
      const lines = Math.round(
        doc.heightOfString(name, { width: pageW }) / doc.currentLineHeight(),
      );
      if (lines <= 2) return size;
      size -= PROFESSIONAL_NAME_STEP;
    }
    return PROFESSIONAL_NAME_FLOOR_SIZE;
  }

  /** Two deliberate contact groups on the navy band — factual personal
   *  details on one line, professional links on the next (same proven
   *  approach as Minimal/Modern's contact lines) — isolates long URLs
   *  onto their own line instead of crowding email/phone/location. Real
   *  clickable PDF links for LinkedIn/website with shortened on-page
   *  labels (shortenUrlLabel); the full untruncated URL is always the
   *  actual link destination. */
  private professionalContactBlock(
    doc: PDFKit.PDFDocument,
    personal: string[],
    links: Array<{ text: string; url?: string }>,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    textColor: string,
  ): void {
    doc.font('Body').fontSize(t.typography.metaSize).fillColor(textColor);

    if (personal.length) {
      doc.text(personal.join(PROFESSIONAL_SEPARATOR), lm, doc.y, { width: pageW });
    }

    if (links.length) {
      if (personal.length) doc.moveDown(0.3);
      const y = doc.y;
      links.forEach((seg, i) => {
        const isFirst = i === 0;
        const isLast = i === links.length - 1;
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
        doc.text(isLast ? '' : PROFESSIONAL_SEPARATOR, { continued: !isLast });
      });
    }
  }

  /** Adds a page if `neededHeight` doesn't fit, widening `column` to the
   *  full page width on the first such break (there is no secondary
   *  column to run alongside on a continuation page — same convention as
   *  Modern's modernEnsureSpace) and drawing Professional's own
   *  continuation header on every page this adds. */
  private professionalMainEnsureSpace(
    doc: PDFKit.PDFDocument,
    t: TemplateDefinition,
    neededHeight: number,
    column: ProfessionalColumn,
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
      this.professionalContinuationHeader(doc, column.candidateName, lm, pageW, t);
    }
  }

  /**
   * Professional's own continuation-page treatment (designed
   * specifically for Professional, not copied from Minimal or Modern —
   * documented per the task's explicit request): a small NAVY tracked
   * candidate-name label, semi-bold, followed by a SHORT navy rule (not
   * full page width) — a restrained echo of the header band's identity
   * (navy, confident) without repeating the enormous full band, which
   * would look like overflow debris rather than a considered choice.
   * This is deliberately more assertive than Minimal's continuation
   * header (muted gray, full-width hairline) since Professional's whole
   * identity is confident corporate, not quiet restraint — but still
   * far short of redrawing the full navy band, which would be exactly
   * the "unnecessarily repeat the enormous full header" the brief asks
   * to avoid. characterSpacing is kept at 0.6 (below the 0.8+ threshold
   * found, during Minimal's own text-extraction verification, to make
   * PDFKit emit literal space characters between letters at high
   * tracking values).
   */
  private professionalContinuationHeader(
    doc: PDFKit.PDFDocument,
    candidateName: string,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    doc
      .font('Heading')
      .fontSize(t.typography.metaSize + 1)
      .fillColor(t.colors.heading)
      .text(candidateName.toUpperCase(), lm, doc.y, { width: pageW, characterSpacing: 0.6 });
    const ruleY = doc.y + 6;
    doc
      .moveTo(lm, ruleY)
      .lineTo(lm + 42, ruleY)
      .lineWidth(1.5)
      .strokeColor(t.colors.accent)
      .stroke();
    doc.y = ruleY + 18;
    doc.fillColor(t.colors.text);
  }

  /** Uppercase navy heading with a short navy rule below — see
   *  PROFESSIONAL_TEMPLATE's headingTreatment doc comment
   *  ('navy-caps-rule') for why this is deliberately distinct from every
   *  other template's heading treatment. */
  private professionalHeading(
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
      .text(label.toUpperCase(), x, doc.y, { width, characterSpacing: 0.6 });
    const ruleY = doc.y + 4;
    doc
      .moveTo(x, ruleY)
      .lineTo(x + 26, ruleY)
      .lineWidth(2)
      .strokeColor(t.colors.accent)
      .stroke();
    doc.y = ruleY + 8;
    doc.fillColor(t.colors.text);
  }

  /**
   * V1 orphan-final-section safeguard for Professional's main column —
   * same narrow rule proven on Minimal (see minimalShouldKeepWithNext's
   * doc comment for the full reasoning): only ever examines the LAST TWO
   * sections of the main column (at most Profile/Experience/Education,
   * so in practice this only ever matters for a 2-3-section main
   * column), never a whole-document lookahead, never moves a section
   * larger than PROFESSIONAL_SMALL_SECTION_MAX_HEIGHT.
   */
  private professionalRenderMainColumn(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    column: ProfessionalColumn,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const order = content.sectionOrder.length > 0 ? content.sectionOrder : DEFAULT_SECTION_ORDER;
    const secondarySet = new Set(t.sidebarSections ?? []);
    const sections = order.filter(
      (s) => !secondarySet.has(s) && this.professionalHasContent(content, s),
    );
    if (!sections.length) return;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (section === undefined) continue;

      if (i === sections.length - 2) {
        const nextSection = sections[i + 1];
        if (
          nextSection !== undefined &&
          this.professionalShouldKeepWithNext(doc, content, section, nextSection, column.width, t)
        ) {
          doc.addPage();
          if (column.isFirstPage) {
            column.x = lm;
            column.width = pageW;
            column.isFirstPage = false;
          }
          this.professionalContinuationHeader(doc, column.candidateName, lm, pageW, t);
          this.professionalMainSection(doc, content, section, column, lm, pageW, t);
          this.professionalMainSection(doc, content, nextSection, column, lm, pageW, t);
          return;
        }
      }

      this.professionalMainSection(doc, content, section, column, lm, pageW, t);
    }
  }

  private professionalHasContent(content: CvContent, section: CvSection): boolean {
    switch (section) {
      case 'summary':
        return Boolean(content.summary);
      case 'workExperience':
        return content.workExperience.length > 0;
      case 'education':
        return content.education.length > 0;
      default:
        return false;
    }
  }

  /** Same measurement approach as minimalMeasureSection — a planning
   *  heuristic reusing measureEntryHeight/heightOfString, used ONLY by
   *  professionalShouldKeepWithNext's narrow orphan-final-section check. */
  private professionalMeasureSection(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    pageW: number,
    t: TemplateDefinition,
  ): number {
    doc.font('Heading').fontSize(t.typography.headingSize);
    const headingOverhead = doc.currentLineHeight() * 1.6;
    doc.font('Body').fontSize(t.typography.bodySize);
    const bodyLineHeight = doc.currentLineHeight();

    switch (section) {
      case 'summary': {
        doc.font('Body').fontSize(t.typography.bodySize);
        const bodyH = doc.heightOfString(normalizeParagraph(content.summary ?? ''), {
          width: pageW,
          lineGap: t.spacing.lineGap,
        });
        return headingOverhead + bodyH + bodyLineHeight * 1.1;
      }
      case 'workExperience': {
        let h = headingOverhead;
        for (const e of content.workExperience) {
          const dateStr = formatDateRange(e.startDate, e.endDate, e.current);
          const dateGap = dateStr ? 10 : 0;
          const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
          const titleColW = pageW - dateColW - dateGap;
          const orgLine = e.company + (e.location ? ` · ${e.location}` : '');
          h += this.measureEntryHeight(
            doc,
            titleColW,
            pageW,
            e.title,
            orgLine,
            undefined,
            e.bullets,
            t,
          );
        }
        return h;
      }
      case 'education': {
        let h = headingOverhead;
        for (const e of content.education) {
          const dateStr = formatDateRange(e.startDate, e.endDate);
          const dateGap = dateStr ? 10 : 0;
          const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
          const degColW = pageW - dateColW - dateGap;
          const degreeText = e.field ? `${e.degree} — ${e.field}` : e.degree;
          const instLine = e.institution + (e.location ? ` · ${e.location}` : '');
          h += this.measureEntryHeight(doc, degColW, pageW, degreeText, instLine, e.grade, [], t);
        }
        return h;
      }
      default:
        return 0;
    }
  }

  private professionalShouldKeepWithNext(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    nextSection: CvSection,
    pageW: number,
    t: TemplateDefinition,
  ): boolean {
    const spaceLeft = doc.page.height - t.margins.bottom - doc.y;
    if (PROFESSIONAL_HEADING_MIN_SPACE > spaceLeft) {
      return false;
    }

    const sectionH = this.professionalMeasureSection(doc, content, section, pageW, t);
    if (sectionH > PROFESSIONAL_SMALL_SECTION_MAX_HEIGHT) {
      return false;
    }
    const nextH = this.professionalMeasureSection(doc, content, nextSection, pageW, t);
    if (nextH > PROFESSIONAL_SMALL_SECTION_MAX_HEIGHT) {
      return false;
    }

    const remainingAfterSection = spaceLeft - sectionH;
    return PROFESSIONAL_HEADING_MIN_SPACE > remainingAfterSection;
  }

  private professionalMainSection(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    column: ProfessionalColumn,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    switch (section) {
      case 'summary':
        if (!content.summary) return;
        this.professionalMainEnsureSpace(doc, t, PROFESSIONAL_HEADING_MIN_SPACE, column, lm, pageW);
        this.professionalHeading(doc, 'Profile', column.x, column.width, t);
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text(normalizeParagraph(content.summary), column.x, doc.y, {
            width: column.width,
            lineGap: t.spacing.lineGap,
          });
        doc.moveDown(1.1);
        break;

      case 'workExperience':
        if (!content.workExperience.length) return;
        this.professionalMainEnsureSpace(doc, t, PROFESSIONAL_HEADING_MIN_SPACE, column, lm, pageW);
        this.professionalHeading(doc, 'Experience', column.x, column.width, t);
        for (const e of content.workExperience) {
          this.professionalWorkEntry(doc, e, column, lm, pageW, t);
        }
        break;

      case 'education':
        if (!content.education.length) return;
        this.professionalMainEnsureSpace(doc, t, PROFESSIONAL_HEADING_MIN_SPACE, column, lm, pageW);
        this.professionalHeading(doc, 'Education', column.x, column.width, t);
        for (const e of content.education) {
          this.professionalEducationEntry(doc, e, column, lm, pageW, t);
        }
        break;

      default:
        break;
    }
  }

  private professionalWorkEntry(
    doc: PDFKit.PDFDocument,
    entry: CvWorkEntry,
    column: ProfessionalColumn,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate, entry.current);
    const dateGap = dateStr ? 10 : 0;
    const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, column.width) : 0;
    const titleColW = column.width - dateColW - dateGap;
    const orgLine = entry.company + (entry.location ? ` · ${entry.location}` : '');

    this.professionalMainEnsureSpace(
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
      .text(entry.title, column.x, rowY, { width: titleColW });
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

    doc.moveDown(0.1);
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.3)
      .fillColor(t.colors.accent)
      .text(orgLine, column.x, doc.y, { width: column.width });

    const bullets = entry.bullets.filter((b) => b.trim());
    if (bullets.length) {
      doc.moveDown(0.35);
      bullets.forEach((b, i) => {
        if (i > 0) doc.y += t.spacing.bulletGap;
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text(`•  ${b}`, column.x + 4, doc.y, {
            width: column.width - 4,
            lineGap: t.spacing.lineGap - 1,
          });
      });
    }

    doc.moveDown(0.75);
    doc.fillColor(t.colors.text);
  }

  private professionalEducationEntry(
    doc: PDFKit.PDFDocument,
    entry: CvEducationEntry,
    column: ProfessionalColumn,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate);
    const dateGap = dateStr ? 10 : 0;
    const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, column.width) : 0;
    const degColW = column.width - dateColW - dateGap;
    const degreeText = entry.field ? `${entry.degree} — ${entry.field}` : entry.degree;
    const instLine = entry.institution + (entry.location ? ` · ${entry.location}` : '');

    this.professionalMainEnsureSpace(
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
      .text(degreeText, column.x, rowY, { width: degColW });
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

    doc.moveDown(0.1);
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.3)
      .fillColor(t.colors.accent)
      .text(instLine, column.x, doc.y, { width: column.width });

    if (entry.grade) {
      // Neutral "Grade:" label — same convention as every other template
      // (see modernEducationEntry's doc comment): the schema's `grade`
      // field has no declared scale, so this never guesses GPA/
      // percentage/etc.
      doc.moveDown(0.08);
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(`Grade: ${entry.grade}`, column.x, doc.y, { width: column.width });
    }

    doc.moveDown(0.75);
    doc.fillColor(t.colors.text);
  }

  private professionalSecondarySection(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    x: number,
    width: number,
    t: TemplateDefinition,
  ): void {
    switch (section) {
      case 'skills':
        // A vertical list, not Modern's chips — every skill is preserved
        // completely (ordinary wrapped text, never truncated); no
        // proficiency indicator, since CvSkillEntry.level is free text,
        // not a rating.
        if (!content.skills.length) return;
        this.professionalHeading(doc, 'Expertise', x, width, t);
        for (const s of content.skills) {
          doc
            .font('Heading')
            .fontSize(t.typography.bodySize - 0.5)
            .fillColor(t.colors.text)
            .text(s.name, x, doc.y, { width, continued: Boolean(s.level) });
          if (s.level) {
            doc
              .font('Body')
              .fontSize(t.typography.metaSize)
              .fillColor(t.colors.muted)
              .text(` · ${s.level}`, { continued: false });
          }
          doc.moveDown(0.3);
        }
        doc.moveDown(0.85);
        break;

      case 'languages':
        if (!content.languages.length) return;
        this.professionalHeading(doc, 'Languages', x, width, t);
        for (const l of content.languages) {
          doc
            .font('Heading')
            .fontSize(t.typography.bodySize - 0.5)
            .fillColor(t.colors.text)
            .text(l.name, x, doc.y, { width, continued: Boolean(l.level) });
          if (l.level) {
            doc
              .font('Body')
              .fontSize(t.typography.metaSize)
              .fillColor(t.colors.muted)
              .text(`  —  ${l.level}`, { continued: false });
          }
          doc.moveDown(0.3);
        }
        doc.moveDown(0.85);
        break;

      case 'certifications':
        if (!content.certifications.length) return;
        this.professionalHeading(doc, 'Certifications', x, width, t);
        for (const c of content.certifications) {
          this.professionalCertification(doc, c, x, width, t);
        }
        break;

      default:
        break;
    }
    doc.fillColor(t.colors.text);
  }

  private professionalCertification(
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

  // ── Compact (Phase 5) ────────────────────────────────────────────────
  //
  // Single column throughout — no persistent side column, so unlike
  // Modern/Professional this never needs a mutable "widen after page
  // break" column object; `lm`/`pageW` are passed straight through, the
  // same simple shape Minimal uses. Its one structural signature: Skills/
  // Languages/Certifications render as ONE horizontal footer band
  // (compactRenderSecondaryBand) instead of three stacked sections —
  // modeled in the main content flow as a single atomic
  // CompactFlowItem alongside Summary/Experience/Education, so the SAME
  // narrow orphan-final-section safeguard proven on Minimal/Professional
  // (compactShouldKeepWithNext) can treat "the whole band" as one
  // candidate to keep with its predecessor, exactly like any other
  // section — no separate pagination mechanism was invented for it.
  private compactRender(doc: PDFKit.PDFDocument, content: CvContent, t: TemplateDefinition): void {
    const lm = t.margins.left;
    const pageW = doc.page.width - lm - t.margins.right;
    const { personalDetails: pd } = content;
    const candidateName = pd.fullName || 'CV';

    const nameSize = this.compactNameFontSize(doc, candidateName, pageW, t.typography.nameSize);
    doc
      .font('Heading')
      .fontSize(nameSize)
      .fillColor(t.colors.text)
      .text(candidateName, lm, doc.y, { width: pageW });

    if (pd.jobTitle) {
      doc.moveDown(0.2);
      doc
        .font('Body')
        .fontSize(t.typography.jobTitleSize)
        .fillColor(t.colors.muted)
        .text(pd.jobTitle, lm, doc.y, { width: pageW });
    }

    doc.moveDown(0.35);
    this.compactContactLine(doc, pd, lm, pageW, t);

    doc.moveDown(0.5);
    const ruleY = doc.y;
    doc
      .moveTo(lm, ruleY)
      .lineTo(lm + 30, ruleY)
      .lineWidth(1.5)
      .strokeColor(t.colors.accent)
      .stroke();
    doc.moveDown(0.9);

    this.compactRenderBody(doc, content, lm, pageW, t, candidateName);
    doc.fillColor(t.colors.text);
  }

  /** Adaptive name-size treatment — same technique proven on Minimal/
   *  Professional (see their own doc comments), re-derived here with
   *  Compact's own (smaller) base/floor rather than calling either
   *  private method. Normal names are unaffected; only a name that would
   *  wrap to 3+ lines at the base size steps down, only as far as needed
   *  to reach 2 lines, never below COMPACT_NAME_FLOOR_SIZE. */
  private compactNameFontSize(
    doc: PDFKit.PDFDocument,
    name: string,
    pageW: number,
    baseSize: number,
  ): number {
    let size = baseSize;
    while (size > COMPACT_NAME_FLOOR_SIZE) {
      doc.font('Heading').fontSize(size);
      const lines = Math.round(
        doc.heightOfString(name, { width: pageW }) / doc.currentLineHeight(),
      );
      if (lines <= 2) return size;
      size -= COMPACT_NAME_STEP;
    }
    return COMPACT_NAME_FLOOR_SIZE;
  }

  /** ONE efficient wrapped contact line — not Minimal/Professional's
   *  deliberate two-line grouping — "arranged efficiently... wrapping
   *  safely" per the module report's header brief. Real clickable PDF
   *  links for LinkedIn/website with shortened on-page labels
   *  (shortenUrlLabel); the full untruncated URL is always the actual
   *  link destination. */
  private compactContactLine(
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
      doc.text(isLast ? '' : COMPACT_SEPARATOR, { continued: !isLast });
    });
    // doc.y after a chain of `continued: true` calls is not reliably the
    // line's actual bottom (observed during visual QA: a later element
    // drawn via `doc.y` ended up overlapping this line instead of sitting
    // below it). Pin doc.y deterministically from a plain-text height
    // measurement of the equivalent joined line instead of trusting
    // continued-mode's own cursor tracking — also correctly accounts for
    // this line wrapping to 2+ lines for long contact details.
    const joined = segments.map((s) => s.text).join(COMPACT_SEPARATOR);
    doc.font('Body').fontSize(t.typography.metaSize);
    doc.y = y + doc.heightOfString(joined, { width: pageW });
    doc.x = lm;
    doc.fillColor(t.colors.text);
  }

  /** Adds a page if `neededHeight` doesn't fit, drawing Compact's own
   *  continuation header on every page this adds. No column-width
   *  bookkeeping is needed (unlike Modern/Professional) — Compact is a
   *  single full-width column on every page. */
  private compactMainEnsureSpace(
    doc: PDFKit.PDFDocument,
    t: TemplateDefinition,
    neededHeight: number,
    lm: number,
    pageW: number,
    candidateName: string,
  ): void {
    const spaceLeft = doc.page.height - t.margins.bottom - doc.y;
    const pageContentHeight = doc.page.height - t.margins.top - t.margins.bottom;
    if (neededHeight > spaceLeft && neededHeight <= pageContentHeight) {
      doc.addPage();
      this.compactContinuationHeader(doc, candidateName, lm, pageW, t);
    }
  }

  /**
   * Compact's own continuation-page treatment — designed specifically for
   * Compact, not copied from any other template (documented per the
   * task's explicit request): a small copper square (echoing the header
   * rule's accent, and every section heading's own marker) beside a
   * small, quiet, muted-color candidate-name label, then a thin full-
   * width hairline rule. Deliberately does NOT repeat the complete
   * first-page header (no adaptive-sized name, no title, no contact
   * block) — just enough to identify the page as a continuation.
   * Distinct from every sibling: Minimal's is muted gray with no marker
   * at all; Modern's is bold and muted-colored; Professional's is bold,
   * uppercase, and navy. Compact's is the smallest and quietest of all
   * four, fitting a template whose whole identity is efficiency over
   * presence.
   */
  private compactContinuationHeader(
    doc: PDFKit.PDFDocument,
    candidateName: string,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const markerSize = 4;
    doc.font('Body').fontSize(t.typography.metaSize);
    const y = doc.y;
    const lineH = doc.currentLineHeight();
    doc
      .rect(lm, y + (lineH - markerSize) / 2, markerSize, markerSize)
      .fillColor(t.colors.accent)
      .fill();
    doc
      .font('Body')
      .fontSize(t.typography.metaSize)
      .fillColor(t.colors.muted)
      .text(candidateName, lm + markerSize + 5, y, {
        width: pageW - markerSize - 5,
        characterSpacing: 0.2,
      });
    const ruleY = doc.y + 5;
    doc
      .moveTo(lm, ruleY)
      .lineTo(lm + pageW, ruleY)
      .lineWidth(0.5)
      .strokeColor(t.colors.rule)
      .stroke();
    doc.y = ruleY + 13;
    doc.fillColor(t.colors.text);
  }

  /**
   * Compact's fifth, genuinely distinct heading treatment
   * ('copper-marker-inline-rule' — see its own doc comment in template-
   * types.ts): a small copper square sits to the left of the (normal-
   * case, charcoal, not accent-colored) heading label, and a hairline
   * gray rule fills the rest of that same row to its right — the only
   * template whose heading rule shares the label's own line rather than
   * sitting above or below it.
   */
  private compactHeading(
    doc: PDFKit.PDFDocument,
    label: string,
    x: number,
    width: number,
    t: TemplateDefinition,
  ): void {
    const markerSize = 4.5;
    doc.font('Heading').fontSize(t.typography.headingSize);
    const textWidth = doc.widthOfString(label);
    const lineH = doc.currentLineHeight();
    const y = doc.y;

    doc
      .rect(x, y + (lineH - markerSize) / 2, markerSize, markerSize)
      .fillColor(t.colors.accent)
      .fill();

    const textX = x + markerSize + 5;
    doc
      .font('Heading')
      .fontSize(t.typography.headingSize)
      .fillColor(t.colors.heading)
      .text(label, textX, y, { width: Math.max(textWidth + 2, 1), lineBreak: false });

    const ruleStartX = textX + textWidth + 6;
    const ruleEndX = x + width;
    if (ruleEndX > ruleStartX) {
      const ruleY = y + lineH / 2;
      doc
        .moveTo(ruleStartX, ruleY)
        .lineTo(ruleEndX, ruleY)
        .lineWidth(0.75)
        .strokeColor(t.colors.rule)
        .stroke();
    }

    doc.y = y + lineH + 5;
    doc.x = x;
    doc.fillColor(t.colors.text);
  }

  /**
   * Main sequential content flow — Summary/Experience/Education plus, if
   * present, the secondary footer band, all as CompactFlowItems. Governed
   * entirely by compactMainEnsureSpace's per-heading safety check (same
   * mechanism Classic/Minimal/Professional already use) plus the narrow
   * orphan-final-section safeguard (compactShouldKeepWithNext) applied to
   * only the LAST TWO flow items — never a whole-document lookahead, and
   * this can never pull more than one item backward (see
   * minimalShouldKeepWithNext's doc comment for why that shape of rule
   * can't recreate a V1.1-style over-correction; the same reasoning
   * applies here unchanged).
   */
  private compactRenderBody(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    const order = content.sectionOrder.length > 0 ? content.sectionOrder : DEFAULT_SECTION_ORDER;
    const secondarySet = new Set(t.sidebarSections ?? []);
    const mainSections = order.filter(
      (s) => !secondarySet.has(s) && this.compactHasMainContent(content, s),
    );
    const hasBand =
      content.skills.length > 0 ||
      content.languages.length > 0 ||
      content.certifications.length > 0;

    const items: CompactFlowItem[] = mainSections.map((section) => ({ kind: 'section', section }));
    if (hasBand) items.push({ kind: 'secondaryBand' });
    if (!items.length) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item === undefined) continue;

      if (i === items.length - 2) {
        const nextItem = items[i + 1];
        if (
          nextItem !== undefined &&
          this.compactShouldKeepWithNext(doc, content, item, nextItem, pageW, t)
        ) {
          doc.addPage();
          this.compactContinuationHeader(doc, candidateName, lm, pageW, t);
          this.compactRenderFlowItem(doc, content, item, lm, pageW, t, candidateName);
          this.compactRenderFlowItem(doc, content, nextItem, lm, pageW, t, candidateName);
          return;
        }
      }

      this.compactRenderFlowItem(doc, content, item, lm, pageW, t, candidateName);
    }
  }

  private compactRenderFlowItem(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    item: CompactFlowItem,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    if (item.kind === 'secondaryBand') {
      this.compactMainEnsureSpace(
        doc,
        t,
        this.compactMeasureSecondaryBand(doc, content, pageW, t),
        lm,
        pageW,
        candidateName,
      );
      this.compactRenderSecondaryBand(doc, content, lm, pageW, t);
      return;
    }
    this.compactMainSection(doc, content, item.section, lm, pageW, t, candidateName);
  }

  private compactHasMainContent(content: CvContent, section: CvSection): boolean {
    switch (section) {
      case 'summary':
        return Boolean(content.summary);
      case 'workExperience':
        return content.workExperience.length > 0;
      case 'education':
        return content.education.length > 0;
      default:
        return false;
    }
  }

  private compactShouldKeepWithNext(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    item: CompactFlowItem,
    nextItem: CompactFlowItem,
    pageW: number,
    t: TemplateDefinition,
  ): boolean {
    const spaceLeft = doc.page.height - t.margins.bottom - doc.y;
    if (COMPACT_HEADING_MIN_SPACE > spaceLeft) {
      return false;
    }

    const itemH = this.compactMeasureFlowItem(doc, content, item, pageW, t);
    if (itemH > COMPACT_SMALL_SECTION_MAX_HEIGHT) {
      return false;
    }
    const nextH = this.compactMeasureFlowItem(doc, content, nextItem, pageW, t);
    if (nextH > COMPACT_SMALL_SECTION_MAX_HEIGHT) {
      return false;
    }

    const remainingAfterItem = spaceLeft - itemH;
    return COMPACT_HEADING_MIN_SPACE > remainingAfterItem;
  }

  private compactMeasureFlowItem(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    item: CompactFlowItem,
    pageW: number,
    t: TemplateDefinition,
  ): number {
    if (item.kind === 'secondaryBand') {
      return this.compactMeasureSecondaryBand(doc, content, pageW, t);
    }
    return this.compactMeasureSection(doc, content, item.section, pageW, t);
  }

  /** Same measurement approach as minimalMeasureSection/
   *  professionalMeasureSection — a planning heuristic reusing
   *  measureEntryHeight/heightOfString, used ONLY by
   *  compactShouldKeepWithNext's narrow orphan-final-section check. */
  private compactMeasureSection(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    pageW: number,
    t: TemplateDefinition,
  ): number {
    doc.font('Heading').fontSize(t.typography.headingSize);
    const headingOverhead = doc.currentLineHeight() + 5;
    doc.font('Body').fontSize(t.typography.bodySize);
    const bodyLineHeight = doc.currentLineHeight();

    switch (section) {
      case 'summary': {
        const bodyH = doc.heightOfString(normalizeParagraph(content.summary ?? ''), {
          width: pageW,
          lineGap: t.spacing.lineGap,
        });
        return headingOverhead + bodyH + bodyLineHeight * 0.9;
      }
      case 'workExperience': {
        let h = headingOverhead;
        for (const e of content.workExperience) {
          const dateStr = formatDateRange(e.startDate, e.endDate, e.current);
          const dateGap = dateStr ? 8 : 0;
          const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
          const titleColW = pageW - dateColW - dateGap;
          const orgLine = e.company + (e.location ? ` · ${e.location}` : '');
          h += this.measureEntryHeight(
            doc,
            titleColW,
            pageW,
            e.title,
            orgLine,
            undefined,
            e.bullets,
            t,
          );
        }
        return h;
      }
      case 'education': {
        let h = headingOverhead;
        for (const e of content.education) {
          const dateStr = formatDateRange(e.startDate, e.endDate);
          const dateGap = dateStr ? 8 : 0;
          const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
          const degColW = pageW - dateColW - dateGap;
          const degreeText = e.field ? `${e.degree} — ${e.field}` : e.degree;
          const instLine = e.institution + (e.location ? ` · ${e.location}` : '');
          h += this.measureEntryHeight(doc, degColW, pageW, degreeText, instLine, e.grade, [], t);
        }
        return h;
      }
      default:
        return 0;
    }
  }

  /** Divides `pageW` into `count` equal columns separated by `gap` —
   *  used both to measure and to render the secondary footer band, so
   *  the two can never disagree on column width. */
  private compactSecondaryColumnWidth(pageW: number, count: number, gap: number): number {
    if (count <= 0) return 0;
    return (pageW - gap * (count - 1)) / count;
  }

  /** Measures the secondary footer band's total height: the height of
   *  its TALLEST present column (Skills/Languages/Certifications render
   *  side by side, not stacked — see compactRenderSecondaryBand's doc
   *  comment), not the sum of all three. */
  private compactMeasureSecondaryBand(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    pageW: number,
    t: TemplateDefinition,
  ): number {
    const hasSkills = content.skills.length > 0;
    const hasLanguages = content.languages.length > 0;
    const hasCerts = content.certifications.length > 0;
    const count = [hasSkills, hasLanguages, hasCerts].filter(Boolean).length;
    if (count === 0) return 0;

    const gap = t.spacing.sectionGap;
    const colW = this.compactSecondaryColumnWidth(pageW, count, gap);

    doc.font('Heading').fontSize(t.typography.headingSize);
    const headingOverhead = doc.currentLineHeight() + 5;

    let maxH = 0;
    if (hasSkills) {
      doc.font('Body').fontSize(t.typography.bodySize);
      const listText = content.skills
        .map((s) => (s.level ? `${s.name} · ${s.level}` : s.name))
        .join(COMPACT_SEPARATOR);
      const bodyH = doc.heightOfString(listText, { width: colW, lineGap: t.spacing.lineGap });
      maxH = Math.max(maxH, headingOverhead + bodyH);
    }
    if (hasLanguages) {
      doc.font('Body').fontSize(t.typography.bodySize);
      const listText = content.languages
        .map((l) => (l.level ? `${l.name} (${l.level})` : l.name))
        .join(COMPACT_SEPARATOR);
      const bodyH = doc.heightOfString(listText, { width: colW, lineGap: t.spacing.lineGap });
      maxH = Math.max(maxH, headingOverhead + bodyH);
    }
    if (hasCerts) {
      let h = headingOverhead;
      for (const c of content.certifications) {
        doc.font('Heading').fontSize(t.typography.bodySize - 0.3);
        const nameH = doc.heightOfString(c.name, { width: colW });
        const meta = [c.issuer, c.date].filter(Boolean).join(' · ');
        doc.font('Body').fontSize(t.typography.metaSize);
        const metaH = meta ? doc.heightOfString(meta, { width: colW }) : 0;
        h += nameH + metaH + 8;
      }
      maxH = Math.max(maxH, h);
    }
    return maxH;
  }

  /**
   * Renders the secondary footer band: Skills, Languages, and
   * Certifications side by side rather than stacked — Compact's one
   * structural signature (see COMPACT_TEMPLATE's doc comment in
   * template-types.ts). Only present sections get a column, and present
   * columns always share the available width equally — never a fixed
   * one-third slot left empty when, say, a CV has no certifications.
   */
  private compactRenderSecondaryBand(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const hasSkills = content.skills.length > 0;
    const hasLanguages = content.languages.length > 0;
    const hasCerts = content.certifications.length > 0;
    const count = [hasSkills, hasLanguages, hasCerts].filter(Boolean).length;
    if (count === 0) return;

    const gap = t.spacing.sectionGap;
    const colW = this.compactSecondaryColumnWidth(pageW, count, gap);
    const rowTop = doc.y;
    let curX = lm;
    let maxBottom = rowTop;

    if (hasSkills) {
      doc.y = rowTop;
      this.compactHeading(doc, 'Skills', curX, colW, t);
      doc
        .font('Body')
        .fontSize(t.typography.bodySize)
        .fillColor(t.colors.text)
        .text(
          content.skills
            .map((s) => (s.level ? `${s.name} · ${s.level}` : s.name))
            .join(COMPACT_SEPARATOR),
          curX,
          doc.y,
          { width: colW, lineGap: t.spacing.lineGap },
        );
      maxBottom = Math.max(maxBottom, doc.y);
      curX += colW + gap;
    }

    if (hasLanguages) {
      doc.y = rowTop;
      this.compactHeading(doc, 'Languages', curX, colW, t);
      doc
        .font('Body')
        .fontSize(t.typography.bodySize)
        .fillColor(t.colors.text)
        .text(
          content.languages
            .map((l) => (l.level ? `${l.name} (${l.level})` : l.name))
            .join(COMPACT_SEPARATOR),
          curX,
          doc.y,
          { width: colW, lineGap: t.spacing.lineGap },
        );
      maxBottom = Math.max(maxBottom, doc.y);
      curX += colW + gap;
    }

    if (hasCerts) {
      doc.y = rowTop;
      this.compactHeading(doc, 'Certifications', curX, colW, t);
      for (const c of content.certifications) {
        this.compactCertification(doc, c, curX, colW, t);
      }
      maxBottom = Math.max(maxBottom, doc.y);
      curX += colW + gap;
    }

    doc.y = maxBottom;
    doc.x = lm;
    doc.fillColor(t.colors.text);
  }

  private compactCertification(
    doc: PDFKit.PDFDocument,
    c: CvCertificationEntry,
    x: number,
    width: number,
    t: TemplateDefinition,
  ): void {
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.3)
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
    doc.moveDown(0.5);
  }

  private compactMainSection(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    switch (section) {
      case 'summary':
        if (!content.summary) return;
        this.compactMainEnsureSpace(doc, t, COMPACT_HEADING_MIN_SPACE, lm, pageW, candidateName);
        this.compactHeading(doc, 'Summary', lm, pageW, t);
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text(normalizeParagraph(content.summary), lm, doc.y, {
            width: pageW,
            lineGap: t.spacing.lineGap,
          });
        doc.moveDown(0.9);
        break;

      case 'workExperience':
        if (!content.workExperience.length) return;
        this.compactMainEnsureSpace(doc, t, COMPACT_HEADING_MIN_SPACE, lm, pageW, candidateName);
        this.compactHeading(doc, 'Experience', lm, pageW, t);
        for (const e of content.workExperience) {
          this.compactWorkEntry(doc, e, lm, pageW, t, candidateName);
        }
        break;

      case 'education':
        if (!content.education.length) return;
        this.compactMainEnsureSpace(doc, t, COMPACT_HEADING_MIN_SPACE, lm, pageW, candidateName);
        this.compactHeading(doc, 'Education', lm, pageW, t);
        for (const e of content.education) {
          this.compactEducationEntry(doc, e, lm, pageW, t, candidateName);
        }
        break;

      default:
        break;
    }
  }

  private compactWorkEntry(
    doc: PDFKit.PDFDocument,
    entry: CvWorkEntry,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate, entry.current);
    const dateGap = dateStr ? 8 : 0;
    const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
    const titleColW = pageW - dateColW - dateGap;
    const orgLine = entry.company + (entry.location ? ` · ${entry.location}` : '');

    this.compactMainEnsureSpace(
      doc,
      t,
      this.measureEntryHeight(
        doc,
        titleColW,
        pageW,
        entry.title,
        orgLine,
        undefined,
        entry.bullets,
        t,
      ),
      lm,
      pageW,
      candidateName,
    );

    const rowY = doc.y;
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize)
      .fillColor(t.colors.text)
      .text(entry.title, lm, rowY, { width: titleColW });
    const afterTitle = doc.y;

    if (dateStr) {
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(dateStr, lm + pageW - dateColW, rowY, { width: dateColW, align: 'right' });
      if (doc.y < afterTitle) doc.y = afterTitle;
    }

    doc.moveDown(0.06);
    // Bold charcoal, NOT accent-colored — unlike every sidebar-having
    // template before it, Compact keeps its copper accent restricted to
    // the header rule and each heading's small marker (see
    // COMPACT_TEMPLATE's doc comment: the accent is used "sparingly").
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.2)
      .fillColor(t.colors.text)
      .text(orgLine, lm, doc.y, { width: pageW });

    const bullets = entry.bullets.filter((b) => b.trim());
    if (bullets.length) {
      doc.moveDown(0.25);
      bullets.forEach((b, i) => {
        if (i > 0) doc.y += t.spacing.bulletGap;
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          // A plain hyphen, not Modern/Professional's bullet dot or
          // Minimal's en dash — the smallest, most utilitarian marker of
          // any template, fitting Compact's efficiency-first identity.
          .text(`-  ${b}`, lm + 3, doc.y, { width: pageW - 3, lineGap: t.spacing.lineGap - 0.5 });
      });
    }

    doc.moveDown(0.5);
    doc.fillColor(t.colors.text);
  }

  private compactEducationEntry(
    doc: PDFKit.PDFDocument,
    entry: CvEducationEntry,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate);
    const dateGap = dateStr ? 8 : 0;
    const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
    const degColW = pageW - dateColW - dateGap;
    const degreeText = entry.field ? `${entry.degree} — ${entry.field}` : entry.degree;
    const instLine = entry.institution + (entry.location ? ` · ${entry.location}` : '');

    this.compactMainEnsureSpace(
      doc,
      t,
      this.measureEntryHeight(doc, degColW, pageW, degreeText, instLine, entry.grade, [], t),
      lm,
      pageW,
      candidateName,
    );

    const rowY = doc.y;
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize)
      .fillColor(t.colors.text)
      .text(degreeText, lm, rowY, { width: degColW });
    const afterDeg = doc.y;

    if (dateStr) {
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(dateStr, lm + pageW - dateColW, rowY, { width: dateColW, align: 'right' });
      if (doc.y < afterDeg) doc.y = afterDeg;
    }

    doc.moveDown(0.06);
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.2)
      .fillColor(t.colors.text)
      .text(instLine, lm, doc.y, { width: pageW });

    if (entry.grade) {
      // Neutral "Grade:" label — same convention as every other template:
      // the schema's `grade` field has no declared scale, so this never
      // guesses GPA/percentage/etc.
      doc.moveDown(0.06);
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(`Grade: ${entry.grade}`, lm, doc.y, { width: pageW });
    }

    doc.moveDown(0.5);
    doc.fillColor(t.colors.text);
  }

  // ── Signature (Phase 6) ──────────────────────────────────────────────
  //
  // Single column throughout, like Compact — but its identity comes from
  // three DIFFERENT mechanics (see SIGNATURE_TEMPLATE's doc comment):
  // an asymmetric two-zone header (`signatureHeader`), the
  // 'wine-tick-label' heading treatment (`signatureHeading` — a tick
  // mark, no rule at all), and a label:value "detail panel" for Skills/
  // Languages/Certifications (`signatureRenderDetailPanel`) instead of
  // Compact's horizontal footer band. The main content flow (Profile/
  // Experience/Education plus, if present, the detail panel) reuses the
  // exact same SignatureFlowItem-discriminated-union + narrow "keep last
  // two flow items together" orphan safeguard pattern proven on Compact
  // (`compactShouldKeepWithNext`) — see `signatureShouldKeepWithNext`.
  private signatureRender(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    t: TemplateDefinition,
  ): void {
    const lm = t.margins.left;
    const pageW = doc.page.width - lm - t.margins.right;
    const candidateName = content.personalDetails.fullName || 'CV';

    this.signatureHeader(doc, content, candidateName, lm, pageW, t);
    this.signatureRenderBody(doc, content, lm, pageW, t, candidateName);
    doc.fillColor(t.colors.text);
  }

  /** Adaptive name-size treatment — same technique proven on Minimal/
   *  Professional/Compact (see their own doc comments), re-derived here
   *  with Signature's own (larger) base/floor rather than calling
   *  another template's private implementation. */
  private signatureNameFontSize(
    doc: PDFKit.PDFDocument,
    name: string,
    width: number,
    baseSize: number,
  ): number {
    let size = baseSize;
    while (size > SIGNATURE_NAME_FLOOR_SIZE) {
      doc.font('Heading').fontSize(size);
      const lines = Math.round(doc.heightOfString(name, { width }) / doc.currentLineHeight());
      if (lines <= 2) return size;
      size -= SIGNATURE_NAME_STEP;
    }
    return SIGNATURE_NAME_FLOOR_SIZE;
  }

  /** Contact details for the header's right-hand card — email; phone and
   *  location combined onto one quiet line (unlike Compact's single
   *  fully-joined line); LinkedIn/website with shortened display labels
   *  and real clickable link destinations (shortenUrlLabel/
   *  normalizeExternalUrl). */
  private signatureContactLines(
    pd: CvContent['personalDetails'],
  ): Array<{ text: string; url?: string }> {
    const lines: Array<{ text: string; url?: string }> = [];
    if (pd.email) lines.push({ text: pd.email });
    if (pd.phone || pd.location) {
      lines.push({ text: [pd.phone, pd.location].filter(Boolean).join(SIGNATURE_SEPARATOR) });
    }
    if (pd.linkedIn) {
      lines.push({
        text: shortenUrlLabel(pd.linkedIn, 30),
        url: normalizeExternalUrl(pd.linkedIn),
      });
    }
    if (pd.website) {
      lines.push({ text: shortenUrlLabel(pd.website, 30), url: normalizeExternalUrl(pd.website) });
    }
    return lines;
  }

  /**
   * Signature's asymmetric editorial header — the template's primary
   * identity mark. Two zones side by side, ONLY across this header row
   * (the body below is plain single-column, so this never becomes a
   * persistent side column the way Modern's/Professional's
   * `sidebar-main` must survive a page break):
   *
   *  - LEFT (dominant): the job title as a small tracked wine "eyebrow"
   *    ABOVE the name — every other template puts the title below/after
   *    the name — then the large adaptive-sized name, then a short wine
   *    rule directly beneath it.
   *  - RIGHT (secondary): a small, non-full-bleed tinted card
   *    (`colors.headerBackground`) holding the contact details as quiet
   *    stacked lines — never full-bleed, never behind the name (contrast
   *    with Professional's full-bleed navy band).
   *
   * A full-width hairline rule closes the header before the body starts.
   * Both zones start at the same top y and are measured independently
   * (`leftBottom`/`rightBottom`); the close rule sits below whichever is
   * taller, so a CV with no contact details at all (rightBottom stays at
   * the top) still gets a correctly-positioned rule under the name block.
   */
  private signatureHeader(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    candidateName: string,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const { personalDetails: pd } = content;
    const zoneGap = 20;
    // Calibrated against realistic full names AND a realistic email (see
    // the module report): a name like "François Müller-Øst" needs a left
    // zone of roughly 320-340pt to stay on one line at the 34pt base
    // size, while a moderate-length email (e.g. "amara.lindqvist@
    // example.com") needs a card interior of ~120pt+ to avoid an ugly
    // mid-word break. 145pt is the calibrated sweet spot satisfying both
    // — narrower left ordinary names wrapping to 2 lines by default
    // (eating avoidable header height); wider broke the email onto an
    // orphaned single trailing character.
    const rightZoneW = Math.min(pageW * 0.3, 145);
    const leftZoneW = pageW - zoneGap - rightZoneW;
    const topY = doc.y;

    // ── Left zone: eyebrow + name + short wine rule ─────────────────────
    let leftY = topY;
    if (pd.jobTitle) {
      doc
        .font('Heading')
        .fontSize(t.typography.jobTitleSize)
        .fillColor(t.colors.accent)
        .text(pd.jobTitle.toUpperCase(), lm, leftY, { width: leftZoneW, characterSpacing: 0.7 });
      leftY = doc.y + 4;
    }
    const nameFontSize = this.signatureNameFontSize(
      doc,
      candidateName,
      leftZoneW,
      t.typography.nameSize,
    );
    doc
      .font('Heading')
      .fontSize(nameFontSize)
      .fillColor(t.colors.heading)
      .text(candidateName, lm, leftY, { width: leftZoneW });
    const ruleY = doc.y + 8;
    doc
      .moveTo(lm, ruleY)
      .lineTo(lm + 40, ruleY)
      .lineWidth(2)
      .strokeColor(t.colors.accent)
      .stroke();
    const leftBottom = ruleY + 2;

    // ── Right zone: small tinted contact card ───────────────────────────
    const rightX = lm + leftZoneW + zoneGap;
    const lines = this.signatureContactLines(pd);
    let rightBottom = topY;
    if (lines.length) {
      // hPad tuned down from a more generous 12pt after visual QA: a
      // realistic email (e.g. "katarzyna.nowak@example.com") wrapped
      // mid-word onto an orphaned trailing character at 12pt padding —
      // 8pt buys back enough width to keep typical business emails on
      // one line without touching leftZoneW/the name-fit calibration
      // above (padding is entirely inside the already-fixed rightZoneW).
      const hPad = 8;
      const vPad = 10;
      const lineGapPx = 4;
      const innerW = rightZoneW - hPad * 2;
      doc.font('Body').fontSize(t.typography.metaSize);
      const lineHeights = lines.map((l) => doc.heightOfString(l.text, { width: innerW }));
      const totalTextH = lineHeights.reduce((a, b) => a + b, 0) + lineGapPx * (lines.length - 1);
      const cardH = vPad * 2 + totalTextH;
      doc
        .rect(rightX, topY, rightZoneW, cardH)
        .fillColor(t.colors.headerBackground ?? '#FFFFFF')
        .fill();

      let cy = topY + vPad;
      for (const l of lines) {
        doc
          .font('Body')
          .fontSize(t.typography.metaSize)
          .fillColor(t.colors.muted)
          .text(l.text, rightX + hPad, cy, { width: innerW });
        if (l.url) {
          doc.link(rightX + hPad, cy, innerW, doc.currentLineHeight(), l.url);
        }
        cy = doc.y + lineGapPx;
      }
      rightBottom = topY + cardH;
    }

    const headerBottom = Math.max(leftBottom, rightBottom);
    const closeRuleY = headerBottom + 16;
    doc
      .moveTo(lm, closeRuleY)
      .lineTo(lm + pageW, closeRuleY)
      .lineWidth(0.75)
      .strokeColor(t.colors.rule)
      .stroke();
    doc.y = closeRuleY + 18;
    doc.x = lm;
    doc.fillColor(t.colors.text);
  }

  /** Adds a page if `neededHeight` doesn't fit, drawing Signature's own
   *  continuation header on every page this adds. No column-width
   *  bookkeeping is needed (unlike Modern/Professional) — Signature is a
   *  single full-width column on every page. */
  private signatureMainEnsureSpace(
    doc: PDFKit.PDFDocument,
    t: TemplateDefinition,
    neededHeight: number,
    lm: number,
    pageW: number,
    candidateName: string,
  ): void {
    const spaceLeft = doc.page.height - t.margins.bottom - doc.y;
    const pageContentHeight = doc.page.height - t.margins.top - t.margins.bottom;
    if (neededHeight > spaceLeft && neededHeight <= pageContentHeight) {
      doc.addPage();
      this.signatureContinuationHeader(doc, candidateName, lm, pageW, t);
    }
  }

  /**
   * Signature's own continuation-page treatment — a small wine tick (the
   * same motif used by every section heading) beside the candidate name
   * in small tracked caps, then a hairline rule. Deliberately does NOT
   * repeat the complete first-page header (no eyebrow, no large adaptive
   * name, no contact card) — just enough to identify the page as a
   * continuation, quiet enough not to compete with the editorial header.
   */
  private signatureContinuationHeader(
    doc: PDFKit.PDFDocument,
    candidateName: string,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const tickW = 2;
    const tickH = 9;
    doc.font('Heading').fontSize(t.typography.metaSize);
    const y = doc.y;
    const lineH = doc.currentLineHeight();
    doc
      .rect(lm, y + (lineH - tickH) / 2, tickW, tickH)
      .fillColor(t.colors.accent)
      .fill();
    doc
      .font('Heading')
      .fontSize(t.typography.metaSize)
      .fillColor(t.colors.muted)
      .text(candidateName.toUpperCase(), lm + tickW + 7, y, {
        width: pageW - tickW - 7,
        characterSpacing: 0.5,
      });
    const ruleY = doc.y + 6;
    doc
      .moveTo(lm, ruleY)
      .lineTo(lm + pageW, ruleY)
      .lineWidth(0.5)
      .strokeColor(t.colors.rule)
      .stroke();
    doc.y = ruleY + 16;
    doc.fillColor(t.colors.text);
  }

  /**
   * Signature's sixth, genuinely distinct heading treatment
   * ('wine-tick-label' — see its own doc comment in template-types.ts):
   * a short vertical wine tick beside an uppercase, tracked CHARCOAL
   * (not wine) label. No rule at all, drawn or inline — the section
   * break is communicated by the tick plus surrounding whitespace.
   */
  private signatureHeading(
    doc: PDFKit.PDFDocument,
    label: string,
    x: number,
    width: number,
    t: TemplateDefinition,
  ): void {
    const tickW = 2.5;
    const tickH = 11;
    doc.font('Heading').fontSize(t.typography.headingSize);
    const lineH = doc.currentLineHeight();
    const y = doc.y;

    doc
      .rect(x, y + (lineH - tickH) / 2, tickW, tickH)
      .fillColor(t.colors.accent)
      .fill();
    doc
      .font('Heading')
      .fontSize(t.typography.headingSize)
      .fillColor(t.colors.heading)
      .text(label.toUpperCase(), x + tickW + 7, y, {
        width: width - tickW - 7,
        characterSpacing: 0.5,
      });

    doc.y = y + lineH + 6;
    doc.x = x;
    doc.fillColor(t.colors.text);
  }

  /**
   * Main sequential content flow — Profile/Experience/Education plus, if
   * present, the detail panel, all as SignatureFlowItems. Structurally
   * identical to `compactRenderBody` (see its doc comment for why this
   * shape of orphan-final-section rule can't over-correct the way the
   * rejected V1.1 percentage-based algorithm did) — re-derived here
   * rather than sharing code with Compact, since the two templates'
   * flow items (footer band vs. detail panel) measure completely
   * differently.
   */
  private signatureRenderBody(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    const order = content.sectionOrder.length > 0 ? content.sectionOrder : DEFAULT_SECTION_ORDER;
    const secondarySet = new Set(t.sidebarSections ?? []);
    const mainSections = order.filter(
      (s) => !secondarySet.has(s) && this.signatureHasMainContent(content, s),
    );
    const hasPanel =
      content.skills.length > 0 ||
      content.languages.length > 0 ||
      content.certifications.length > 0;

    const items: SignatureFlowItem[] = mainSections.map((section) => ({
      kind: 'section',
      section,
    }));
    if (hasPanel) items.push({ kind: 'detailPanel' });
    if (!items.length) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item === undefined) continue;

      if (i === items.length - 2) {
        const nextItem = items[i + 1];
        if (
          nextItem !== undefined &&
          this.signatureShouldKeepWithNext(doc, content, item, nextItem, pageW, t)
        ) {
          doc.addPage();
          this.signatureContinuationHeader(doc, candidateName, lm, pageW, t);
          this.signatureRenderFlowItem(doc, content, item, lm, pageW, t, candidateName);
          this.signatureRenderFlowItem(doc, content, nextItem, lm, pageW, t, candidateName);
          return;
        }
      }

      this.signatureRenderFlowItem(doc, content, item, lm, pageW, t, candidateName);
    }
  }

  private signatureRenderFlowItem(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    item: SignatureFlowItem,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    if (item.kind === 'detailPanel') {
      this.signatureMainEnsureSpace(
        doc,
        t,
        this.signatureMeasureDetailPanel(doc, content, pageW, t),
        lm,
        pageW,
        candidateName,
      );
      this.signatureRenderDetailPanel(doc, content, lm, pageW, t);
      return;
    }
    this.signatureMainSection(doc, content, item.section, lm, pageW, t, candidateName);
  }

  private signatureHasMainContent(content: CvContent, section: CvSection): boolean {
    switch (section) {
      case 'summary':
        return Boolean(content.summary);
      case 'workExperience':
        return content.workExperience.length > 0;
      case 'education':
        return content.education.length > 0;
      default:
        return false;
    }
  }

  private signatureShouldKeepWithNext(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    item: SignatureFlowItem,
    nextItem: SignatureFlowItem,
    pageW: number,
    t: TemplateDefinition,
  ): boolean {
    const spaceLeft = doc.page.height - t.margins.bottom - doc.y;
    if (SIGNATURE_HEADING_MIN_SPACE > spaceLeft) {
      return false;
    }

    const itemH = this.signatureMeasureFlowItem(doc, content, item, pageW, t);
    if (itemH > SIGNATURE_SMALL_SECTION_MAX_HEIGHT) {
      return false;
    }
    const nextH = this.signatureMeasureFlowItem(doc, content, nextItem, pageW, t);
    if (nextH > SIGNATURE_SMALL_SECTION_MAX_HEIGHT) {
      return false;
    }

    const remainingAfterItem = spaceLeft - itemH;
    return SIGNATURE_HEADING_MIN_SPACE > remainingAfterItem;
  }

  private signatureMeasureFlowItem(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    item: SignatureFlowItem,
    pageW: number,
    t: TemplateDefinition,
  ): number {
    if (item.kind === 'detailPanel') {
      return this.signatureMeasureDetailPanel(doc, content, pageW, t);
    }
    return this.signatureMeasureSection(doc, content, item.section, pageW, t);
  }

  /** Same measurement approach as compactMeasureSection/
   *  professionalMeasureSection — a planning heuristic reusing
   *  measureEntryHeight/heightOfString, used ONLY by
   *  signatureShouldKeepWithNext's narrow orphan-final-section check. */
  private signatureMeasureSection(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    pageW: number,
    t: TemplateDefinition,
  ): number {
    doc.font('Heading').fontSize(t.typography.headingSize);
    const headingOverhead = doc.currentLineHeight() + 6;
    doc.font('Body').fontSize(t.typography.bodySize);
    const bodyLineHeight = doc.currentLineHeight();

    switch (section) {
      case 'summary': {
        const bodyH = doc.heightOfString(normalizeParagraph(content.summary ?? ''), {
          width: pageW,
          lineGap: t.spacing.lineGap,
        });
        return headingOverhead + bodyH + bodyLineHeight;
      }
      case 'workExperience': {
        let h = headingOverhead;
        for (const e of content.workExperience) {
          const dateStr = formatDateRange(e.startDate, e.endDate, e.current);
          const dateGap = dateStr ? 8 : 0;
          const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
          const titleColW = pageW - dateColW - dateGap;
          const orgLine = e.company + (e.location ? ` · ${e.location}` : '');
          h += this.measureEntryHeight(
            doc,
            titleColW,
            pageW,
            e.title,
            orgLine,
            undefined,
            e.bullets,
            t,
          );
        }
        return h;
      }
      case 'education': {
        let h = headingOverhead;
        for (const e of content.education) {
          const dateStr = formatDateRange(e.startDate, e.endDate);
          const dateGap = dateStr ? 8 : 0;
          const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
          const degColW = pageW - dateColW - dateGap;
          const degreeText = e.field ? `${e.degree} — ${e.field}` : e.degree;
          const instLine = e.institution + (e.location ? ` · ${e.location}` : '');
          h += this.measureEntryHeight(doc, degColW, pageW, degreeText, instLine, e.grade, [], t);
        }
        return h;
      }
      default:
        return 0;
    }
  }

  /** Measures the detail panel's total height (top padding + one row per
   *  present Skills/Languages/Certifications + a divider between rows +
   *  bottom padding) — mirrors `signatureRenderDetailPanel`'s geometry
   *  closely enough for `signatureMainEnsureSpace`'s page-break check,
   *  without needing pixel-exact agreement (same tolerance every other
   *  template's measure/render pair already accepts). */
  private signatureMeasureDetailPanel(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    pageW: number,
    t: TemplateDefinition,
  ): number {
    const hasSkills = content.skills.length > 0;
    const hasLanguages = content.languages.length > 0;
    const hasCerts = content.certifications.length > 0;
    if (!hasSkills && !hasLanguages && !hasCerts) return 0;

    const labelColW = 100;
    const gap = 16;
    const valueColW = pageW - labelColW - gap;

    doc.font('Heading').fontSize(t.typography.metaSize);
    const labelLineH = doc.currentLineHeight();

    const rowHeights: number[] = [];
    if (hasSkills) {
      doc.font('Body').fontSize(t.typography.bodySize - 0.2);
      const h = doc.heightOfString(
        content.skills
          .map((s) => (s.level ? `${s.name} (${s.level})` : s.name))
          .join(SIGNATURE_SEPARATOR),
        { width: valueColW, lineGap: t.spacing.lineGap - 1 },
      );
      rowHeights.push(Math.max(labelLineH, h));
    }
    if (hasLanguages) {
      doc.font('Body').fontSize(t.typography.bodySize - 0.2);
      const h = doc.heightOfString(
        content.languages
          .map((l) => (l.level ? `${l.name} (${l.level})` : l.name))
          .join(SIGNATURE_SEPARATOR),
        { width: valueColW, lineGap: t.spacing.lineGap - 1 },
      );
      rowHeights.push(Math.max(labelLineH, h));
    }
    if (hasCerts) {
      let certH = 0;
      for (const c of content.certifications) {
        const metaStr =
          c.issuer || c.date ? ` — ${[c.issuer, c.date].filter(Boolean).join(', ')}` : '';
        doc.font('Body').fontSize(t.typography.bodySize - 0.2);
        certH += doc.heightOfString(c.name + metaStr, { width: valueColW });
      }
      rowHeights.push(Math.max(labelLineH, certH));
    }

    const rowPadding = 10;
    const dividerGap = 10.5;
    let total = 10;
    rowHeights.forEach((h, i) => {
      total += h + rowPadding;
      if (i < rowHeights.length - 1) total += dividerGap;
    });
    return total + 14;
  }

  /**
   * Renders the detail panel: Skills, Languages, and Certifications as
   * label:value ROWS framed by one top and one bottom hairline rule —
   * Signature's one structural signature for secondary information (see
   * SIGNATURE_TEMPLATE's doc comment). Only present sections become a
   * row; rows are separated by a thin divider, never a fixed slot left
   * empty when a section is absent.
   */
  private signatureRenderDetailPanel(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
  ): void {
    const hasSkills = content.skills.length > 0;
    const hasLanguages = content.languages.length > 0;
    const hasCerts = content.certifications.length > 0;
    if (!hasSkills && !hasLanguages && !hasCerts) return;

    const labelColW = 100;
    const gap = 16;
    const valueX = lm + labelColW + gap;
    const valueColW = pageW - labelColW - gap;

    const topRuleY = doc.y;
    doc
      .moveTo(lm, topRuleY)
      .lineTo(lm + pageW, topRuleY)
      .lineWidth(0.75)
      .strokeColor(t.colors.rule)
      .stroke();
    doc.y = topRuleY + 10;

    const rows: Array<{ label: string; draw: () => void }> = [];
    if (hasSkills) {
      rows.push({
        label: 'Skills',
        draw: () => {
          doc
            .font('Body')
            .fontSize(t.typography.bodySize - 0.2)
            .fillColor(t.colors.text)
            .text(
              content.skills
                .map((s) => (s.level ? `${s.name} (${s.level})` : s.name))
                .join(SIGNATURE_SEPARATOR),
              valueX,
              doc.y,
              { width: valueColW, lineGap: t.spacing.lineGap - 1 },
            );
        },
      });
    }
    if (hasLanguages) {
      rows.push({
        label: 'Languages',
        draw: () => {
          doc
            .font('Body')
            .fontSize(t.typography.bodySize - 0.2)
            .fillColor(t.colors.text)
            .text(
              content.languages
                .map((l) => (l.level ? `${l.name} (${l.level})` : l.name))
                .join(SIGNATURE_SEPARATOR),
              valueX,
              doc.y,
              { width: valueColW, lineGap: t.spacing.lineGap - 1 },
            );
        },
      });
    }
    if (hasCerts) {
      rows.push({
        label: 'Certifications',
        draw: () => {
          for (const c of content.certifications) {
            this.signatureCertLine(doc, c, valueX, valueColW, t);
          }
        },
      });
    }

    rows.forEach((row, i) => {
      const rowY = doc.y;
      doc
        .font('Heading')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.heading)
        .text(row.label.toUpperCase(), lm, rowY, { width: labelColW, characterSpacing: 0.5 });
      const afterLabel = doc.y;

      doc.y = rowY;
      doc.x = valueX;
      row.draw();
      const afterValue = doc.y;

      doc.y = Math.max(afterLabel, afterValue) + 10;
      doc.x = lm;

      if (i < rows.length - 1) {
        const dividerY = doc.y;
        doc
          .moveTo(lm, dividerY)
          .lineTo(lm + pageW, dividerY)
          .lineWidth(0.5)
          .strokeColor(t.colors.rule)
          .stroke();
        doc.y = dividerY + 10;
      }
    });

    const bottomRuleY = doc.y;
    doc
      .moveTo(lm, bottomRuleY)
      .lineTo(lm + pageW, bottomRuleY)
      .lineWidth(0.75)
      .strokeColor(t.colors.rule)
      .stroke();
    doc.y = bottomRuleY + 14;
    doc.x = lm;
    doc.fillColor(t.colors.text);
  }

  /** One certification's name (bold) + " — issuer, date" (muted) on a
   *  single wrapped inline run, mirroring the React preview's inline
   *  flow. doc.y after a chain of `continued: true` calls is not
   *  reliably the run's actual bottom (see compactContactLine's doc
   *  comment for the same bug and fix) — pinned deterministically here
   *  via a plain-text height measurement of the equivalent combined
   *  string instead of trusting continued-mode's own cursor tracking. */
  private signatureCertLine(
    doc: PDFKit.PDFDocument,
    c: CvCertificationEntry,
    x: number,
    width: number,
    t: TemplateDefinition,
  ): void {
    const metaStr = c.issuer || c.date ? ` — ${[c.issuer, c.date].filter(Boolean).join(', ')}` : '';
    const y = doc.y;
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.2)
      .fillColor(t.colors.text)
      .text(c.name, x, y, { continued: Boolean(metaStr), width });
    if (metaStr) {
      doc
        .font('Body')
        .fontSize(t.typography.bodySize - 0.2)
        .fillColor(t.colors.muted)
        .text(metaStr, { continued: false });
    }
    doc.font('Body').fontSize(t.typography.bodySize - 0.2);
    doc.y = y + doc.heightOfString(c.name + metaStr, { width }) + 4;
    doc.x = x;
    doc.fillColor(t.colors.text);
  }

  private signatureMainSection(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    switch (section) {
      case 'summary':
        if (!content.summary) return;
        this.signatureMainEnsureSpace(
          doc,
          t,
          SIGNATURE_HEADING_MIN_SPACE,
          lm,
          pageW,
          candidateName,
        );
        this.signatureHeading(doc, 'Profile', lm, pageW, t);
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text(normalizeParagraph(content.summary), lm, doc.y, {
            width: pageW,
            lineGap: t.spacing.lineGap,
          });
        doc.moveDown(1);
        break;

      case 'workExperience':
        if (!content.workExperience.length) return;
        this.signatureMainEnsureSpace(
          doc,
          t,
          SIGNATURE_HEADING_MIN_SPACE,
          lm,
          pageW,
          candidateName,
        );
        this.signatureHeading(doc, 'Experience', lm, pageW, t);
        for (const e of content.workExperience) {
          this.signatureWorkEntry(doc, e, lm, pageW, t, candidateName);
        }
        break;

      case 'education':
        if (!content.education.length) return;
        this.signatureMainEnsureSpace(
          doc,
          t,
          SIGNATURE_HEADING_MIN_SPACE,
          lm,
          pageW,
          candidateName,
        );
        this.signatureHeading(doc, 'Education', lm, pageW, t);
        for (const e of content.education) {
          this.signatureEducationEntry(doc, e, lm, pageW, t, candidateName);
        }
        break;

      default:
        break;
    }
  }

  private signatureWorkEntry(
    doc: PDFKit.PDFDocument,
    entry: CvWorkEntry,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate, entry.current);
    const dateGap = dateStr ? 8 : 0;
    const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
    const titleColW = pageW - dateColW - dateGap;
    const orgLine = entry.company + (entry.location ? ` · ${entry.location}` : '');

    this.signatureMainEnsureSpace(
      doc,
      t,
      this.measureEntryHeight(
        doc,
        titleColW,
        pageW,
        entry.title,
        orgLine,
        undefined,
        entry.bullets,
        t,
      ),
      lm,
      pageW,
      candidateName,
    );

    const rowY = doc.y;
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize)
      .fillColor(t.colors.heading)
      .text(entry.title, lm, rowY, { width: titleColW });
    const afterTitle = doc.y;

    if (dateStr) {
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(dateStr, lm + pageW - dateColW, rowY, { width: dateColW, align: 'right' });
      if (doc.y < afterTitle) doc.y = afterTitle;
    }

    doc.moveDown(0.1);
    // Wine accent on the organization line — the one convention every
    // accent-having template before Signature also uses (Modern/Minimal/
    // Professional all color their org/institution line), kept here for
    // a consistent cross-template pattern. Section labels, dates, and
    // body copy stay off-accent — see SIGNATURE_TEMPLATE's controlled-
    // accent-usage doc comment.
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.3)
      .fillColor(t.colors.accent)
      .text(orgLine, lm, doc.y, { width: pageW });

    const bullets = entry.bullets.filter((b) => b.trim());
    if (bullets.length) {
      doc.moveDown(0.35);
      bullets.forEach((b, i) => {
        if (i > 0) doc.y += t.spacing.bulletGap;
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text(`»  ${b}`, lm + 3, doc.y, { width: pageW - 3, lineGap: t.spacing.lineGap - 1 });
      });
    }

    doc.moveDown(0.6);
    doc.fillColor(t.colors.text);
  }

  private signatureEducationEntry(
    doc: PDFKit.PDFDocument,
    entry: CvEducationEntry,
    lm: number,
    pageW: number,
    t: TemplateDefinition,
    candidateName: string,
  ): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate);
    const dateGap = dateStr ? 8 : 0;
    const dateColW = dateStr ? this.modernDateColWidth(doc, dateStr, t, pageW) : 0;
    const degColW = pageW - dateColW - dateGap;
    const degreeText = entry.field ? `${entry.degree} — ${entry.field}` : entry.degree;
    const instLine = entry.institution + (entry.location ? ` · ${entry.location}` : '');

    this.signatureMainEnsureSpace(
      doc,
      t,
      this.measureEntryHeight(doc, degColW, pageW, degreeText, instLine, entry.grade, [], t),
      lm,
      pageW,
      candidateName,
    );

    const rowY = doc.y;
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize)
      .fillColor(t.colors.heading)
      .text(degreeText, lm, rowY, { width: degColW });
    const afterDeg = doc.y;

    if (dateStr) {
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(dateStr, lm + pageW - dateColW, rowY, { width: dateColW, align: 'right' });
      if (doc.y < afterDeg) doc.y = afterDeg;
    }

    doc.moveDown(0.1);
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.3)
      .fillColor(t.colors.accent)
      .text(instLine, lm, doc.y, { width: pageW });

    if (entry.grade) {
      // Neutral "Grade:" label — same convention as every other template:
      // the schema's `grade` field has no declared scale, so this never
      // guesses GPA/percentage/etc.
      doc.moveDown(0.1);
      doc
        .font('Body')
        .fontSize(t.typography.metaSize)
        .fillColor(t.colors.muted)
        .text(`Grade: ${entry.grade}`, lm, doc.y, { width: pageW });
    }

    doc.moveDown(0.6);
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
const MINIMAL_SEPARATOR = '   ·   ';
// Minimal-only, larger than the shared HEADING_MIN_SPACE: reserves room for
// the heading AND a typical short first entry/line, not just the heading
// itself — found via visual QA that HEADING_MIN_SPACE alone let a heading
// draw at the very bottom of a page with its first entry pushed alone to
// the next page (an orphaned heading). Scoped to Minimal only — Classic
// and Modern keep using the plain HEADING_MIN_SPACE, unchanged.
const MINIMAL_HEADING_MIN_SPACE = HEADING_MIN_SPACE + 70;
// V1.1 adaptive name-size bounds — see minimalNameFontSize's doc comment.
// Floor stays well above body/heading text (24pt vs 12pt headingSize) so
// the name always reads as unmistakably the largest, most prominent
// element on the page, even for the longest realistic names.
const MINIMAL_NAME_FLOOR_SIZE = 24;
const MINIMAL_NAME_STEP = 2;
// V1.3 orphan-final-section safeguard bound — see minimalShouldKeepWithNext's
// doc comment. A fixed point value, deliberately NOT a percentage of the
// page (that framing is exactly what V1.1's rejected 30%-tail-ratio
// algorithm used) — comfortably above a short Skills/Languages list or a
// single Certification, and comfortably below any real Experience/
// Education section that has actual entries, so only genuinely small
// trailing sections can ever qualify.
const MINIMAL_SMALL_SECTION_MAX_HEIGHT = 140;

/** Mutable main-column geometry for Professional — same convention as
 *  ModernColumn (see its doc comment): widens to full page width after
 *  the first page break, since there is no secondary column to run
 *  alongside on a continuation page. */
interface ProfessionalColumn {
  x: number;
  width: number;
  isFirstPage: boolean;
  candidateName: string;
}

const PROFESSIONAL_SEPARATOR = '   ·   ';
// Same reasoning as MINIMAL_HEADING_MIN_SPACE (see its doc comment):
// reserves room for the heading AND a typical short first entry/line,
// not just the heading itself, so a heading can never draw orphaned at
// the very bottom of a page.
const PROFESSIONAL_HEADING_MIN_SPACE = HEADING_MIN_SPACE + 70;
// Adaptive name-size bounds — see professionalNameFontSize's doc
// comment. Floor stays comfortably above body/heading text so the name
// always reads as the largest, most prominent element in the header band
// even for the longest realistic names.
const PROFESSIONAL_NAME_FLOOR_SIZE = 20;
const PROFESSIONAL_NAME_STEP = 2;
// Orphan-final-section safeguard bound — see
// professionalShouldKeepWithNext's doc comment. Same fixed-point-value
// reasoning as MINIMAL_SMALL_SECTION_MAX_HEIGHT (not a percentage of the
// page): comfortably above a short Profile paragraph, and comfortably
// below any real Experience/Education section with actual entries.
const PROFESSIONAL_SMALL_SECTION_MAX_HEIGHT = 140;

/**
 * Compact's main content flow (Summary/Experience/Education plus, if
 * present, the secondary Skills/Languages/Certifications footer band)
 * is a mix of real CvSections and one pseudo-item representing the
 * combined band — this discriminated union lets the same
 * orphan-final-section safeguard used on Minimal/Professional
 * (compactShouldKeepWithNext) examine "the last two flow items"
 * uniformly, whether the final item is a real section or the band.
 */
type CompactFlowItem = { kind: 'section'; section: CvSection } | { kind: 'secondaryBand' };

const COMPACT_SEPARATOR = '   ·   ';
// Same reasoning as MINIMAL_HEADING_MIN_SPACE/PROFESSIONAL_HEADING_MIN_SPACE
// (see their doc comments): reserves room for the heading AND a typical
// short first entry/line, not just the heading itself. Compact's own
// spacing is tighter than either sibling, so this uses a smaller top-up
// than their `+ 70` — tuned against Compact's own headingSize/entryGap
// rather than reused verbatim.
const COMPACT_HEADING_MIN_SPACE = HEADING_MIN_SPACE + 50;
// Adaptive name-size bounds — see compactNameFontSize's doc comment.
// Compact's base name size (19pt) is already the smallest of any
// template, so the floor sits closer to its base than Minimal's/
// Professional's — just enough room to resolve a genuinely long name to
// 2 lines without letting the name collapse toward body-text size.
const COMPACT_NAME_FLOOR_SIZE = 15;
const COMPACT_NAME_STEP = 1;
// Orphan-final-section safeguard bound — see compactShouldKeepWithNext's
// doc comment. Same fixed-point-value reasoning as
// MINIMAL_SMALL_SECTION_MAX_HEIGHT/PROFESSIONAL_SMALL_SECTION_MAX_HEIGHT:
// comfortably above a short Summary paragraph or the secondary band when
// only one or two of its columns are present, and comfortably below any
// real Experience/Education section with actual entries.
const COMPACT_SMALL_SECTION_MAX_HEIGHT = 140;

/**
 * Signature's main content flow (Profile/Experience/Education plus, if
 * present, the Skills/Languages/Certifications detail panel) mixes real
 * CvSections with one pseudo-item representing the panel — this
 * discriminated union lets the same orphan-final-section safeguard used
 * on Compact (signatureShouldKeepWithNext) examine "the last two flow
 * items" uniformly, whether the final item is a real section or the
 * panel. Structurally identical to CompactFlowItem, re-derived rather
 * than shared since the two templates' pseudo-items measure completely
 * differently (tallest-of-three-columns vs. sum-of-label-value-rows).
 */
type SignatureFlowItem = { kind: 'section'; section: CvSection } | { kind: 'detailPanel' };

const SIGNATURE_SEPARATOR = '   ·   ';
// Same reasoning as MINIMAL_HEADING_MIN_SPACE/PROFESSIONAL_HEADING_MIN_SPACE/
// COMPACT_HEADING_MIN_SPACE (see their doc comments): reserves room for
// the heading AND a typical short first entry/line, not just the heading
// itself. Signature's spacing sits between Compact's (tightest) and
// Minimal's (most generous), so this uses a top-up between their `+ 50`
// and `+ 70`.
const SIGNATURE_HEADING_MIN_SPACE = HEADING_MIN_SPACE + 60;
// Adaptive name-size bounds — see signatureNameFontSize's doc comment.
// Signature's base name size (34pt) is the LARGEST of any template
// (explicitly permitted by the product brief: "may be larger... if the
// layout supports it") — the floor (24pt) still sits above every other
// template's own BASE name size except Minimal's (32pt), so even the
// longest realistic name reads as the unmistakable visual peak of the
// page.
const SIGNATURE_NAME_FLOOR_SIZE = 24;
const SIGNATURE_NAME_STEP = 2;
// Orphan-final-section safeguard bound — see signatureShouldKeepWithNext's
// doc comment. Same fixed-point-value reasoning as
// MINIMAL_SMALL_SECTION_MAX_HEIGHT/PROFESSIONAL_SMALL_SECTION_MAX_HEIGHT/
// COMPACT_SMALL_SECTION_MAX_HEIGHT: comfortably above a short Profile
// paragraph or a detail panel with only one or two rows present, and
// comfortably below any real Experience/Education section with actual
// entries.
const SIGNATURE_SMALL_SECTION_MAX_HEIGHT = 140;
