import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateCoverLetterDto } from './update-cover-letter.dto';

// V2 — every field on this DTO is now optional so PATCH /cover-letters/:id
// can express a genuine partial update (structured fields, content, or
// both). These tests pin down that an empty/partial body is valid, that
// each field is still validated when present, and that the trim-before-
// validate behavior (see create-cover-letter.dto.spec.ts for the original
// production regression this pattern fixes) applies here too.
describe('UpdateCoverLetterDto', () => {
  it('accepts a completely empty body (a no-op partial update)', async () => {
    const dto = plainToInstance(UpdateCoverLetterDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts content on its own', async () => {
    const dto = plainToInstance(UpdateCoverLetterDto, {
      content: 'a'.repeat(60),
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects content shorter than 50 characters when content is provided', async () => {
    const dto = plainToInstance(UpdateCoverLetterDto, { content: 'too short' });
    const errors = await validate(dto);
    expect(errors).not.toHaveLength(0);
    expect(errors[0]?.property).toBe('content');
  });

  it('accepts structured fields with no content at all', async () => {
    const dto = plainToInstance(UpdateCoverLetterDto, {
      jobTitle: 'Senior Engineer',
      companyName: 'Acme Corp',
      jobDescription: 'Lead backend development.',
      tone: 'enthusiastic',
      recipientName: 'Jane Smith',
      recipientTitle: 'Head of Engineering',
      companyAddress: '1 Infinite Loop, Cupertino, CA',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('trims jobTitle, companyName, recipientName, recipientTitle, and companyAddress', () => {
    const dto = plainToInstance(UpdateCoverLetterDto, {
      jobTitle: '  Senior Engineer  ',
      companyName: '  Acme Corp  ',
      recipientName: '  Jane Smith  ',
      recipientTitle: '  Head of Engineering  ',
      companyAddress: '  1 Infinite Loop  ',
    });

    expect(dto.jobTitle).toBe('Senior Engineer');
    expect(dto.companyName).toBe('Acme Corp');
    expect(dto.recipientName).toBe('Jane Smith');
    expect(dto.recipientTitle).toBe('Head of Engineering');
    expect(dto.companyAddress).toBe('1 Infinite Loop');
  });

  it('rejects an invalid tone value', async () => {
    const dto = plainToInstance(UpdateCoverLetterDto, { tone: 'sarcastic' });
    const errors = await validate(dto);
    expect(errors).not.toHaveLength(0);
    expect(errors[0]?.property).toBe('tone');
  });

  // V2.1 — senderAddress is typed `string | null` (unlike its siblings
  // above): @IsOptional() treats both `undefined` (omitted — "leave
  // unchanged") and explicit `null` (cleared) as valid, skipping further
  // validation either way — this is exactly the behavior the editor
  // relies on to let a user clear a previously-set sender address.
  it('accepts senderAddress and trims it, like the other optional string fields', () => {
    const dto = plainToInstance(UpdateCoverLetterDto, {
      senderAddress: '  12 Baker Street, London  ',
    });
    expect(dto.senderAddress).toBe('12 Baker Street, London');
  });

  it('accepts an explicit null senderAddress (clearing it) with no validation errors', async () => {
    const dto = plainToInstance(UpdateCoverLetterDto, { senderAddress: null });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.senderAddress).toBeNull();
  });

  it('accepts an omitted senderAddress (leaving it unchanged) with no validation errors', async () => {
    const dto = plainToInstance(UpdateCoverLetterDto, { jobTitle: 'Senior Engineer' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.senderAddress).toBeUndefined();
  });
});
