/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AnalysisDto } from '@/lib/analysisApi';
import { AnalysisResults } from './AnalysisResults';

// Required by React 19's `act` when not going through a testing-library
// helper that sets this automatically — same pattern already used by
// ProfileA4Preview.pagination.spec.tsx.
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * RABBIT_NOTEBOOK.md §49 — the analysis results page showed "ATS keyword
 * score: N%" directly beneath the much larger overall match score with no
 * explanation that the two are computed independently (see
 * AnalysisService.process()) and can reasonably differ — a real production
 * result (45/100 overall, 0% ATS keyword score) read as contradictory or
 * alarming without this context. This is a presentational-only fix; it does
 * not change either score's value.
 */

function baseAnalysis(overrides: Partial<AnalysisDto> = {}): AnalysisDto {
  return {
    id: 'a1',
    cvId: 'cv1',
    jobDescription: 'irrelevant for this test',
    matchScore: 45,
    suggestions: [],
    status: 'done',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderInto(container: HTMLElement, analysis: AnalysisDto): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<AnalysisResults analysis={analysis} />);
  });
  return root;
}

describe('AnalysisResults', () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container.remove();
  });

  it('(§49) explains that the ATS keyword score is separate from the match score when an ATS report is present', () => {
    const analysis = baseAnalysis({ atsReport: { atsScore: 0 } });
    root = renderInto(container, analysis);

    expect(container.textContent).toContain('ATS keyword score: 0%');
    expect(container.textContent).toContain('calculated separately from the match score above');
  });

  // Fix (RABBIT_NOTEBOOK.md §51): the original §49 wording ("exact keyword
  // matches only") was inaccurate — the underlying matcher recognises known
  // equivalent phrasings (aliases, version numbers) rather than doing a
  // literal string comparison — so the caption must not claim otherwise.
  it('(§51) no longer claims the score is based on "exact keyword matches only", and instead mentions recognised equivalent phrasings', () => {
    const analysis = baseAnalysis({ atsReport: { atsScore: 17 } });
    root = renderInto(container, analysis);

    expect(container.textContent).not.toContain('exact keyword matches only');
    expect(container.textContent).toContain('recognising common equivalent phrasings');
  });

  it('does not render the ATS explanation when there is no ATS report at all', () => {
    const analysis = baseAnalysis({ atsReport: undefined });
    root = renderInto(container, analysis);

    expect(container.textContent).not.toContain('ATS keyword score');
    expect(container.textContent).not.toContain('calculated separately');
  });
});
