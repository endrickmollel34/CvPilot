import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

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

  // V2 — recipientName/recipientTitle/companyAddress are new, optional
  // fields for the letterhead. They must be genuinely optional (a letter
  // with no known recipient must still validate) and, like jobTitle/
  // companyName above, must be trimmed before validation.
  it('accepts a submission with no recipientName, recipientTitle, or companyAddress', async () => {
    const dto = plainToInstance(CreateCoverLetterDto, {
      cvId: '11111111-1111-4111-8111-111111111111',
      jobTitle: 'Backend Software Engineer',
      companyName: 'Acme Corp',
      jobDescription: 'a'.repeat(60),
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.recipientName).toBeUndefined();
    expect(dto.recipientTitle).toBeUndefined();
    expect(dto.companyAddress).toBeUndefined();
  });

  it('accepts and trims recipientName, recipientTitle, and companyAddress when provided', async () => {
    const dto = plainToInstance(CreateCoverLetterDto, {
      cvId: '11111111-1111-4111-8111-111111111111',
      jobTitle: 'Backend Software Engineer',
      companyName: 'Acme Corp',
      jobDescription: 'a'.repeat(60),
      recipientName: '  Jane Smith  ',
      recipientTitle: '  Head of Engineering  ',
      companyAddress: '  1 Infinite Loop, Cupertino, CA  ',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.recipientName).toBe('Jane Smith');
    expect(dto.recipientTitle).toBe('Head of Engineering');
    expect(dto.companyAddress).toBe('1 Infinite Loop, Cupertino, CA');
  });

  // V2.1 — senderAddress: optional, never required to submit a letter.
  it('accepts a submission with no senderAddress', async () => {
    const dto = plainToInstance(CreateCoverLetterDto, {
      cvId: '11111111-1111-4111-8111-111111111111',
      jobTitle: 'Backend Software Engineer',
      companyName: 'Acme Corp',
      jobDescription: 'a'.repeat(60),
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.senderAddress).toBeUndefined();
  });

  it('accepts and trims senderAddress when provided', async () => {
    const dto = plainToInstance(CreateCoverLetterDto, {
      cvId: '11111111-1111-4111-8111-111111111111',
      jobTitle: 'Backend Software Engineer',
      companyName: 'Acme Corp',
      jobDescription: 'a'.repeat(60),
      senderAddress: '  12 Baker Street, London  ',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.senderAddress).toBe('12 Baker Street, London');
  });
});
