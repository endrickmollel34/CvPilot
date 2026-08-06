'use client';

import { useState, useCallback } from 'react';
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

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const map: Record<SaveState, string> = {
    idle: '',
    saving: 'Saving…',
    saved: 'Saved ✓',
    error: 'Save failed',
  };
  const color: Record<SaveState, string> = {
    idle: '',
    saving: 'text-gray-400',
    saved: 'text-green-600',
    error: 'text-red-600',
  };
  return <span className={`text-xs ${color[state]}`}>{map[state]}</span>;
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
  return (
    <div className="border-b border-gray-200 last:border-0">
      <button
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
        onClick={onToggle}
      >
        <span className="text-sm font-medium text-gray-800">{SECTION_LABELS[section]}</span>
        <span className="text-xs text-gray-400">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1">
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

interface Props {
  cvId: string;
  initialContent: CvContent | null;
}

export function CvBuilderWorkspace({ cvId, initialContent }: Props) {
  const { getToken } = useAuth();
  const [content, setContent] = useState<CvContent>(initialContent ?? EMPTY_CONTENT);
  const [expandedSection, setExpandedSection] = useState<CvSection>('personalDetails' as CvSection);
  const [showMobilePreview, setShowMobilePreview] = useState(false);

  const saveFn = useCallback(
    async (c: CvContent) => {
      const token = await getToken();
      await updateCvContent(token!, cvId, c);
    },
    [getToken, cvId],
  );

  const saveState = useAutosave(content, saveFn, true);

  const sections = content.sectionOrder.length > 0 ? content.sectionOrder : ALL_SECTIONS;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <SaveIndicator state={saveState} />
        <button
          className="rounded bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 lg:hidden"
          onClick={() => setShowMobilePreview((p) => !p)}
        >
          {showMobilePreview ? 'Editor' : 'Preview'}
        </button>
      </div>

      {/* Split layout */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Editor panel */}
        <div
          className={`flex flex-col overflow-y-auto border-r border-gray-200 bg-white ${showMobilePreview ? 'hidden' : 'flex'} w-full lg:flex lg:w-2/5`}
        >
          {/* Personal details always first */}
          <div className="border-b border-gray-200">
            <button
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
              onClick={() =>
                setExpandedSection((s) =>
                  s === ('personalDetails' as CvSection)
                    ? ('' as CvSection)
                    : ('personalDetails' as CvSection),
                )
              }
            >
              <span className="text-sm font-medium text-gray-800">Personal Details</span>
              <span className="text-xs text-gray-400">
                {expandedSection === ('personalDetails' as CvSection) ? '▲' : '▼'}
              </span>
            </button>
            {expandedSection === ('personalDetails' as CvSection) && (
              <div className="px-4 pb-4 pt-1">
                <PersonalDetails
                  value={content.personalDetails}
                  onChange={(pd) => setContent((c) => ({ ...c, personalDetails: pd }))}
                />
              </div>
            )}
          </div>

          {sections.map((section) => (
            <SectionPanel
              key={section}
              section={section}
              content={content}
              expanded={expandedSection === section}
              onToggle={() =>
                setExpandedSection((s) => (s === section ? ('' as CvSection) : section))
              }
              onContentChange={setContent}
            />
          ))}
        </div>

        {/* Preview panel */}
        <div
          className={`overflow-y-auto bg-gray-50 p-6 ${showMobilePreview ? 'flex' : 'hidden'} flex-1 lg:flex`}
        >
          <div className="mx-auto w-full max-w-[210mm] rounded bg-white p-8 shadow-sm">
            <AtsClassic content={content} />
          </div>
        </div>
      </div>
    </div>
  );
}
