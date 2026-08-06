import { PassThrough } from 'stream';
import PDFDocument from 'pdfkit';
import { Injectable } from '@nestjs/common';
import type { CvContent, CvSection, CvWorkEntry, CvEducationEntry } from '@cvpilot/shared';

const BLACK = '#111827';
const DARK = '#374151';
const GRAY = '#6B7280';
const RULE = '#D1D5DB';
const MARGIN = 56;

// Minimum vertical space (pt) before drawing a section heading.
// Rule (1) + gap + label (8pt) + gap + first content line (~12pt) ≈ 60pt.
// If less remains on the page, we add a new page so headings are never orphaned.
const HEADING_MIN_SPACE = 60;

const DEFAULT_ORDER: CvSection[] = [
  'summary',
  'workExperience',
  'education',
  'skills',
  'languages',
  'certifications',
];

function formatDateRange(start?: string, end?: string, current?: boolean): string {
  if (!start) return '';
  const fmt = (ym: string): string => {
    const [y, m] = ym.split('-');
    if (!m) return y ?? '';
    const d = new Date(Number(y), Number(m) - 1);
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  };
  return `${fmt(start)} – ${current ? 'Present' : end ? fmt(end) : ''}`;
}

@Injectable()
export class PdfGenerationService {
  // Returns a PassThrough stream that emits the PDF as it is generated.
  // StreamableFile accepts a Readable, so this pipes directly to the HTTP response
  // without buffering the full document in memory.
  //
  // To add a template in the future: add a TemplateId union, switch here, and
  // implement a new private render method — the streaming infrastructure stays unchanged.
  generateStream(content: CvContent, docTitle?: string): PassThrough {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: { Title: docTitle ?? content.personalDetails.fullName ?? 'CV' },
    });
    const pass = new PassThrough();
    doc.pipe(pass);
    try {
      this.atsClassicRender(doc, content);
    } catch (err) {
      // Propagate synchronous render errors to the stream consumer.
      doc.end();
      pass.destroy(err as Error);
      return pass;
    }
    doc.end();
    return pass;
  }

  private atsClassicRender(doc: PDFKit.PDFDocument, content: CvContent): void {
    const lm = MARGIN;
    const pageW = doc.page.width - lm - MARGIN;
    const { personalDetails: pd } = content;

    // ── Header ───────────────────────────────────────────────────────────────
    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(BLACK)
      .text(pd.fullName || 'Your Name', lm, doc.y, { align: 'center', width: pageW });

    if (pd.jobTitle) {
      doc.moveDown(0.2);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(GRAY)
        .text(pd.jobTitle, lm, doc.y, { align: 'center', width: pageW });
    }

    const contactParts = [pd.email, pd.phone, pd.location, pd.linkedIn, pd.website].filter(
      (v): v is string => Boolean(v),
    );
    if (contactParts.length) {
      doc.moveDown(0.25);
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(GRAY)
        .text(contactParts.join('  ·  '), lm, doc.y, { align: 'center', width: pageW });
    }

    doc.moveDown(0.9);

    // ── Body sections ─────────────────────────────────────────────────────────
    const order = content.sectionOrder.length > 0 ? content.sectionOrder : DEFAULT_ORDER;
    for (const section of order) {
      this.renderSection(doc, content, section, lm, pageW);
    }
  }

  private renderSection(
    doc: PDFKit.PDFDocument,
    content: CvContent,
    section: CvSection,
    lm: number,
    pageW: number,
  ): void {
    switch (section) {
      case 'summary':
        if (!content.summary) return;
        this.heading(doc, 'Summary', lm, pageW);
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(DARK)
          .text(content.summary, lm, doc.y, { width: pageW, lineGap: 2 });
        doc.moveDown(0.8);
        break;

      case 'workExperience':
        if (!content.workExperience.length) return;
        this.heading(doc, 'Work Experience', lm, pageW);
        for (const e of content.workExperience) this.workEntry(doc, e, lm, pageW);
        doc.moveDown(0.2);
        break;

      case 'education':
        if (!content.education.length) return;
        this.heading(doc, 'Education', lm, pageW);
        for (const e of content.education) this.educationEntry(doc, e, lm, pageW);
        doc.moveDown(0.2);
        break;

      case 'skills':
        if (!content.skills.length) return;
        this.heading(doc, 'Skills', lm, pageW);
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(DARK)
          .text(
            content.skills.map((s) => (s.level ? `${s.name} (${s.level})` : s.name)).join('  ·  '),
            lm,
            doc.y,
            { width: pageW, lineGap: 2 },
          );
        doc.moveDown(0.8);
        break;

      case 'languages':
        if (!content.languages.length) return;
        this.heading(doc, 'Languages', lm, pageW);
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(DARK)
          .text(
            content.languages
              .map((l) => (l.level ? `${l.name} (${l.level})` : l.name))
              .join('  ·  '),
            lm,
            doc.y,
            { width: pageW, lineGap: 2 },
          );
        doc.moveDown(0.8);
        break;

      case 'certifications':
        if (!content.certifications.length) return;
        this.heading(doc, 'Certifications', lm, pageW);
        for (const c of content.certifications) {
          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .fillColor(BLACK)
            .text(c.name, lm, doc.y, { width: pageW });
          const meta = [c.issuer, c.date].filter(Boolean).join(' · ');
          if (meta) {
            doc
              .font('Helvetica')
              .fontSize(9)
              .fillColor(GRAY)
              .text(meta, lm, doc.y, { width: pageW });
          }
          doc.moveDown(0.4);
        }
        doc.moveDown(0.3);
        break;
    }
  }

  private heading(doc: PDFKit.PDFDocument, label: string, lm: number, pageW: number): void {
    // moveTo/lineTo/stroke does NOT trigger PDFKit's automatic page-break logic.
    // If less than HEADING_MIN_SPACE remains, start a new page so the rule and
    // label are never orphaned at the bottom with content starting on the next page.
    const spaceLeft = doc.page.height - MARGIN - doc.y;
    if (spaceLeft < HEADING_MIN_SPACE) {
      doc.addPage();
    }

    const y = doc.y;
    doc
      .moveTo(lm, y)
      .lineTo(lm + pageW, y)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.moveDown(0.3);
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(DARK)
      .text(label.toUpperCase(), lm, doc.y, { width: pageW, characterSpacing: 0.8 });
    doc.moveDown(0.5);
    doc.fillColor(BLACK);
  }

  private workEntry(doc: PDFKit.PDFDocument, entry: CvWorkEntry, lm: number, pageW: number): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate, entry.current);
    const dateColW = 92;
    const titleColW = pageW - dateColW;
    const rowY = doc.y;

    doc.font('Helvetica-Bold').fontSize(10).fillColor(BLACK).text(entry.title, lm, rowY, {
      width: titleColW,
    });
    const afterTitle = doc.y;

    if (dateStr) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(GRAY)
        .text(dateStr, lm + titleColW, rowY, { width: dateColW, align: 'right' });
      if (doc.y < afterTitle) doc.y = afterTitle;
    }

    const companyLine = [entry.company, entry.location].filter(Boolean).join(', ');
    if (companyLine) {
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(GRAY)
        .text(companyLine, lm, doc.y, { width: pageW });
    }

    const bullets = entry.bullets.filter((b) => b.trim());
    if (bullets.length) {
      doc.moveDown(0.2);
      for (const b of bullets) {
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(DARK)
          .text(`•  ${b}`, lm + 4, doc.y, { width: pageW - 4, lineGap: 1 });
      }
    }

    doc.moveDown(0.65);
    doc.fillColor(BLACK);
  }

  private educationEntry(
    doc: PDFKit.PDFDocument,
    entry: CvEducationEntry,
    lm: number,
    pageW: number,
  ): void {
    const dateStr = formatDateRange(entry.startDate, entry.endDate);
    const dateColW = 92;
    const degColW = pageW - dateColW;
    const degreeText = entry.field ? `${entry.degree} — ${entry.field}` : entry.degree;
    const rowY = doc.y;

    doc.font('Helvetica-Bold').fontSize(10).fillColor(BLACK).text(degreeText, lm, rowY, {
      width: degColW,
    });
    const afterDeg = doc.y;

    if (dateStr) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(GRAY)
        .text(dateStr, lm + degColW, rowY, { width: dateColW, align: 'right' });
      if (doc.y < afterDeg) doc.y = afterDeg;
    }

    const instLine = [entry.institution, entry.location].filter(Boolean).join(', ');
    if (instLine) {
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(GRAY)
        .text(instLine, lm, doc.y, { width: pageW });
    }
    if (entry.grade) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(GRAY)
        .text(entry.grade, lm, doc.y, { width: pageW });
    }

    doc.moveDown(0.65);
    doc.fillColor(BLACK);
  }
}
