'use client';

import { useState, useCallback, useDeferredValue } from 'react';
import { useAuth } from '@clerk/nextjs';

import type { CvContent, CvSection } from '@cvpilot/shared';
import { useAutosave, type SaveState } from '@/hooks/useAutosave';
import { updateCvContent } from '@/lib/cvApi';
import { AtsClassic } from './templates/AtsClassic';
import { PersonalDetails } from './sections/PersonalDetails';
import { Summary } from './sections/Summary';
import { WorkExperience } from './sections/WorkExperience';
import { Education } from './sections/Education';
import { Skills } from './sections/Skills';
import { Languages } from './sections/Languages';
import { Certifications } from './sections/Certifications';

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
      fullName: strip(pd.fullName),
      email: strip(pd.email),
      phone: stripOpt(pd.phone),
      location: stripOpt(pd.location),
      linkedIn: stripOpt(pd.linkedIn),
      website: stripOpt(pd.website),
      jobTitle: stripOpt(pd.jobTitle),
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
};

const ALL_SECTIONS: CvSection[] = [
  'summary',
  'workExperience',
  'education',
  'skills',
  'languages',
  'certifications',
];

const EMPTY_CONTENT: CvContent = {
  version: 1,
  personalDetails: { fullName: '', email: '' },
  workExperience: [],
  education: [],
  skills: [],
  languages: [],
  certifications: [],
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
}: {
  section: CvSection;
  content: CvContent;
  expanded: boolean;
  onToggle: () => void;
  onContentChange: (c: CvContent) => void;
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
            />
          )}
          {section === 'languages' && (
            <Languages
              entries={content.languages}
              onChange={(entries) => onContentChange({ ...content, languages: entries })}
            />
          )}
          {section === 'certifications' && (
            <Certifications
              entries={content.certifications}
              onChange={(entries) => onContentChange({ ...content, certifications: entries })}
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
}

export function CvBuilderWorkspace({ cvId, initialContent, isPrefilled = false }: Props) {
  const { getToken } = useAuth();

  const [content, setContent] = useState<CvContent>(() => {
    const base = initialContent ?? EMPTY_CONTENT;
    return isPrefilled ? stripUncertaintyPrefixes(base) : base;
  });

  // Deferred value so the preview never blocks editor input.
  const deferredContent = useDeferredValue(content);

  // 'personalDetails' is not a CvSection, so we use string | null.
  const [activePanel, setActivePanel] = useState<string>('personalDetails');
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');

  const saveFn = useCallback(
    async (c: CvContent) => {
      const token = await getToken();
      await updateCvContent(token!, cvId, c);
    },
    [getToken, cvId],
  );

  const saveState = useAutosave(content, saveFn, true);

  const sections = content.sectionOrder.length > 0 ? content.sectionOrder : ALL_SECTIONS;

  const tabCls = (tab: 'edit' | 'preview') =>
    `flex-1 py-2 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-inset focus:ring-indigo-500 ${
      mobileTab === tab
        ? 'border-b-2 border-indigo-600 text-indigo-600'
        : 'text-gray-500 hover:text-gray-700'
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top bar: save indicator */}
      <div className="flex items-center border-b border-gray-200 bg-white px-4 py-2">
        <SaveIndicator state={saveState} />
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

          {/* Remaining sections */}
          {sections.map((section) => (
            <SectionPanel
              key={section}
              section={section}
              content={content}
              expanded={activePanel === section}
              onToggle={() => setActivePanel((p) => (p === section ? '' : section))}
              onContentChange={setContent}
            />
          ))}
        </div>

        {/* Preview panel */}
        <div
          role="tabpanel"
          aria-label="CV preview"
          className={`flex-1 overflow-y-auto bg-gray-50 p-6 lg:flex ${mobileTab === 'preview' ? 'flex' : 'hidden'}`}
        >
          <div className="mx-auto w-full max-w-[210mm] rounded bg-white p-8 shadow-sm">
            <AtsClassic content={deferredContent} />
          </div>
        </div>
      </div>
    </div>
  );
}
