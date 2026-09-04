import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { CONTACT_CATEGORIES, type ContactCategory } from '@cvpilot/shared';

// Trims before validation runs (ValidationPipe's transform:true applies
// class-transformer first) — without this, a value like " user@x.com "
// would fail @IsEmail, and a message that's only whitespace would pass
// @IsNotEmpty.
const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class SubmitContactDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @trim()
  @IsEmail()
  @MaxLength(254) // RFC 5321 maximum mailbox length
  email!: string;

  @IsIn(CONTACT_CATEGORIES)
  category!: ContactCategory;

  @trim()
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message!: string;

  // Honeypot — a real visitor never sees or fills this field (hidden
  // off-screen in the form; see ContactForm.tsx). Declared here, rather
  // than left to be silently stripped, because the global ValidationPipe's
  // forbidNonWhitelisted:true would otherwise reject the whole submission
  // whenever a bot (or browser autofill) populates it. ContactService
  // checks this and discards the submission without sending an email —
  // never persisted, never logged, never forwarded.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
