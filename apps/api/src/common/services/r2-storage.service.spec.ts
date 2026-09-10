import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { R2StorageService } from './r2-storage.service';

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest
    .fn()
    .mockImplementation(() => ({ send: (...args: unknown[]) => mockS3Send(...args) })),
  DeleteObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

function makeConfig() {
  const vals: Record<string, string> = {
    CLOUDFLARE_R2_ENDPOINT: 'https://r2.example.com',
    CLOUDFLARE_R2_ACCESS_KEY_ID: 'key',
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret',
    CLOUDFLARE_R2_BUCKET_NAME: 'bucket',
  };
  return { getOrThrow: jest.fn((key: string) => vals[key]) };
}

describe('R2StorageService', () => {
  let service: R2StorageService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [R2StorageService, { provide: ConfigService, useValue: makeConfig() }],
    }).compile();

    service = module.get<R2StorageService>(R2StorageService);
  });

  it('deletes an object and returns true on success', async () => {
    mockS3Send.mockResolvedValue(undefined);

    await expect(service.deleteObject('cvs/user-1/resume.pdf')).resolves.toBe(true);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
    const sentCommand = mockS3Send.mock.calls[0]?.[0] as { input: { Bucket: string; Key: string } };
    expect(sentCommand.input).toEqual({ Bucket: 'bucket', Key: 'cvs/user-1/resume.pdf' });
  });

  // S3/R2's DeleteObject is itself idempotent — deleting an already-missing
  // key still resolves successfully (no NotFound thrown), so "the object
  // was already gone" and "really deleted it" are indistinguishable from
  // the caller's side and both correctly resolve `true` here.
  it('treats deleting an already-missing object as a harmless success (idempotent)', async () => {
    mockS3Send.mockResolvedValue(undefined);

    await expect(service.deleteObject('cvs/user-1/already-gone.pdf')).resolves.toBe(true);
  });

  it('never throws on a genuinely unexpected failure — returns false instead', async () => {
    mockS3Send.mockRejectedValue(new Error('R2 unavailable'));

    await expect(service.deleteObject('cvs/user-1/resume.pdf')).resolves.toBe(false);
  });

  // Privacy-safe R2 logging fix (see the module report): a CV's key embeds
  // the original, user-controlled filename (`cvs/${userId}/${uuid}-${fileName}`)
  // — itself personal data — and some AWS SDK error `.message` strings can
  // independently echo back request details like the key too. Neither may
  // ever reach the log; only a broad category (the key's own first path
  // segment) and the error's *name* (a fixed, enumerable SDK error type,
  // never `.message`) are safe to record.
  it('on failure, logs only a safe category and the error name — never the full key, filename, user id, or error message', async () => {
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    class FakeS3Error extends Error {
      constructor() {
        // A realistic AWS SDK-style message that itself echoes back the
        // key/filename — exactly what must never reach the log.
        super('NoSuchKey: The specified key cvs/user-42/jane-smith-cv-2024.pdf does not exist.');
        this.name = 'NoSuchKey';
      }
    }
    mockS3Send.mockRejectedValue(new FakeS3Error());

    await service.deleteObject('cvs/user-42/jane-smith-cv-2024.pdf');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const loggedMessage = warnSpy.mock.calls[0]?.[0] as string;

    // Safe to log: the operation, the broad category, the error's name.
    expect(loggedMessage).toContain('R2 delete');
    expect(loggedMessage).toContain('cvs');
    expect(loggedMessage).toContain('NoSuchKey');

    // Never logged: the full key, the filename it embeds, the user id, or
    // the raw error message (which — as constructed above — itself
    // contains the key/filename).
    expect(loggedMessage).not.toContain('cvs/user-42/jane-smith-cv-2024.pdf');
    expect(loggedMessage).not.toContain('jane-smith-cv-2024.pdf');
    expect(loggedMessage).not.toContain('user-42');
    expect(loggedMessage).not.toContain('The specified key');
    expect(loggedMessage).not.toContain('secret'); // the config secretAccessKey value

    warnSpy.mockRestore();
  });

  it('derives the logged category from the cover-letters prefix too, not just cvs', async () => {
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    mockS3Send.mockRejectedValue(new Error('network error'));

    await service.deleteObject('cover-letters/user-42/letter-123.pdf');

    const loggedMessage = warnSpy.mock.calls[0]?.[0] as string;
    expect(loggedMessage).toContain('cover-letters');
    expect(loggedMessage).not.toContain('user-42');
    expect(loggedMessage).not.toContain('letter-123');

    warnSpy.mockRestore();
  });
});
