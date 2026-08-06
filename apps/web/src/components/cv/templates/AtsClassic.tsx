import type {
  CvContent,
  CvWorkEntry,
  CvEducationEntry,
  CvSkillEntry,
  CvCertificationEntry,
} from '@cvpilot/shared';

function formatDateRange(start?: string, end?: string, current?: boolean): string {
  if (!start) return '';
  const fmt = (ym: string) => {
    const [y, m] = ym.split('-');
    if (!m) return y ?? '';
    const date = new Date(Number(y), Number(m) - 1);
    return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  };
  return `${fmt(start)} – ${current ? 'Present' : end ? fmt(end) : ''}`;
}

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="mt-5 border-b border-gray-800 pb-0.5">
      <h2 className="text-xs font-bold uppercase tracking-widest text-gray-800">{title}</h2>
    </div>
  );
}

function WorkEntries({ entries }: { entries: CvWorkEntry[] }) {
  if (!entries.length) return null;
  return (
    <>
      <SectionHeading title="Work Experience" />
      {entries.map((e) => (
        <div key={e.id} className="mt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-gray-900">{e.title}</span>
            <span className="shrink-0 text-xs text-gray-500">
              {formatDateRange(e.startDate, e.endDate, e.current)}
            </span>
          </div>
          <div className="text-sm text-gray-600">
            {e.company}
            {e.location ? `, ${e.location}` : ''}
          </div>
          {e.bullets.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
              {e.bullets.map((b, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="mt-1 shrink-0 text-gray-400">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </>
  );
}

function EducationEntries({ entries }: { entries: CvEducationEntry[] }) {
  if (!entries.length) return null;
  return (
    <>
      <SectionHeading title="Education" />
      {entries.map((e) => (
        <div key={e.id} className="mt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-gray-900">
              {e.degree}
              {e.field ? ` — ${e.field}` : ''}
            </span>
            <span className="shrink-0 text-xs text-gray-500">
              {formatDateRange(e.startDate, e.endDate)}
            </span>
          </div>
          <div className="text-sm text-gray-600">
            {e.institution}
            {e.location ? `, ${e.location}` : ''}
          </div>
          {e.grade && <div className="text-xs text-gray-500">{e.grade}</div>}
        </div>
      ))}
    </>
  );
}

function SkillsSection({ skills }: { skills: CvSkillEntry[] }) {
  if (!skills.length) return null;
  return (
    <>
      <SectionHeading title="Skills" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {skills.map((s) => (
          <span key={s.id} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
            {s.name}
            {s.level ? ` · ${s.level}` : ''}
          </span>
        ))}
      </div>
    </>
  );
}

function CertificationsSection({ certs }: { certs: CvCertificationEntry[] }) {
  if (!certs.length) return null;
  return (
    <>
      <SectionHeading title="Certifications" />
      {certs.map((c) => (
        <div key={c.id} className="mt-2">
          <span className="font-semibold text-gray-900">{c.name}</span>
          {c.issuer && <span className="text-sm text-gray-600"> · {c.issuer}</span>}
          {c.date && <span className="text-xs text-gray-500"> ({c.date})</span>}
        </div>
      ))}
    </>
  );
}

function renderSection(content: CvContent, section: CvContent['sectionOrder'][number]) {
  switch (section) {
    case 'summary':
      if (!content.summary) return null;
      return (
        <div key="summary">
          <SectionHeading title="Summary" />
          <p className="mt-2 text-sm leading-relaxed text-gray-700">{content.summary}</p>
        </div>
      );
    case 'workExperience':
      return <WorkEntries key="work" entries={content.workExperience} />;
    case 'education':
      return <EducationEntries key="edu" entries={content.education} />;
    case 'skills':
      return <SkillsSection key="skills" skills={content.skills} />;
    case 'languages':
      if (!content.languages.length) return null;
      return (
        <div key="languages">
          <SectionHeading title="Languages" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {content.languages.map((l) => (
              <span key={l.id} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                {l.name}
                {l.level ? ` · ${l.level}` : ''}
              </span>
            ))}
          </div>
        </div>
      );
    case 'certifications':
      return <CertificationsSection key="certs" certs={content.certifications} />;
    default:
      return null;
  }
}

export function AtsClassic({ content }: { content: CvContent }) {
  const { personalDetails: pd, sectionOrder } = content;

  return (
    <div className="font-['Georgia',serif] text-gray-900">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold">{pd.fullName || 'Your Name'}</h1>
        {pd.jobTitle && <p className="mt-0.5 text-sm text-gray-600">{pd.jobTitle}</p>}
        <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
          {pd.email && <span>{pd.email}</span>}
          {pd.phone && <span>{pd.phone}</span>}
          {pd.location && <span>{pd.location}</span>}
          {pd.linkedIn && <span>{pd.linkedIn}</span>}
          {pd.website && <span>{pd.website}</span>}
        </div>
      </div>

      {/* Sections in user-defined order */}
      {sectionOrder.map((section) => renderSection(content, section))}
    </div>
  );
}
