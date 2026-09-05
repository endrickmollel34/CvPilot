import { plainToInstance } from 'class-transformer';

import { CreateCoverLetterDto } from './create-cover-letter.dto';

// Regression test for the "Cover letter does not mention job title" retry
// exhaustion found in production: jobTitle/companyName previously had no
// trim step, so stray whitespace from a copy-pasted job title (e.g.
// "Backend Software Engineer " with a trailing space) survived into
// CoverLetterAiService's exact-substring validateOutput() check, which the
// generated letter's own punctuation could never satisfy — see
// create-cover-letter.dto.ts for the full explanation.
describe('CreateCoverLetterDto', () => {
  it('trims leading/trailing whitespace from jobTitle before validation', () => {
    const dto = plainToInstance(CreateCoverLetterDto, {
      cvId: '11111111-1111-1111-1111-111111111111',
      jobTitle: '  Backend Software Engineer  ',
      companyName: 'Acme Corp',
      jobDescription: 'a'.repeat(60),
    });

    expect(dto.jobTitle).toBe('Backend Software Engineer');
  });

  it('trims leading/trailing whitespace from companyName before validation', () => {
    const dto = plainToInstance(CreateCoverLetterDto, {
      cvId: '11111111-1111-1111-1111-111111111111',
      jobTitle: 'Backend Software Engineer',
      companyName: '  Acme Corp  ',
      jobDescription: 'a'.repeat(60),
    });

    expect(dto.companyName).toBe('Acme Corp');
  });

  it('does not alter a jobTitle/companyName with no surrounding whitespace', () => {
    const dto = plainToInstance(CreateCoverLetterDto, {
      cvId: '11111111-1111-1111-1111-111111111111',
      jobTitle: 'Backend Software Engineer',
      companyName: 'Acme Corp',
      jobDescription: 'a'.repeat(60),
    });

    expect(dto.jobTitle).toBe('Backend Software Engineer');
    expect(dto.companyName).toBe('Acme Corp');
  });
});
