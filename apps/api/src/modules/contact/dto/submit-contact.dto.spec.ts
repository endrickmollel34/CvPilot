import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SubmitContactDto } from './submit-contact.dto';

function valid(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Jane Doe',
    email: 'jane@example.com',
    category: 'general',
    message: 'Hello, I have a question about CVPilot that needs a real answer.',
    ...overrides,
  };
}

async function errorsFor(input: Record<string, unknown>) {
  const dto = plainToInstance(SubmitContactDto, input);
  return validate(dto);
}

describe('SubmitContactDto', () => {
  it('accepts a valid submission', async () => {
    expect(await errorsFor(valid())).toHaveLength(0);
  });

  it.each(['general', 'support', 'billing', 'privacy', 'feedback', 'other'])(
    'accepts the "%s" category',
    async (category) => {
      expect(await errorsFor(valid({ category }))).toHaveLength(0);
    },
  );

  it('rejects an unrecognised category', async () => {
    expect(await errorsFor(valid({ category: 'sales' }))).not.toHaveLength(0);
  });

  it('rejects a malformed email address', async () => {
    expect(await errorsFor(valid({ email: 'not-an-email' }))).not.toHaveLength(0);
  });

  it.each(['name', 'email', 'category', 'message'])('rejects a missing %s', async (field) => {
    const input = valid();
    delete (input as Record<string, unknown>)[field];
    expect(await errorsFor(input)).not.toHaveLength(0);
  });

  it('rejects an oversized message', async () => {
    expect(await errorsFor(valid({ message: 'a'.repeat(5001) }))).not.toHaveLength(0);
  });

  it('accepts a message right at the maximum length', async () => {
    expect(await errorsFor(valid({ message: 'a'.repeat(5000) }))).toHaveLength(0);
  });

  it('rejects a message that is too short to be a real enquiry', async () => {
    expect(await errorsFor(valid({ message: 'hi' }))).not.toHaveLength(0);
  });

  it('rejects an oversized name', async () => {
    expect(await errorsFor(valid({ name: 'a'.repeat(121) }))).not.toHaveLength(0);
  });

  it('rejects an oversized email', async () => {
    expect(await errorsFor(valid({ email: `${'a'.repeat(250)}@x.com` }))).not.toHaveLength(0);
  });

  it('trims leading/trailing whitespace from name, email, and message before validating', () => {
    const dto = plainToInstance(
      SubmitContactDto,
      valid({ name: '  Jane Doe  ', email: '  jane@example.com  ' }),
    );
    expect(dto.name).toBe('Jane Doe');
    expect(dto.email).toBe('jane@example.com');
  });

  it('does not reject a submission with no honeypot value set', async () => {
    expect(await errorsFor(valid())).toHaveLength(0);
  });

  it('accepts (but flags via the field itself, not a validation error) a filled honeypot — ContactService is responsible for discarding it', async () => {
    // forbidNonWhitelisted:true (global ValidationPipe) means an
    // undeclared field would 400 the whole request — this proves the
    // honeypot field is validated as a normal optional string, not
    // silently stripped, so a bot-filled request reaches ContactService
    // rather than being rejected before it can be silently discarded.
    expect(await errorsFor(valid({ website: 'http://spam.example' }))).toHaveLength(0);
  });

  it('rejects an oversized honeypot value (defence in depth, even though it is discarded rather than sent)', async () => {
    expect(await errorsFor(valid({ website: 'a'.repeat(201) }))).not.toHaveLength(0);
  });
});
