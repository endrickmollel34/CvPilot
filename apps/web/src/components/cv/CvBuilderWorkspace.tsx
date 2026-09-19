'use client';

import { useState, useCallback, useDeferredValue, useMemo, useRef, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';

import type { CvContent, CvSection, TemplateId } from '@cvpilot/shared';
import {
  ClassicCvDocument,
  CLASSIC_CSS,
  ModernCvDocument,
  MODERN_CSS,
  MinimalCvDocument,
  MINIMAL_CSS,
  ProfessionalCvDocument,
  PROFESSIONAL_CSS,
  CompactCvDocument,
  COMPACT_CSS,
  SignatureCvDocument,
  SIGNATURE_CSS,
  TEMPLATE_REGISTRY,
  DEFAULT_TEMPLATE_ID,
  resolveSectionOrder,
  estimateProfileDensity,
  PROFILE_TEMPLATE,
} from '@cvpilot/shared';
import { useAutosaveControls, type SaveState } from '@/hooks/useAutosave';
import { updateCvContent, updateCvTemplate, downloadCvPdf, getPhotoPreviewUrl } from '@/lib/cvApi';
import { PersonalDetails } from './sections/PersonalDetails';
import { Summary } from './sections/Summary';
import { WorkExperience } from './sections/WorkExperience';
import { Education } from './sections/Education';
import { Skills } from './sections/Skills';
import { Languages } from './sections/Languages';
import { Certifications } from './sections/Certifications';
import { References } from './sections/References';
import { Qualities } from './sections/Qualities';
import { PhotoUpload } from './PhotoUpload';
import { ProfileA4Preview } from './ProfileA4Preview';

// ─── Uncertainty stripping ────────────────────────────────────────────────────
// The AI prefill may inject "[?] " prefixes into extracted values.
// We strip them here before the content ever enters React state, so
// markers are never saved back to the database.

function strip(s: string): string {
  return s.startsWith('[?] ') ? s.slice(4) : s;
}

function stripOpt(s: string | undefined): string | undefined {
  return s ? strip(s) : s;
}

function stripUncertaintyPrefixes(content: CvContent): CvContent {
  const pd = content.personalDetails;
  return {
    ...content,
    personalDetails: {
      ...pd,
      fullName: strip(pd.fullName),
      email: strip(pd.email),
      phone: stripOpt(pd.phone),
      location: stripOpt(pd.location),
      linkedIn: stripOpt(pd.linkedIn),
      website: stripOpt(pd.website),
      jobTitle: stripOpt(pd.jobTitle),
      nationality: stripOpt(pd.nationality),
    },
    summary: stripOpt(content.summary),
    workExperience: content.workExperience.map((e) => ({
      ...e,
      company: strip(e.company),
      title: strip(e.title),
      location: stripOpt(e.location),
      startDate: strip(e.startDate),
      endDate: stripOpt(e.endDate),
      bullets: e.bullets.map(strip),
    })),
    education: content.education.map((e) => ({
      ...e,
      institution: strip(e.institution),
      degree: strip(e.degree),
      field: stripOpt(e.field),
      location: stripOpt(e.location),
      startDate: stripOpt(e.startDate),
      endDate: stripOpt(e.endDate),
      grade: stripOpt(e.grade),
    })),
    skills: content.skills.map((e) => ({
      ...e,
      name: strip(e.name),
      level: stripOpt(e.level),
    })),
    languages: content.languages.map((e) => ({
      ...e,
      name: strip(e.name),
      level: stripOpt(e.level),
    })),
    certifications: content.certifications.map((e) => ({
      ...e,
      name: strip(e.name),
      issuer: stripOpt(e.issuer),
      date: stripOpt(e.date),
      url: stripOpt(e.url),
    })),
  };
}

// ─── Section metadata ─────────────────────────────────────────────────────────

const SECTION_LABELS: Record<CvSection, string> = {
  summary: 'Summary',
  workExperience: 'Work Experience',
  education: 'Education',
  skills: 'Skills',
  languages: 'Languages',
  certifications: 'Certifications',
  references: 'References',
};

const ALL_SECTIONS: CvSection[] = [
  'summary',
  'workExperience',
  'education',
  'skills',
  'languages',
  'certifications',
  'references',
];

// Short selector taglines — presentation copy only, not a structural design
// token every renderer needs, so kept local to the web UI rather than in
// the shared TEMPLATE_REGISTRY (see TemplateDefinition.description for the
// longer help text shown once a template is selected).
const TEMPLATE_TAGLINES: Record<TemplateId, string> = {
  classic: 'Conservative · ATS-first',
  modern: 'Contemporary · Professional',
  minimal: 'Elegant · Highly readable',
  professional: 'Premium · Corporate',
  compact: 'Efficient · Content-rich',
  signature: 'Editorial · Sophisticated',
  profile: 'Personal · Two-column',
};

const EMPTY_CONTENT: CvContent = {
  version: 1,
  personalDetails: { fullName: '', email: '' },
  workExperience: [],
  education: [],
  skills: [],
  languages: [],
  certifications: [],
  references: [],
  referencesAvailableUponRequest: false,
  sectionOrder: ALL_SECTIONS,
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const label: Record<SaveState, string> = {
    idle: '',
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
  };
  const cls: Record<SaveState, string> = {
    idle: '',
    unsaved: 'text-amber-600',
    saving: 'text-gray-400',
    saved: 'text-green-600',
    error: 'text-red-600',
  };
  return (
    <span className={`text-xs ${cls[state]}`} aria-live="polite" aria-atomic="true">
      {label[state]}
    </span>
  );
}

function SectionPanel({
  section,
  content,
  expanded,
  onToggle,
  onContentChange,
  showRating,
}: {
  section: CvSection;
  content: CvContent;
  expanded: boolean;
  onToggle: () => void;
  onContentChange: (c: CvContent) => void;
  showRating: boolean;
}) {
  const panelId = `section-panel-${section}`;
  const headerId = `section-header-${section}`;

  return (
    <div className="border-b border-gray-200 last:border-0">
      <button
        id={headerId}
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-indigo-500"
        onClick={onToggle}
      >
        <span className="text-sm font-medium text-gray-800">{SECTION_LABELS[section]}</span>
        <span className="text-xs text-gray-400" aria-hidden="true">
          {expanded ? '▲' : '▼'}
        </span>
      </button>
      {expanded && (
        <div id={panelId} role="region" aria-labelledby={headerId} className="px-4 pb-4 pt-1">
          {section === 'summary' && (
            <Summary
              value={content.summary}
              onChange={(v) => onContentChange({ ...content, summary: v })}
            />
          )}
          {section === 'workExperience' && (
            <WorkExperience
              entries={content.workExperience}
              onChange={(entries) => onContentChange({ ...content, workExperience: entries })}
            />
          )}
          {section === 'education' && (
            <Education
              entries={content.education}
              onChange={(entries) => onContentChange({ ...content, education: entries })}
            />
          )}
          {section === 'skills' && (
            <Skills
              entries={content.skills}
              onChange={(entries) => onContentChange({ ...content, skills: entries })}
              showRating={showRating}
            />
          )}
          {section === 'languages' && (
            <Languages
              entries={content.languages}
              onChange={(entries) => onContentChange({ ...content, languages: entries })}
              showRating={showRating}
            />
          )}
          {section === 'certifications' && (
            <Certifications
              entries={content.certifications}
              onChange={(entries) => onContentChange({ ...content, certifications: entries })}
            />
          )}
          {section === 'references' && (
            <References
              entries={content.references ?? []}
              availableUponRequest={content.referencesAvailableUponRequest ?? false}
              onChange={(entries) => onContentChange({ ...content, references: entries })}
              onAvailableUponRequestChange={(value) =>
                onContentChange({ ...content, referencesAvailableUponRequest: value })
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Workspace ────────────────────────────────────────────────────────────────

interface Props {
  cvId: string;
  initialContent: CvContent | null;
  isPrefilled?: boolean;
  initialTemplateId?: TemplateId;
  /** Whether this CV already has a Profile-template photo (see
   *  CvEntity.photoObjectKey) — only its presence, never the key/URL
   *  itself, which is fetched separately via a short-lived signed URL. */
  initialHasPhoto?: boolean;
}

export function CvBuilderWorkspace({
  cvId,
  initialContent,
  isPrefilled = false,
  initialTemplateId = DEFAULT_TEMPLATE_ID,
  initialHasPhoto = false,
}: Props) {
  const { getToken } = useAuth();

  const [content, setContent] = useState<CvContent>(() => {
    const base = initialContent ?? EMPTY_CONTENT;
    return isPrefilled ? stripUncertaintyPrefixes(base) : base;
  });

  // Deferred value so the preview never blocks editor input.
  const deferredContent = useDeferredValue(content);

  // 'personalDetails'/'template' are not CvSections, so we use string | null.
  const [activePanel, setActivePanel] = useState<string>('personalDetails');
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');
  const [dlState, setDlState] = useState<'idle' | 'downloading' | 'error'>('idle');

  // Template selection is presentation metadata, persisted separately from
  // `content` via its own PATCH endpoint — never folded into the content
  // autosave (see cv.entity.ts's templateId doc comment for why).
  const [templateId, setTemplateId] = useState<TemplateId>(initialTemplateId);
  const [templateSaveState, setTemplateSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  // Guards against out-of-order PATCH /cvs/:id/template responses: if the
  // user picks template A then quickly picks template B before A's request
  // settles, A's (now-superseded) response must never be allowed to touch
  // state — otherwise a late failure for A can revert templateId back past
  // B's already-successful, already-persisted selection, desyncing the
  // preview/selector from what's actually saved. Only the response whose
  // requestId still matches the latest dispatched request is applied.
  const templateRequestRef = useRef(0);

  // Profile template's optional photo — only its presence lives in this
  // component's own state; the actual displayable image is always a
  // short-lived signed URL fetched fresh (see cv-photo.service.ts's own
  // doc comment on why a permanent public URL is never used).
  const [hasPhoto, setHasPhoto] = useState(initialHasPhoto);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  // Brief, optional template guidance for a short CV on Profile — the same
  // density tier decision that drives Profile's own automatic spacing
  // (profile-density.ts), reused here purely to decide whether to SHOW a
  // suggestion, never to act on it: this never changes templateId itself,
  // switching (or not) is entirely the user's own call via the template
  // picker below (handleTemplateChange), which already only ever PATCHes
  // templateId — content and hasPhoto are untouched by a template switch,
  // so nothing here needs to preserve anything extra on top of that.
  // Dismissal is per-CV, not persisted — it's a light nudge, not a
  // decision the app needs to remember forever.
  const [shortCvHintDismissed, setShortCvHintDismissed] = useState(false);
  const profileDensityTier = useMemo(
    () => estimateProfileDensity(content, PROFILE_TEMPLATE, hasPhoto).tier,
    [content, hasPhoto],
  );

  useEffect(() => {
    let cancelled = false;
    if (!hasPhoto || templateId !== 'profile') {
      setPhotoPreviewUrl(null);
      return;
    }
    void (async () => {
      try {
        const { previewUrl } = await getPhotoPreviewUrl(getToken, cvId);
        if (!cancelled) setPhotoPreviewUrl(previewUrl);
      } catch {
        if (!cancelled) setPhotoPreviewUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasPhoto, templateId, cvId, getToken]);

  async function handleTemplateChange(next: TemplateId) {
    const requestId = ++templateRequestRef.current;
    const previous = templateId;
    setTemplateId(next);
    setTemplateSaveState('saving');
    try {
      await updateCvTemplate(getToken, cvId, next);
      if (templateRequestRef.current === requestId) {
        setTemplateSaveState('saved');
      }
    } catch {
      if (templateRequestRef.current === requestId) {
        setTemplateId(previous);
        setTemplateSaveState('error');
      }
    }
  }

  const saveFn = useCallback(
    async (c: CvContent) => {
      await updateCvContent(getToken, cvId, c);
    },
    [getToken, cvId],
  );

  const { state: saveState, flush: flushAutosave } = useAutosaveControls(content, saveFn, true);

  async function handleDownload() {
    setDlState('downloading');
    try {
      await flushAutosave();
      const name = (content.personalDetails.fullName || 'cv').replace(/\s+/g, '_');
      await downloadCvPdf(getToken, cvId, `${name}.pdf`);
      setDlState('idle');
    } catch {
      setDlState('error');
    }
  }

  // Same resolution the preview/PDF renderers use (resolveSectionOrder,
  // @cvpilot/shared) — a CV saved before References existed has a
  // `sectionOrder` that simply doesn't mention it, so this appends it
  // rather than leaving it unreachable, without silently rewriting the
  // user's own chosen order for every other section. Using the identical
  // shared function (not a locally re-derived equivalent) is what
  // guarantees the editor's section list, the live preview, and the
  // downloaded PDF can never disagree about which sections exist.
  const sections = resolveSectionOrder(content.sectionOrder);

  const tabCls = (tab: 'edit' | 'preview') =>
    `flex-1 py-2 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-inset focus:ring-indigo-500 ${
      mobileTab === tab
        ? 'border-b-2 border-indigo-600 text-indigo-600'
        : 'text-gray-500 hover:text-gray-700'
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top bar: save indicator + download */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <SaveIndicator state={saveState} />
        <div className="flex items-center gap-3">
          {dlState === 'error' && (
            <span className="text-xs text-red-600">Download failed — try again</span>
          )}
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={dlState === 'downloading' || templateSaveState === 'saving'}
            aria-label="Download CV as PDF"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:opacity-50"
          >
            {dlState === 'downloading' ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {/* Mobile tab bar */}
      <div
        className="flex border-b border-gray-200 bg-white lg:hidden"
        role="tablist"
        aria-label="Builder view"
      >
        <button
          role="tab"
          type="button"
          aria-selected={mobileTab === 'edit'}
          onClick={() => setMobileTab('edit')}
          className={tabCls('edit')}
        >
          Edit
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={mobileTab === 'preview'}
          onClick={() => setMobileTab('preview')}
          className={tabCls('preview')}
        >
          Preview
        </button>
      </div>

      {/* Split layout */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Editor panel */}
        <div
          role="tabpanel"
          aria-label="CV editor"
          className={`flex w-full flex-col overflow-y-auto border-r border-gray-200 bg-white lg:flex lg:w-2/5 ${mobileTab === 'edit' ? 'flex' : 'hidden'}`}
        >
          {isPrefilled && (
            <div
              className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800"
              role="alert"
            >
              <strong>Extracted from your uploaded CV.</strong> Review every field carefully — AI
              extraction is approximate. Edit anything that looks wrong before saving.
            </div>
          )}

          {/* Personal Details accordion */}
          <div className="border-b border-gray-200">
            <button
              type="button"
              id="section-header-personalDetails"
              aria-expanded={activePanel === 'personalDetails'}
              aria-controls="section-panel-personalDetails"
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-indigo-500"
              onClick={() =>
                setActivePanel((p) => (p === 'personalDetails' ? '' : 'personalDetails'))
              }
            >
              <span className="text-sm font-medium text-gray-800">Personal Details</span>
              <span className="text-xs text-gray-400" aria-hidden="true">
                {activePanel === 'personalDetails' ? '▲' : '▼'}
              </span>
            </button>
            {activePanel === 'personalDetails' && (
              <div
                id="section-panel-personalDetails"
                role="region"
                aria-labelledby="section-header-personalDetails"
                className="px-4 pb-4 pt-1"
              >
                <PersonalDetails
                  value={content.personalDetails}
                  onChange={(pd) => setContent((c) => ({ ...c, personalDetails: pd }))}
                />
              </div>
            )}
          </div>

          {/* Template accordion — a small two-option card picker rather
              than a full thumbnail gallery/Content-Design split, since
              only Classic and Modern exist at this phase. Structured as
              its own titled section (same pattern as Personal Details) so
              a future "Design" panel with more controls (accent, font,
              spacing) can grow from here without restructuring the
              editor. */}
          <div className="border-b border-gray-200">
            <button
              type="button"
              id="section-header-template"
              aria-expanded={activePanel === 'template'}
              aria-controls="section-panel-template"
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-indigo-500"
              onClick={() => setActivePanel((p) => (p === 'template' ? '' : 'template'))}
            >
              <span className="text-sm font-medium text-gray-800">Template</span>
              <span className="text-xs text-gray-400" aria-hidden="true">
                {activePanel === 'template' ? '▲' : '▼'}
              </span>
            </button>
            {activePanel === 'template' && (
              <div
                id="section-panel-template"
                role="region"
                aria-labelledby="section-header-template"
                className="px-4 pb-4 pt-1"
              >
                <p className="mb-2 text-xs text-gray-500">Choose a template</p>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="CV template">
                  {Object.values(TEMPLATE_REGISTRY).map((t) => {
                    const selected = templateId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => void handleTemplateChange(t.id)}
                        className={`rounded border px-3 py-2 text-left focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                          selected
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-300 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <span className="block text-sm font-medium text-gray-800">{t.name}</span>
                        <span className="mt-0.5 block text-xs text-gray-500">
                          {TEMPLATE_TAGLINES[t.id]}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  {TEMPLATE_REGISTRY[templateId]?.description}
                </p>
                {templateId === 'profile' &&
                  profileDensityTier === 'sparse' &&
                  !shortCvHintDismissed && (
                    <div className="mt-2 flex items-start gap-2 rounded border border-indigo-100 bg-indigo-50 px-2.5 py-2 text-xs text-indigo-800">
                      <span className="flex-1">
                        This CV is on the shorter side — <strong>Classic</strong> or{' '}
                        <strong>Minimal</strong> (single-column, no sidebar to fill) can look great
                        with less content too, if you&apos;d like to try one. Profile works fine
                        as-is — this is just a suggestion, nothing changes unless you pick a
                        different template above.
                      </span>
                      <button
                        type="button"
                        onClick={() => setShortCvHintDismissed(true)}
                        aria-label="Dismiss suggestion"
                        className="shrink-0 text-indigo-400 hover:text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        ×
                      </button>
                    </div>
                  )}
                {templateSaveState === 'saving' && (
                  <p className="mt-1 text-xs text-gray-400">Saving…</p>
                )}
                {templateSaveState === 'error' && (
                  <p className="mt-1 text-xs text-red-600">Failed to save — try again</p>
                )}
              </div>
            )}
          </div>

          {/* Photo + Qualities — Profile-template-specific panels, shown
              only while Profile is selected (see PhotoUpload.tsx/
              Qualities.tsx's own doc comments). Neither is a CvSection, so
              they don't participate in `sections`/reordering. */}
          {templateId === 'profile' && (
            <div className="border-b border-gray-200">
              <button
                type="button"
                id="section-header-photo"
                aria-expanded={activePanel === 'photo'}
                aria-controls="section-panel-photo"
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-indigo-500"
                onClick={() => setActivePanel((p) => (p === 'photo' ? '' : 'photo'))}
              >
                <span className="text-sm font-medium text-gray-800">Photo</span>
                <span className="text-xs text-gray-400" aria-hidden="true">
                  {activePanel === 'photo' ? '▲' : '▼'}
                </span>
              </button>
              {activePanel === 'photo' && (
                <div
                  id="section-panel-photo"
                  role="region"
                  aria-labelledby="section-header-photo"
                  className="px-4 pb-4 pt-1"
                >
                  <PhotoUpload
                    cvId={cvId}
                    getToken={getToken}
                    hasPhoto={hasPhoto}
                    onChange={setHasPhoto}
                  />
                </div>
              )}
            </div>
          )}

          {templateId === 'profile' && (
            <div className="border-b border-gray-200">
              <button
                type="button"
                id="section-header-qualities"
                aria-expanded={activePanel === 'qualities'}
                aria-controls="section-panel-qualities"
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-indigo-500"
                onClick={() => setActivePanel((p) => (p === 'qualities' ? '' : 'qualities'))}
              >
                <span className="text-sm font-medium text-gray-800">Qualities</span>
                <span className="text-xs text-gray-400" aria-hidden="true">
                  {activePanel === 'qualities' ? '▲' : '▼'}
                </span>
              </button>
              {activePanel === 'qualities' && (
                <div
                  id="section-panel-qualities"
                  role="region"
                  aria-labelledby="section-header-qualities"
                  className="px-4 pb-4 pt-1"
                >
                  <Qualities
                    qualities={content.qualities ?? []}
                    onChange={(qualities) => setContent((c) => ({ ...c, qualities }))}
                  />
                </div>
              )}
            </div>
          )}

          {/* Remaining sections */}
          {sections.map((section) => (
            <SectionPanel
              key={section}
              section={section}
              content={content}
              expanded={activePanel === section}
              onToggle={() => setActivePanel((p) => (p === section ? '' : section))}
              onContentChange={setContent}
              showRating={templateId === 'profile'}
            />
          ))}
        </div>

        {/* Preview panel */}
        <div
          role="tabpanel"
          aria-label="CV preview"
          className={`flex-1 overflow-y-auto bg-gray-50 p-6 lg:flex ${mobileTab === 'preview' ? 'flex' : 'hidden'}`}
        >
          {templateId === 'profile' ? (
            // Profile gets its own dedicated A4-accurate preview chrome
            // (real 210x297mm proportions, uniform scale-to-fit, page-break
            // markers) instead of the generic card below — see
            // ProfileA4Preview.tsx's own doc comment. Scoped to this one
            // template; every other template keeps the original wrapper.
            <ProfileA4Preview content={deferredContent} photoUrl={photoPreviewUrl} />
          ) : (
            <div className="mx-auto w-full max-w-[210mm] self-start rounded bg-white p-8 shadow-sm">
              {/* CV Template Foundation: each template's React component +
                  CSS (@cvpilot/shared) reads the SAME typography/color/
                  spacing tokens (e.g. CLASSIC_TEMPLATE/MODERN_TEMPLATE) that
                  drive apps/api's matching PDFKit renderer — see
                  pdf-generation.service.ts. The two are separate rendering
                  implementations (PDFKit has no CSS/flexbox engine to
                  share), but can no longer silently drift on font/color/
                  spacing the way the pre-Phase-1 AtsClassic.tsx (Tailwind)
                  and pdf-generation.service.ts (hardcoded constants) did. */}
              {templateId === 'modern' ? (
                <>
                  <style dangerouslySetInnerHTML={{ __html: MODERN_CSS }} />
                  <ModernCvDocument content={deferredContent} />
                </>
              ) : templateId === 'minimal' ? (
                <>
                  <style dangerouslySetInnerHTML={{ __html: MINIMAL_CSS }} />
                  <MinimalCvDocument content={deferredContent} />
                </>
              ) : templateId === 'professional' ? (
                <>
                  <style dangerouslySetInnerHTML={{ __html: PROFESSIONAL_CSS }} />
                  <ProfessionalCvDocument content={deferredContent} />
                </>
              ) : templateId === 'compact' ? (
                <>
                  <style dangerouslySetInnerHTML={{ __html: COMPACT_CSS }} />
                  <CompactCvDocument content={deferredContent} />
                </>
              ) : templateId === 'signature' ? (
                <>
                  <style dangerouslySetInnerHTML={{ __html: SIGNATURE_CSS }} />
                  <SignatureCvDocument content={deferredContent} />
                </>
              ) : (
                <>
                  <style dangerouslySetInnerHTML={{ __html: CLASSIC_CSS }} />
                  <ClassicCvDocument content={deferredContent} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
