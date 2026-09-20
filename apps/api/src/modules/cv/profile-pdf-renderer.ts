import type {
  CvContent,
  CvSection,
  CvWorkEntry,
  CvEducationEntry,
  CvCertificationEntry,
  CvReferenceEntry,
  CvSkillEntry,
  CvLanguageEntry,
} from '@cvpilot/shared';
import {
  applyProfileDensity,
  estimateProfileDensity,
  formatDateRange,
  formatLinkedInLabel,
  normalizeExternalUrl,
  normalizeParagraph,
  resolveSectionOrder,
  shortenUrlLabel,
  type TemplateDefinition,
} from '@cvpilot/shared';
import type { ImageDimensions } from './utils/image-validation.util';

/**
 * CV Template Foundation, Phase 7 — Profile, PDFKit side. Kept as its own
 * module (not another private method group on the already ~5000-line
 * PdfGenerationService) — see this project's own module-size precedent.
 * Because this can't call PdfGenerationService's private helpers
 * (measureEntryHeight, modernDateColWidth, the continuation-header
 * conventions, ...), it re-derives its own small equivalents rather than
 * exporting those private methods — the same accepted per-template
 * duplication trade-off already documented for every other template (see
 * the Template Foundation decision report referenced at the top of
 * pdf-generation.service.ts).
 *
 * Two structural things genuinely new here, absent from all six other
 * templates:
 *
 * 1. An optional circular photo with a white ring, overlapping a curved
 *    "cap" (a filled path whose bottom edge is a single quadratic Bézier
 *    curve bulging downward at the horizontal center — the PDFKit
 *    equivalent of profile-document.tsx's CSS "wave header" corner-radius
 *    trick). Center-cropped ("cover") into the circle using the photo's
 *    real pixel dimensions, never stretched.
 * 2. Genuine sidebar pagination. Every other sidebar-having template
 *    (Modern, Professional) assumes its sidebar always fits on page 1.
 *    Profile's sidebar can legitimately overflow (a long Skills/Languages/
 *    Qualities list), so this renders the sidebar and main column as two
 *    independent page-aware passes that can SHARE pages: `doc` is
 *    constructed with `bufferPages: true` (see generateStream) so
 *    `doc.switchToPage()` can resume writing to a page created by the
 *    other pass. Whichever pass reaches a given continuation page first
 *    draws its shared header once; `pageContentTop` records where content
 *    should resume on that page so the other pass can join it there
 *    without redrawing the header or guessing a y position. Nothing in
 *    the sidebar is ever silently dropped for lack of room.
 */

const CURVE_DEPTH = 16;
// Fix (RABBIT_NOTEBOOK.md, sidebar width/padding rebalance): was 16 —
// reduced in step with the browser preview's matching .cvpf-cap padding
// (profile-document.tsx's buildProfileCss) and the sidebar's own narrower
// width (PROFILE_TEMPLATE.sidebarWidthRatio 0.33 -> 0.3, template-types.ts)
// — recovers some of that narrowing back for the name/job-title text
// itself. CAP_PADDING_TOP/CAP_PADDING_BOTTOM (vertical, governing the
// photo/curve geometry) are untouched.
const CAP_PADDING_X = 12;
const CAP_PADDING_TOP = 22;
const CAP_PADDING_BOTTOM = 20;
const GAP_AFTER_CAP = 16;
const PHOTO_OUTER_RADIUS = 37;
const PHOTO_RING_THICKNESS = 4;
// Fix: pure center-crop (the original 50%/50% math) crops evenly off the
// top AND bottom of a scaled-up portrait, which for typical headshot
// framing (face in the upper-middle third, hair extending near the very
// top edge) cut off the crown of the head. 0.22 is the exact PDFKit
// equivalent of the CSS side's `object-position: 50% 22%` (see
// profile-document.tsx's .cvpf-photo) — both bias the visible crop window
// toward the top of the source image by the same amount, using the same
// "object-position Y%" formula (CSS Object Fit spec): the image's vertical
// offset = Y% * (boxHeight - scaledImageHeight). 0.5 would reproduce the
// old centered behavior exactly.
const PHOTO_VERTICAL_BIAS = 0.22;
// Vertical clearance between the bottom of the name/job-title text and the
// TOP edge of the photo circle when a photo is present. Fix: the cap's
// flat height used to be sized purely from the text block plus
// CAP_PADDING_BOTTOM (20pt) regardless of whether a photo would later be
// centered at that same y — but the photo's own radius (37pt) is far
// larger than that padding, so the photo's top routinely landed well
// inside the text block (observed: overlapping "Senior Backend Engineer"
// in a rendered PDF). profile-document.tsx's CSS mirrors this exact value
// (see buildProfileCss's PHOTO_TEXT_CLEARANCE) so both renderers reserve
// identical space above the photo.
const PHOTO_TEXT_CLEARANCE = 12;
// Vertical clearance between the BOTTOM edge of the photo circle and the
// first line of sidebar-body content below it (e.g. "Personal Details").
// Kept distinct from GAP_AFTER_CAP (the no-photo curve clearance, and the
// floor this value is maxed against below) so this can be tuned for the
// photo case alone without changing the no-photo spacing. Mirrored exactly
// in profile-document.tsx's buildProfileCss (PHOTO_BOTTOM_GAP).
const PHOTO_BOTTOM_GAP = 18;

const PROFILE_NAME_FLOOR_SIZE = 13;
const PROFILE_NAME_STEP = 1.5;

interface ProfileColumn {
  x: number;
  width: number;
}

type IconType = 'email' | 'phone' | 'location' | 'link' | 'globe' | 'flag';

export function renderProfileTemplate(
  doc: PDFKit.PDFDocument,
  content: CvContent,
  baseTemplate: TemplateDefinition,
  photo?: { buffer: Buffer; dimensions: ImageDimensions },
): void {
  // Automatic spacing: the SAME density decision profile-document.tsx's
  // preview reaches for this exact content (estimateProfileDensity is a
  // pure function of content/template/hasPhoto, shared verbatim — see its
  // own doc comment) is applied here before any layout happens, so a
  // sparse CV gets slightly larger body text and looser spacing, a dense
  // one gets moderately tighter spacing, and everything below this line
  // (which only ever reads `t`, never `baseTemplate`) automatically uses
  // the adjusted tokens without needing its own separate logic. Margins,
  // colors, and name/heading/job-title sizes are untouched by density (see
  // applyProfileDensity), so the cap/photo geometry and page margins fixed
  // in the previous session are unaffected.
  const density = estimateProfileDensity(content, baseTemplate, !!photo);
  const t = applyProfileDensity(baseTemplate, density);
  const lm = t.margins.left;
  const pageW = doc.page.width - lm - t.margins.right;
  const { personalDetails: pd } = content;
  const candidateName = pd.fullName || 'CV';

  const sidebarRatio = t.sidebarWidthRatio ?? 0.3;
  const gap = t.spacing.sectionGap;
  // Fix (RABBIT_NOTEBOOK.md, sidebar left-inset rebalance): Personal
  // Details/Skills/Languages/Qualities previously started at `sidebarX =
  // lm` (the page's own 40pt margin — the SAME margin the plain white main
  // column uses), which read as an excessive gap given the sidebar's own
  // colored background already visually anchors the page's left edge (it
  // bleeds all the way to the true x=0 — see the rect().fill() below).
  // SIDEBAR_INSET gives the sidebar's own content a smaller, purely
  // cosmetic left inset (target ~20-24pt) independent of `lm`, which
  // remains the real page margin for everything else (the main column's
  // own edges, the continuation header, top/bottom/right margins).
  // `sidebarW` (the actual usable TEXT width) is UNCHANGED — this only
  // moves where that same-width column starts, it does not additionally
  // narrow it — so `sidebarX` moving left by (lm - SIDEBAR_INSET) shrinks
  // the sidebar's own visual footprint (sidebarBleedRight) by that exact
  // amount, and `mainW` grows by the same amount: recovered width goes
  // entirely to the main column, never by shrinking sidebar text.
  const SIDEBAR_INSET = 22;
  const sidebarW = pageW * sidebarRatio - gap / 2;
  const mainW = pageW - sidebarW - gap + (lm - SIDEBAR_INSET);
  const sidebarX = SIDEBAR_INSET;
  const mainX = SIDEBAR_INSET + sidebarW + gap;
  const sidebarBleedRight = mainX - gap / 2;

  // Pale sidebar background, full page-1 height — bleeds to the physical
  // page edge (x=0), same convention as Modern's tinted sidebar.
  doc
    .rect(0, 0, sidebarBleedRight, doc.page.height)
    .fillColor(t.sidebarBackground ?? '#F4F5F6')
    .fill();

  // The cap (and any photo) only exists in the sidebar column — the main
  // column has no header of its own, so it must start at the page's own
  // top margin, not below the cap. Fix: both passes previously started at
  // `contentTop0` (the sidebar's own start, below the cap/photo), which
  // pushed the ENTIRE main column down by the cap's full height, leaving a
  // large blank gap above "Profile" even though nothing in the main
  // column needed that space. `mainContentTop0` is deliberately a
  // separate value — see the main pass below.
  const contentTop0 = drawCap(doc, candidateName, pd.jobTitle, sidebarBleedRight, t, photo);
  const mainContentTop0 = t.margins.top;

  // Only ever read by *EnsureSpace's page-overflow branches, which never
  // trigger for page index 0 (both passes explicitly set their own page-0
  // starting `doc.y` below) — this map only ever needs to record where a
  // shared CONTINUATION page (index >= 1) starts.
  const pageContentTop = new Map<number, number>();

  const order = resolveSectionOrder(content.sectionOrder);
  const sidebarSet = new Set(t.sidebarSections ?? []);
  const sidebarSections = order.filter((s) => sidebarSet.has(s));
  const mainSections = order.filter((s) => !sidebarSet.has(s));

  // ── Sidebar pass — its own local cursor, may span multiple pages ──────
  doc.y = contentTop0;
  let sidebarPageIndex = 0;
  // Fix (RABBIT_NOTEBOOK.md, References/continuation pagination):
  // `ensureSpace` now returns whether IT caused a page break, so callers
  // that need to react to a fresh page (the References "— continued"
  // marker below) can tell without any separate page-index bookkeeping of
  // their own. Every existing caller that doesn't need this simply ignores
  // the return value — a non-breaking widening of the callback shape.
  const sidebarEnsureSpace = (needed: number): boolean => {
    const spaceLeft = doc.page.height - t.margins.bottom - doc.y;
    const pageContentHeight = doc.page.height - t.margins.top - t.margins.bottom;
    if (needed > spaceLeft && needed <= pageContentHeight) {
      const nextIndex = sidebarPageIndex + 1;
      const total = doc.bufferedPageRange().count;
      if (nextIndex < total) {
        doc.switchToPage(nextIndex);
      } else {
        doc.addPage();
      }
      sidebarPageIndex = nextIndex;
      let top = pageContentTop.get(nextIndex);
      if (top === undefined) {
        top = drawContinuationHeader(doc, candidateName, lm, pageW, t);
        pageContentTop.set(nextIndex, top);
        // Fix (RABBIT_NOTEBOOK.md, References/continuation pagination):
        // PDFKit previously never painted the sidebar's pale tint on any
        // continuation page — only page 1's rect(0,0,...) at the very top
        // of this function ever painted it, so a page the sidebar itself
        // overflowed onto rendered with a plain white left column,
        // silently dropping the template's own visual identity there.
        // This is reached ONLY when the SIDEBAR pass itself is the one
        // creating this page (sidebar content genuinely continues here),
        // so it never tints a page that turns out to have no sidebar
        // content — matching profile-document.tsx's own
        // `sidebarStillActive`-gated continuation tint exactly (see its
        // buildProfileCss doc comment: "ordinary margin-inset background,
        // not bled" — this rect starts at `sidebarX`, not bled to the
        // true x=0 the way page 1's rect is, and stops at
        // `sidebarBleedRight` on the right, same as page 1's own content
        // area). Painted BEFORE anything else touches this page, so it
        // sits behind the continuation header/sidebar text drawn after it.
        doc
          .rect(
            sidebarX,
            top,
            sidebarBleedRight - sidebarX,
            doc.page.height - t.margins.bottom - top,
          )
          .fillColor(t.sidebarBackground ?? '#F4F5F6')
          .fill();
        doc.fillColor(t.colors.text);
      }
      doc.y = top;
      return true;
    }
    return false;
  };

  renderPersonalDetails(doc, pd, sidebarX, sidebarW, t, sidebarEnsureSpace);
  for (const section of sidebarSections) {
    renderSidebarSection(doc, content, section, sidebarX, sidebarW, t, sidebarEnsureSpace);
  }
  renderQualities(doc, content.qualities ?? [], sidebarX, sidebarW, t, sidebarEnsureSpace);
  const sidebarMaxPageIndex = sidebarPageIndex;

  // ── Main pass — independent cursor, starts at the page's own top
  // margin on page 0 (mainContentTop0 — NOT contentTop0, which is below
  // the sidebar's cap; the main column has no cap of its own). Shares any
  // continuation page the sidebar already created (same mainX/mainW while
  // doing so).
  // Fix (RABBIT_NOTEBOOK.md, References/continuation pagination): this
  // used to widen `column` to the full page width once
  // `mainPageIndex > sidebarMaxPageIndex` (sidebar finished, so "nothing
  // left to share the row with") — but that made main content visibly
  // jump from the aligned two-column position on page 1 to the page's own
  // left margin on a later page, exactly the reported "abruptly switches
  // to the far-left margin" bug. `column` now stays at mainX/mainW on
  // EVERY page, matching profile-document.tsx's own preview (its
  // `.cvpf-main` keeps the same flex-basis regardless of whether the
  // sidebar column is present on that page — see its own render logic) —
  // continuation-page main content always stays aligned with page 1's
  // main column, even on a page where the sidebar has nothing left to
  // show. ─────────────────────────────────────────────────────────
  doc.switchToPage(0);
  doc.y = mainContentTop0;
  const column: ProfileColumn = { x: mainX, width: mainW };
  let mainPageIndex = 0;
  const mainEnsureSpace = (needed: number): boolean => {
    const spaceLeft = doc.page.height - t.margins.bottom - doc.y;
    const pageContentHeight = doc.page.height - t.margins.top - t.margins.bottom;
    if (needed > spaceLeft && needed <= pageContentHeight) {
      const nextIndex = mainPageIndex + 1;
      const total = doc.bufferedPageRange().count;
      let top = pageContentTop.get(nextIndex);
      if (nextIndex < total) {
        doc.switchToPage(nextIndex);
      } else {
        doc.addPage();
      }
      if (top === undefined) {
        top = drawContinuationHeader(doc, candidateName, lm, pageW, t);
        pageContentTop.set(nextIndex, top);
      }
      mainPageIndex = nextIndex;
      doc.y = top;
      return true;
    }
    return false;
  };

  for (const section of mainSections) {
    renderMainSection(doc, content, section, column, t, mainEnsureSpace);
  }

  // Leave the reader on the LAST page overall, not wherever the two
  // independent passes happened to finish — PDFKit appends any further
  // top-level content (there is none here, but this is the same
  // convention every other template's render method leaves the doc in)
  // to whatever page is "current" when generateStream calls doc.end().
  const lastPageIndex = Math.max(sidebarMaxPageIndex, mainPageIndex);
  doc.switchToPage(lastPageIndex);
  doc.fillColor(t.colors.text);
}

// ── Cap + photo ────────────────────────────────────────────────────────

function profileNameFontSize(
  doc: PDFKit.PDFDocument,
  name: string,
  width: number,
  baseSize: number,
): number {
  let size = baseSize;
  while (size > PROFILE_NAME_FLOOR_SIZE) {
    doc.font('Heading').fontSize(size);
    const lines = Math.round(doc.heightOfString(name, { width }) / doc.currentLineHeight());
    if (lines <= 3) return size;
    size -= PROFILE_NAME_STEP;
  }
  return PROFILE_NAME_FLOOR_SIZE;
}

/** Draws the sidebar's blue "cap" (name + optional job title, curved
 *  bottom edge, optional overlapping circular photo) and returns the y
 *  coordinate the SIDEBAR column should start its own content at on page
 *  1 — chosen so neither the curve's deepest point nor an overlapping
 *  photo's bottom edge is ever encroached on. The main column does NOT
 *  use this return value (it has no cap of its own — see renderProfileTemplate's
 *  mainContentTop0). */
function drawCap(
  doc: PDFKit.PDFDocument,
  candidateName: string,
  jobTitle: string | undefined,
  capWidth: number,
  t: TemplateDefinition,
  photo?: { buffer: Buffer; dimensions: ImageDimensions },
): number {
  const textWidth = capWidth - CAP_PADDING_X * 2;
  const nameSize = profileNameFontSize(doc, candidateName, textWidth, t.typography.nameSize);

  doc.font('Heading').fontSize(nameSize);
  const nameH = doc.heightOfString(candidateName, { width: textWidth, align: 'center' });

  let titleH = 0;
  if (jobTitle) {
    doc.font('Body').fontSize(t.typography.jobTitleSize);
    titleH = doc.heightOfString(jobTitle, { width: textWidth, align: 'center' });
  }

  const textBottom = CAP_PADDING_TOP + nameH + (titleH > 0 ? 5 + titleH : 0);
  // With a photo, the cap must reserve enough room for the photo's own top
  // edge (it's centered at capFlatHeight, PHOTO_OUTER_RADIUS above that
  // point) to clear the text — see PHOTO_TEXT_CLEARANCE's doc comment.
  // Without a photo this is unchanged from before the fix.
  const capFlatHeight = photo
    ? textBottom + PHOTO_OUTER_RADIUS + PHOTO_TEXT_CLEARANCE
    : textBottom + CAP_PADDING_BOTTOM;

  const capColor = t.colors.headerBackground ?? t.colors.accent;
  const capTextColor = t.colors.headerText ?? '#FFFFFF';
  const capMutedColor = t.colors.headerMutedText ?? '#FFFFFF';

  // Curved-bottom cap shape — see this module's own doc comment for why
  // this is the PDFKit equivalent of the CSS "wave header" trick.
  doc
    .moveTo(0, 0)
    .lineTo(capWidth, 0)
    .lineTo(capWidth, capFlatHeight)
    .quadraticCurveTo(capWidth / 2, capFlatHeight + CURVE_DEPTH * 2, 0, capFlatHeight)
    .closePath()
    .fillColor(capColor)
    .fill();

  doc.y = CAP_PADDING_TOP;
  doc
    .font('Heading')
    .fontSize(nameSize)
    .fillColor(capTextColor)
    .text(candidateName, CAP_PADDING_X, doc.y, { width: textWidth, align: 'center' });

  if (titleH > 0) {
    doc.y += 5;
    doc
      .font('Body')
      .fontSize(t.typography.jobTitleSize)
      .fillColor(capMutedColor)
      .text(jobTitle as string, CAP_PADDING_X, doc.y, {
        width: textWidth,
        align: 'center',
        characterSpacing: 0.2,
      });
  }

  let contentTop = capFlatHeight + CURVE_DEPTH + GAP_AFTER_CAP;

  if (photo) {
    const cx = capWidth / 2;
    const cy = capFlatHeight;
    drawCircularPhoto(doc, photo, cx, cy);
    contentTop = Math.max(contentTop, cy + PHOTO_OUTER_RADIUS + PHOTO_BOTTOM_GAP);
  }

  doc.fillColor(t.colors.text);
  return contentTop;
}

/** Draws a white ring then the photo cropped ("cover", never stretched)
 *  into a circular clip, using the photo's real pixel dimensions computed
 *  by CvPhotoService/image-validation.util — the same "cover" math CSS
 *  `object-fit: cover` performs for the browser preview's <img>, biased
 *  vertically by PHOTO_VERTICAL_BIAS (matching the browser side's
 *  `object-position: 50% 22%`) so the crop window favors the top of the
 *  image rather than cutting off the crown of the head. */
function drawCircularPhoto(
  doc: PDFKit.PDFDocument,
  photo: { buffer: Buffer; dimensions: ImageDimensions },
  cx: number,
  cy: number,
): void {
  const innerRadius = PHOTO_OUTER_RADIUS - PHOTO_RING_THICKNESS;

  doc.save();
  doc.circle(cx, cy, PHOTO_OUTER_RADIUS).fillColor('#FFFFFF').fill();

  doc.save();
  doc.circle(cx, cy, innerRadius).clip();
  const { width, height } = photo.dimensions;
  const boxSize = innerRadius * 2;
  const scale = Math.max(boxSize / width, boxSize / height);
  const drawW = width * scale;
  const drawH = height * scale;
  // CSS Object Fit spec's object-position formula: offset = position% *
  // (boxSize - scaledSize). Horizontal stays centered (50%); vertical is
  // biased toward the top via PHOTO_VERTICAL_BIAS — see its own doc
  // comment. At 0.5 this reduces to the previous pure-centering behavior.
  const drawX = cx - innerRadius + 0.5 * (boxSize - drawW);
  const drawY = cy - innerRadius + PHOTO_VERTICAL_BIAS * (boxSize - drawH);
  doc.image(photo.buffer, drawX, drawY, { width: drawW, height: drawH });
  doc.restore();

  doc.restore();
}

// ── Continuation header (shared by both sidebar/main pagination) ───────

function drawContinuationHeader(
  doc: PDFKit.PDFDocument,
  candidateName: string,
  lm: number,
  pageW: number,
  t: TemplateDefinition,
): number {
  doc.y = t.margins.top;
  doc
    .font('Heading')
    .fontSize(t.typography.metaSize + 1)
    .fillColor(t.colors.heading)
    .text(candidateName.toUpperCase(), lm, doc.y, { width: pageW, characterSpacing: 0.6 });
  const ruleY = doc.y + 5;
  doc
    .moveTo(lm, ruleY)
    .lineTo(lm + 36, ruleY)
    .lineWidth(1.2)
    .strokeColor(t.colors.accent)
    .stroke();
  doc.fillColor(t.colors.text);
  return ruleY + 16;
}

// ── Shared heading treatment: 'thin-blue-rule' ──────────────────────────

function profileHeading(
  doc: PDFKit.PDFDocument,
  label: string,
  x: number,
  width: number,
  t: TemplateDefinition,
): void {
  doc
    .font('Body')
    .fontSize(t.typography.headingSize)
    .fillColor(t.colors.heading)
    .text(label, x, doc.y, { width });
  const ruleY = doc.y + 3;
  doc
    .moveTo(x, ruleY)
    .lineTo(x + width, ruleY)
    .lineWidth(0.75)
    .strokeColor(t.colors.rule)
    .stroke();
  doc.y = ruleY + 8;
  doc.fillColor(t.colors.text);
}

// ── Small, generic pictograms — never a reproduction of any brand's logo
// (see profile-document.tsx's identical browser-side icons for the same
// abstract shapes: envelope, phone bar, map pin, chain link, globe,
// pennant flag). ─────────────────────────────────────────────────────────

function drawIcon(
  doc: PDFKit.PDFDocument,
  type: IconType,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  doc.save();
  doc.lineWidth(0.8).strokeColor(color).fillColor(color);
  switch (type) {
    case 'email':
      doc.rect(x, y, size, size * 0.72).stroke();
      doc
        .moveTo(x, y)
        .lineTo(x + size / 2, y + size * 0.45)
        .lineTo(x + size, y)
        .stroke();
      break;
    case 'phone': {
      const cx = x + size / 2;
      const cy = y + size / 2;
      doc.save();
      doc.translate(cx, cy);
      doc.rotate(-45);
      doc.roundedRect(-size * 0.14, -size * 0.5, size * 0.28, size, size * 0.14).fill();
      doc.restore();
      break;
    }
    case 'location':
      doc.circle(x + size / 2, y + size * 0.32, size * 0.3).fill();
      doc
        .polygon(
          [x + size * 0.2, y + size * 0.5],
          [x + size * 0.8, y + size * 0.5],
          [x + size / 2, y + size],
        )
        .fill();
      break;
    case 'link':
      doc.roundedRect(x, y + size * 0.28, size * 0.42, size * 0.32, size * 0.15).stroke();
      doc
        .roundedRect(x + size * 0.5, y + size * 0.28, size * 0.42, size * 0.32, size * 0.15)
        .stroke();
      doc
        .moveTo(x + size * 0.35, y + size * 0.44)
        .lineTo(x + size * 0.65, y + size * 0.44)
        .stroke();
      break;
    case 'globe':
      doc.circle(x + size / 2, y + size / 2, size * 0.45).stroke();
      doc.ellipse(x + size / 2, y + size / 2, size * 0.2, size * 0.45).stroke();
      doc
        .moveTo(x, y + size / 2)
        .lineTo(x + size, y + size / 2)
        .stroke();
      break;
    case 'flag':
      doc
        .moveTo(x + size * 0.15, y)
        .lineTo(x + size * 0.15, y + size)
        .stroke();
      doc
        .polygon(
          [x + size * 0.15, y + size * 0.08],
          [x + size * 0.85, y + size * 0.28],
          [x + size * 0.15, y + size * 0.5],
        )
        .fill();
      break;
  }
  doc.restore();
}

// ── Sidebar sections ─────────────────────────────────────────────────────

// Contact rows never wrap to a second line — a wrapped/broken email reads
// worse than a slightly smaller one. Floor is a hard, absolute minimum
// (not proportional to the row's own tier-adjusted size) so "keep it
// readable" means the same thing regardless of density tier.
const CONTACT_TEXT_FLOOR_SIZE = 7.5;

/**
 * Fix (superseding an earlier line-wrapping attempt — see RABBIT_NOTEBOOK.md
 * for that history): a contact value with no spaces (typically an email or
 * a shortened URL label) previously either produced PDFKit's own arbitrary
 * character-position wrap ("...ac.u" / "k") or, with a forced line break
 * inserted, was two lines instead of the single-line presentation this
 * template's sidebar rows are meant to have. This instead keeps the row on
 * ONE line always: if it already fits at `baseSize` (the row's normal
 * font size), use that; otherwise shrink — directly, by the same ratio
 * `maxWidth` is short by, corrected with one verifying re-measure rather
 * than an arbitrary step size — down to (but never below)
 * `CONTACT_TEXT_FLOOR_SIZE`. Sets the size on `doc` as a side effect (the
 * caller draws immediately after with the same font already selected);
 * returns the resolved size so the caller can also measure height at it.
 */
function contactTextFontSize(
  doc: PDFKit.PDFDocument,
  text: string,
  maxWidth: number,
  baseSize: number,
): number {
  doc.font('Body').fontSize(baseSize);
  const naturalWidth = doc.widthOfString(text);
  if (naturalWidth <= maxWidth) return baseSize;

  let size = Math.max(CONTACT_TEXT_FLOOR_SIZE, baseSize * (maxWidth / naturalWidth));
  doc.font('Body').fontSize(size);
  // Font metrics don't scale perfectly linearly (kerning/hinting), so the
  // direct proportional estimate can land fractionally over — one small
  // corrective pass covers that without resorting to a coarse step loop.
  if (doc.widthOfString(text) > maxWidth && size > CONTACT_TEXT_FLOOR_SIZE) {
    size = Math.max(CONTACT_TEXT_FLOOR_SIZE, size - 0.3);
    doc.font('Body').fontSize(size);
  }
  return size;
}

function renderPersonalDetails(
  doc: PDFKit.PDFDocument,
  pd: CvContent['personalDetails'],
  x: number,
  width: number,
  t: TemplateDefinition,
  ensureSpace: (needed: number) => boolean,
): void {
  const iconSize = 9;
  const textX = x + iconSize + 7;
  const textWidth = width - iconSize - 7;
  const baseSize = t.typography.bodySize - 0.6;

  // Fix (RABBIT_NOTEBOOK.md, "Improve LinkedIn address rendering"): `wrap`
  // is true only for the LinkedIn row — every other row keeps the existing
  // single-line, shrink-to-fit, ellipsis-truncated behavior unchanged. A
  // wrap row's `text` is the full, untruncated label (`formatLinkedInLabel`
  // — no ellipsis) and is measured/drawn WITHOUT `lineBreak: false`, so
  // PDFKit wraps it naturally within `textWidth` instead of shrinking or
  // clipping it; continuation lines land aligned with the first line for
  // free (both stay within the same `textX`/`textWidth` column). `url`
  // still comes from the untruncated raw value via normalizeExternalUrl —
  // unaffected by the display label, so the link target is unaffected too.
  const rows: Array<{ icon: IconType; text: string; url?: string; wrap?: boolean }> = [];
  if (pd.email) rows.push({ icon: 'email', text: pd.email });
  if (pd.phone) rows.push({ icon: 'phone', text: pd.phone });
  if (pd.location) rows.push({ icon: 'location', text: pd.location });
  if (pd.linkedIn) {
    rows.push({
      icon: 'link',
      text: formatLinkedInLabel(pd.linkedIn),
      url: normalizeExternalUrl(pd.linkedIn),
      wrap: true,
    });
  }
  if (pd.website) {
    rows.push({
      icon: 'globe',
      text: shortenUrlLabel(pd.website, 26),
      url: normalizeExternalUrl(pd.website),
    });
  }
  if (pd.nationality) rows.push({ icon: 'flag', text: pd.nationality });
  if (!rows.length) return;

  ensureSpace(40);
  profileHeading(doc, 'Personal Details', x, width, t);

  rows.forEach((row, i) => {
    const size = row.wrap ? baseSize : contactTextFontSize(doc, row.text, textWidth, baseSize);
    // Fix: wrapped rows measure/draw WITH wrapping (no `lineBreak: false`)
    // so `h`/the drawn text both reflect the real, possibly multi-line
    // height BEFORE `ensureSpace` reserves room for it — accounting for
    // wrapped text height in pagination, not just in the drawn output.
    const h = row.wrap
      ? doc.heightOfString(row.text, { width: textWidth })
      : doc.heightOfString(row.text, { width: textWidth, lineBreak: false });
    ensureSpace(h + 8);
    const rowY = doc.y;
    drawIcon(doc, row.icon, x, rowY + 0.5, iconSize, t.colors.accent);
    doc
      .font('Body')
      .fontSize(size)
      .fillColor(t.colors.text)
      .text(
        row.text,
        textX,
        rowY,
        row.wrap ? { width: textWidth } : { width: textWidth, lineBreak: false },
      );
    if (row.url) {
      // Wrapped rows: the clickable region covers the row's full
      // (multi-line) bounding box rather than just doc.widthOfString of a
      // single line, which would only cover part of a wrapped label.
      const linkWidth = row.wrap ? textWidth : doc.widthOfString(row.text);
      doc.link(textX, rowY, linkWidth, h, row.url);
    }
    doc.y = Math.max(doc.y, rowY + iconSize) + (i < rows.length - 1 ? 6 : 0);
  });
  doc.y += 12;
  doc.fillColor(t.colors.text);
}

function renderQualities(
  doc: PDFKit.PDFDocument,
  qualities: string[],
  x: number,
  width: number,
  t: TemplateDefinition,
  ensureSpace: (needed: number) => boolean,
): void {
  if (!qualities.length) return;

  ensureSpace(40);
  profileHeading(doc, 'Qualities', x, width, t);

  const markerSize = 4.5;
  const textX = x + markerSize + 7;
  const textWidth = width - markerSize - 7;

  qualities.forEach((q, i) => {
    doc.font('Body').fontSize(t.typography.bodySize - 0.5);
    const h = doc.heightOfString(q, { width: textWidth });
    ensureSpace(h + 6);
    const rowY = doc.y;
    doc
      .rect(x, rowY + 3, markerSize, markerSize)
      .fillColor(t.colors.accent)
      .fill();
    doc.fillColor(t.colors.text).text(q, textX, rowY, { width: textWidth });
    doc.y = Math.max(doc.y, rowY + h) + (i < qualities.length - 1 ? 5 : 0);
  });
  doc.y += 12;
}

const DOTS_AREA_WIDTH = 42;

function drawRatingDots(
  doc: PDFKit.PDFDocument,
  rating: number,
  x: number,
  y: number,
  color: string,
): void {
  const clamped = Math.max(1, Math.min(5, Math.round(rating)));
  const dotR = 2.4;
  const gap = 7;
  for (let i = 0; i < 5; i++) {
    const cx = x + i * gap;
    doc.circle(cx, y, dotR).lineWidth(0.7).strokeColor(color);
    if (i < clamped) {
      doc.fillColor(color).fillAndStroke(color, color);
    } else {
      doc.stroke();
    }
  }
}

function renderRatedList(
  doc: PDFKit.PDFDocument,
  title: string,
  entries: Array<CvSkillEntry | CvLanguageEntry>,
  x: number,
  width: number,
  t: TemplateDefinition,
  ensureSpace: (needed: number) => boolean,
): void {
  if (!entries.length) return;

  ensureSpace(40);
  profileHeading(doc, title, x, width, t);

  entries.forEach((e, i) => {
    const hasRating = typeof e.rating === 'number';
    const nameWidth = hasRating ? width - DOTS_AREA_WIDTH : width;
    const label = e.level && !hasRating ? `${e.name} · ${e.level}` : e.name;
    doc.font('Heading').fontSize(t.typography.bodySize - 0.5);
    const h = doc.heightOfString(label, { width: nameWidth });
    ensureSpace(h + 8);
    const rowY = doc.y;
    doc.fillColor(t.colors.text).text(label, x, rowY, { width: nameWidth });
    if (hasRating) {
      drawRatingDots(
        doc,
        e.rating as number,
        x + width - DOTS_AREA_WIDTH,
        rowY + h / 2 - 1,
        t.colors.accent,
      );
    }
    doc.y = Math.max(doc.y, rowY + h) + (i < entries.length - 1 ? 6 : 0);
  });
  doc.y += 12;
  doc.fillColor(t.colors.text);
}

function renderSidebarSection(
  doc: PDFKit.PDFDocument,
  content: CvContent,
  section: CvSection,
  x: number,
  width: number,
  t: TemplateDefinition,
  ensureSpace: (needed: number) => boolean,
): void {
  if (section === 'skills') {
    renderRatedList(doc, 'Skills', content.skills, x, width, t, ensureSpace);
  } else if (section === 'languages') {
    renderRatedList(doc, 'Languages', content.languages, x, width, t, ensureSpace);
  }
}

// ── Main-column sections ─────────────────────────────────────────────────

function dateColWidth(
  doc: PDFKit.PDFDocument,
  dateStr: string,
  t: TemplateDefinition,
  availableWidth: number,
): number {
  doc.font('Body').fontSize(t.typography.metaSize);
  return Math.min(doc.widthOfString(dateStr) + 4, availableWidth * 0.4);
}

function renderBullets(
  doc: PDFKit.PDFDocument,
  bullets: string[],
  x: number,
  width: number,
  t: TemplateDefinition,
): void {
  const filtered = bullets.filter((b) => b.trim());
  if (!filtered.length) return;
  doc.moveDown(0.35);
  doc.font('Body').fontSize(t.typography.bodySize);
  const bulletIndent = doc.widthOfString('•  ');
  filtered.forEach((b, i) => {
    if (i > 0) doc.y += t.spacing.bulletGap;
    const bulletY = doc.y;
    doc
      .font('Body')
      .fontSize(t.typography.bodySize)
      .fillColor(t.colors.text)
      .text('•', x + 4, bulletY, { lineBreak: false });
    doc.y = bulletY;
    doc.text(b, x + 4 + bulletIndent, bulletY, {
      width: width - 4 - bulletIndent,
      lineGap: t.spacing.lineGap - 1,
    });
  });
}

function renderWorkEntry(
  doc: PDFKit.PDFDocument,
  entry: CvWorkEntry,
  column: ProfileColumn,
  t: TemplateDefinition,
  ensureSpace: (needed: number) => boolean,
): void {
  const dateStr = formatDateRange(entry.startDate, entry.endDate, entry.current);
  const dateGap = dateStr ? 10 : 0;
  const dateColW = dateStr ? dateColWidth(doc, dateStr, t, column.width) : 0;
  const titleColW = column.width - dateColW - dateGap;
  const orgLine = entry.company + (entry.location ? ` · ${entry.location}` : '');

  doc.font('Heading').fontSize(t.typography.bodySize);
  const titleH = doc.heightOfString(entry.title, { width: titleColW });
  doc.font('Heading').fontSize(t.typography.bodySize - 0.3);
  const orgH = doc.heightOfString(orgLine, { width: column.width });
  doc.font('Body').fontSize(t.typography.bodySize);
  const bulletsH = entry.bullets
    .filter((b) => b.trim())
    .reduce(
      (acc, b) => acc + doc.heightOfString(b, { width: column.width - 20 }) + t.spacing.bulletGap,
      0,
    );
  const estimated = titleH + 2 + orgH + (bulletsH > 0 ? bulletsH + 6 : 0) + 12;
  ensureSpace(estimated);

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
      .text(dateStr, column.x + column.width - dateColW, rowY, { width: dateColW, align: 'right' });
    if (doc.y < afterTitle) doc.y = afterTitle;
  }

  doc.moveDown(0.1);
  doc
    .font('Heading')
    .fontSize(t.typography.bodySize - 0.3)
    .fillColor(t.colors.accent)
    .text(orgLine, column.x, doc.y, { width: column.width });

  renderBullets(doc, entry.bullets, column.x, column.width, t);

  doc.moveDown(0.75);
  doc.fillColor(t.colors.text);
}

function renderEducationEntry(
  doc: PDFKit.PDFDocument,
  entry: CvEducationEntry,
  column: ProfileColumn,
  t: TemplateDefinition,
  ensureSpace: (needed: number) => boolean,
): void {
  const dateStr = formatDateRange(entry.startDate, entry.endDate);
  const dateGap = dateStr ? 10 : 0;
  const dateColW = dateStr ? dateColWidth(doc, dateStr, t, column.width) : 0;
  const degColW = column.width - dateColW - dateGap;
  const degreeText = entry.field ? `${entry.degree} — ${entry.field}` : entry.degree;
  const instLine = entry.institution + (entry.location ? ` · ${entry.location}` : '');

  doc.font('Heading').fontSize(t.typography.bodySize);
  const degH = doc.heightOfString(degreeText, { width: degColW });
  doc.font('Heading').fontSize(t.typography.bodySize - 0.3);
  const instH = doc.heightOfString(instLine, { width: column.width });
  const gradeH = entry.grade ? t.typography.metaSize + 4 : 0;
  ensureSpace(degH + 2 + instH + gradeH + 12);

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
      .text(dateStr, column.x + column.width - dateColW, rowY, { width: dateColW, align: 'right' });
    if (doc.y < afterDeg) doc.y = afterDeg;
  }

  doc.moveDown(0.1);
  doc
    .font('Heading')
    .fontSize(t.typography.bodySize - 0.3)
    .fillColor(t.colors.accent)
    .text(instLine, column.x, doc.y, { width: column.width });

  if (entry.grade) {
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

function renderCertification(
  doc: PDFKit.PDFDocument,
  c: CvCertificationEntry,
  column: ProfileColumn,
  t: TemplateDefinition,
  ensureSpace: (needed: number) => boolean,
): void {
  doc.font('Heading').fontSize(t.typography.bodySize - 0.5);
  const nameH = doc.heightOfString(c.name, { width: column.width });
  const meta = [c.issuer, c.date].filter(Boolean).join(' · ');
  ensureSpace(nameH + (meta ? t.typography.metaSize + 4 : 0) + 10);

  doc
    .font('Heading')
    .fontSize(t.typography.bodySize - 0.5)
    .fillColor(t.colors.text)
    .text(c.name, column.x, doc.y, { width: column.width });
  if (meta) {
    doc.moveDown(0.05);
    doc
      .font('Body')
      .fontSize(t.typography.metaSize)
      .fillColor(t.colors.muted)
      .text(meta, column.x, doc.y, { width: column.width });
  }
  doc.moveDown(0.65);
}

/** Sums the SAME per-entry height formula `renderReferenceEntry` itself
 *  uses (nameH + orgH + relH + contactH + 12), plus `profileHeading`'s own
 *  exact height formula, so this estimate can never drift from what's
 *  actually drawn. Used ONLY to decide whether a References section is
 *  short enough to ever fit on a single page — see its one call site's
 *  own doc comment (RABBIT_NOTEBOOK.md, References/continuation
 *  pagination) for why. */
function measureReferencesHeight(
  doc: PDFKit.PDFDocument,
  refs: CvReferenceEntry[],
  availableUponRequest: boolean,
  width: number,
  t: TemplateDefinition,
): number {
  doc.font('Body').fontSize(t.typography.headingSize);
  const headingH = doc.heightOfString('References', { width }) + 3 + 8; // matches profileHeading's own ruleY(+3)/content-start(+8) geometry exactly

  if (availableUponRequest) {
    doc.font('Body').fontSize(t.typography.bodySize);
    const bodyH = doc.heightOfString('References available upon request.', {
      width,
      lineGap: t.spacing.lineGap,
    });
    // doc.currentLineHeight() reads PDFKit's own real line-height for the
    // font/size just selected above — matches what the real
    // `doc.moveDown(1.1)` call in the actual render path advances by,
    // rather than an independently-guessed constant.
    return headingH + bodyH + doc.currentLineHeight() * 1.1;
  }

  let h = headingH;
  for (const r of refs) {
    const orgLine = [r.jobTitle, r.company].filter(Boolean).join(', ');
    const contactLine = [r.email, r.phone].filter(Boolean).join('  ·  ');
    doc.font('Heading').fontSize(t.typography.bodySize);
    const nameH = doc.heightOfString(r.fullName, { width });
    const orgH = orgLine ? t.typography.bodySize + 2 : 0;
    const relH = r.relationship ? t.typography.metaSize + 2 : 0;
    const contactH = contactLine ? t.typography.metaSize + 2 : 0;
    h += nameH + orgH + relH + contactH + 12;
  }
  return h;
}

function renderReferenceEntry(
  doc: PDFKit.PDFDocument,
  entry: CvReferenceEntry,
  column: ProfileColumn,
  t: TemplateDefinition,
  ensureSpace: (needed: number) => boolean,
): void {
  const orgLine = [entry.jobTitle, entry.company].filter(Boolean).join(', ');
  const contactLine = [entry.email, entry.phone].filter(Boolean).join('  ·  ');

  doc.font('Heading').fontSize(t.typography.bodySize);
  const nameH = doc.heightOfString(entry.fullName, { width: column.width });
  const orgH = orgLine ? t.typography.bodySize + 2 : 0;
  const relH = entry.relationship ? t.typography.metaSize + 2 : 0;
  const contactH = contactLine ? t.typography.metaSize + 2 : 0;
  const brokeToNewPage = ensureSpace(nameH + orgH + relH + contactH + 12);
  // Fix (RABBIT_NOTEBOOK.md, References/continuation pagination): a
  // References list too long to keep together (see measureReferencesHeight's
  // call site) still splits safely between entries — but previously an
  // entry landing on a later page had NO heading or context above it at
  // all, since "References" itself was only ever drawn once, earlier, on
  // whatever page the list started on. Whenever THIS entry's own
  // ensureSpace call is what causes the break, draw a small
  // "References — continued" label first — same profileHeading treatment
  // as every other heading in this template, so it reads as a real,
  // intentional section marker rather than an orphaned entry.
  if (brokeToNewPage) {
    profileHeading(doc, 'References — continued', column.x, column.width, t);
  }

  doc
    .font('Heading')
    .fontSize(t.typography.bodySize)
    .fillColor(t.colors.text)
    .text(entry.fullName, column.x, doc.y, { width: column.width });
  if (orgLine) {
    doc.moveDown(0.1);
    doc
      .font('Heading')
      .fontSize(t.typography.bodySize - 0.3)
      .fillColor(t.colors.accent)
      .text(orgLine, column.x, doc.y, { width: column.width });
  }
  if (entry.relationship) {
    doc.moveDown(0.05);
    doc
      .font('Body')
      .fontSize(t.typography.metaSize)
      .fillColor(t.colors.muted)
      .text(entry.relationship, column.x, doc.y, { width: column.width });
  }
  if (contactLine) {
    doc.moveDown(0.05);
    doc
      .font('Body')
      .fontSize(t.typography.metaSize)
      .fillColor(t.colors.muted)
      .text(contactLine, column.x, doc.y, { width: column.width });
  }
  doc.moveDown(0.75);
  doc.fillColor(t.colors.text);
}

function renderMainSection(
  doc: PDFKit.PDFDocument,
  content: CvContent,
  section: CvSection,
  column: ProfileColumn,
  t: TemplateDefinition,
  ensureSpace: (needed: number) => boolean,
): void {
  switch (section) {
    case 'summary': {
      if (!content.summary) return;
      ensureSpace(60);
      profileHeading(doc, 'Profile', column.x, column.width, t);
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
    }
    case 'workExperience': {
      if (!content.workExperience.length) return;
      ensureSpace(60);
      profileHeading(doc, 'Employment', column.x, column.width, t);
      for (const e of content.workExperience) renderWorkEntry(doc, e, column, t, ensureSpace);
      break;
    }
    case 'education': {
      if (!content.education.length) return;
      ensureSpace(60);
      profileHeading(doc, 'Education', column.x, column.width, t);
      for (const e of content.education) renderEducationEntry(doc, e, column, t, ensureSpace);
      break;
    }
    case 'certifications': {
      if (!content.certifications.length) return;
      ensureSpace(60);
      profileHeading(doc, 'Certifications', column.x, column.width, t);
      for (const c of content.certifications) renderCertification(doc, c, column, t, ensureSpace);
      break;
    }
    case 'references': {
      const refs = content.references ?? [];
      const availableUponRequest = content.referencesAvailableUponRequest ?? false;
      if (!refs.length && !availableUponRequest) return;
      // Fix (RABBIT_NOTEBOOK.md, References/continuation pagination): a
      // References section short enough to ever fit on ONE page (heading
      // + every entry, or heading + the "available upon request"
      // sentence) is kept together as a single unit — reported bug: a
      // two-entry list split across pages with the heading left behind
      // and the second entry stranded at the page's own left margin.
      // `ensureSpace(totalH)` is a no-op if it already fits where we are;
      // otherwise it pushes the WHOLE section to a fresh page (its own
      // `needed <= pageContentHeight` guard is exactly "doesn't fit here,
      // but would fit on an empty page"). Deliberately bounded: a section
      // too long to ever fit on any single page (totalH > a full page's
      // content height) is EXCLUDED from this and falls through to the
      // plain `ensureSpace(60)` heading-only minimum instead (unchanged
      // from before) — it must still split safely between entries, which
      // `renderReferenceEntry`'s own per-entry ensureSpace (plus the
      // "References — continued" marker it now draws whenever ITS OWN
      // call is what causes a break) already handles correctly.
      const pageContentHeight = doc.page.height - t.margins.top - t.margins.bottom;
      const totalH = measureReferencesHeight(doc, refs, availableUponRequest, column.width, t);
      if (totalH <= pageContentHeight) {
        ensureSpace(totalH);
      } else {
        ensureSpace(60);
      }
      profileHeading(doc, 'References', column.x, column.width, t);
      if (availableUponRequest) {
        doc
          .font('Body')
          .fontSize(t.typography.bodySize)
          .fillColor(t.colors.text)
          .text('References available upon request.', column.x, doc.y, {
            width: column.width,
            lineGap: t.spacing.lineGap,
          });
        doc.moveDown(1.1);
      } else {
        for (const r of refs) renderReferenceEntry(doc, r, column, t, ensureSpace);
      }
      break;
    }
    default:
      break;
  }
}
