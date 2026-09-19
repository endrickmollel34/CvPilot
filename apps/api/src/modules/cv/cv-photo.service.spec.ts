import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { CvPhotoService } from './cv-photo.service';
import { CvEntity } from '../../entities/cv.entity';
import { UserService } from '../user/user.service';
import { R2StorageService } from '../../common/services/r2-storage.service';
import { MAX_PHOTO_SIZE_BYTES } from './dto/photo-upload-url.dto';

// Minimal 1x1 real PNG (valid IHDR, sane 1x1 dimensions — allowed only
// because MIN_DIMENSION_PX in image-validation.util.ts is a floor for
// genuine profile photos, not tested content) is fiddly to hand-encode
// reliably; these tests instead build a byte-accurate synthetic PNG/JPEG
// header via the same structure image-validation.util.ts itself parses,
// at dimensions comfortably inside its accepted range — see makePngBuffer/
// makeJpegBuffer below.
function makePngBuffer(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13, 0);
  const type = Buffer.from('IHDR', 'ascii');
  const crc = Buffer.alloc(4); // never validated by our reader
  return Buffer.concat([signature, length, type, ihdrData, crc]);
}

function makeJpegBuffer(width: number, height: number): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  // SOF0 segment: FF C0, length(2, includes itself)=17, precision(1)=8,
  // height(2), width(2), components(1)=3, 3x(id,sampling,quant)=9 bytes.
  const marker = Buffer.from([0xff, 0xc0]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(17, 0);
  const precision = Buffer.from([8]);
  const h = Buffer.alloc(2);
  h.writeUInt16BE(height, 0);
  const w = Buffer.alloc(2);
  w.writeUInt16BE(width, 0);
  const rest = Buffer.alloc(10); // components count + 3 component specs
  rest[0] = 3;
  return Buffer.concat([soi, marker, length, precision, h, w, rest]);
}

const VALID_PNG = makePngBuffer(200, 200);
const VALID_JPEG = makeJpegBuffer(200, 200);

const MOCK_USER = { id: 'user-1', clerkId: 'clerk-1' };
const CV_ID = 'cv-1';

function makeConfig() {
  const vals: Record<string, string> = {
    CLOUDFLARE_R2_ENDPOINT: 'https://r2.example.com',
    CLOUDFLARE_R2_ACCESS_KEY_ID: 'key',
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret',
    CLOUDFLARE_R2_BUCKET_NAME: 'bucket',
  };
  return { getOrThrow: jest.fn((key: string) => vals[key]) };
}

const mockS3Send = jest.fn();
function makeReadable(buffer: Buffer) {
  const { Readable } = jest.requireActual<typeof import('stream')>('stream');
  return Readable.from([buffer]);
}

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest
    .fn()
    .mockImplementation(() => ({ send: (...args: unknown[]) => mockS3Send(...args) })),
  PutObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ __cmd: 'Put', input })),
  GetObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ __cmd: 'Get', input })),
  HeadObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ __cmd: 'Head', input })),
  CopyObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ __cmd: 'Copy', input })),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed-url'),
}));

describe('CvPhotoService', () => {
  let service: CvPhotoService;

  const mockCvRepo = { findOne: jest.fn(), update: jest.fn(), findOneByOrFail: jest.fn() };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockR2Storage = { deleteObject: jest.fn() };

  const PENDING_KEY_PREFIX = `pending-cv-photos/${MOCK_USER.id}/${CV_ID}/`;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CvPhotoService,
        { provide: getRepositoryToken(CvEntity), useValue: mockCvRepo },
        { provide: ConfigService, useValue: makeConfig() },
        { provide: UserService, useValue: mockUserService },
        { provide: R2StorageService, useValue: mockR2Storage },
      ],
    }).compile();

    service = module.get<CvPhotoService>(CvPhotoService);
    mockUserService.findByClerkId.mockResolvedValue(MOCK_USER);
    mockR2Storage.deleteObject.mockResolvedValue(true);
    mockCvRepo.findOne.mockResolvedValue({
      id: CV_ID,
      userId: MOCK_USER.id,
      photoObjectKey: undefined,
    });
    mockCvRepo.findOneByOrFail.mockImplementation(() => Promise.resolve({ id: CV_ID }));
  });

  // ── Ownership ──
  describe('ownership', () => {
    it('generateUploadUrl 404s for a CV the caller does not own', async () => {
      mockCvRepo.findOne.mockResolvedValue(null);
      await expect(
        service.generateUploadUrl('clerk-1', CV_ID, { mimeType: 'image/png', fileSizeBytes: 1000 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('confirmUpload rejects a pending key outside the caller+CV namespace', async () => {
      await expect(
        service.confirmUpload('clerk-1', CV_ID, {
          r2ObjectKey: 'pending-cv-photos/some-other-user/some-other-cv/x.png',
          fileSizeBytes: 1000,
          mimeType: 'image/png',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('removePhoto 404s for a CV the caller does not own', async () => {
      mockCvRepo.findOne.mockResolvedValue(null);
      await expect(service.removePhoto('clerk-1', CV_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── confirmUpload: size ──
  describe('confirmUpload — size', () => {
    it('rejects an object over MAX_PHOTO_SIZE_BYTES and deletes the pending object', async () => {
      mockS3Send.mockImplementation((command: { __cmd: string }) => {
        if (command.__cmd === 'Head') {
          return Promise.resolve({ ContentLength: MAX_PHOTO_SIZE_BYTES + 1 });
        }
        return Promise.resolve({});
      });

      await expect(
        service.confirmUpload('clerk-1', CV_ID, {
          r2ObjectKey: `${PENDING_KEY_PREFIX}x.png`,
          fileSizeBytes: 1000,
          mimeType: 'image/png',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mockR2Storage.deleteObject).toHaveBeenCalledWith(`${PENDING_KEY_PREFIX}x.png`);
    });

    it('fails closed when HEAD returns no usable ContentLength', async () => {
      mockS3Send.mockImplementation((command: { __cmd: string }) => {
        if (command.__cmd === 'Head') return Promise.resolve({});
        return Promise.resolve({});
      });

      await expect(
        service.confirmUpload('clerk-1', CV_ID, {
          r2ObjectKey: `${PENDING_KEY_PREFIX}x.png`,
          fileSizeBytes: 1000,
          mimeType: 'image/png',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // ── confirmUpload: real byte validation ──
  describe('confirmUpload — actual PNG/JPEG byte validation', () => {
    function mockHeadAndGet(buffer: Buffer) {
      mockS3Send.mockImplementation((command: { __cmd: string }) => {
        if (command.__cmd === 'Head') return Promise.resolve({ ContentLength: buffer.length });
        if (command.__cmd === 'Get') return Promise.resolve({ Body: makeReadable(buffer) });
        if (command.__cmd === 'Copy') return Promise.resolve({});
        return Promise.resolve({});
      });
    }

    it('accepts a genuine PNG declared as image/png and promotes it', async () => {
      mockHeadAndGet(VALID_PNG);

      const result = await service.confirmUpload('clerk-1', CV_ID, {
        r2ObjectKey: `${PENDING_KEY_PREFIX}x.png`,
        fileSizeBytes: VALID_PNG.length,
        mimeType: 'image/png',
      });

      expect(mockS3Send).toHaveBeenCalledWith(expect.objectContaining({ __cmd: 'Copy' }));
      expect(mockCvRepo.update).toHaveBeenCalledWith(
        CV_ID,
        expect.objectContaining({
          photoObjectKey: expect.stringContaining(`cv-photos/${MOCK_USER.id}/`),
        }),
      );
      expect(result).toBeDefined();
    });

    it('accepts a genuine JPEG declared as image/jpeg', async () => {
      mockHeadAndGet(VALID_JPEG);

      await service.confirmUpload('clerk-1', CV_ID, {
        r2ObjectKey: `${PENDING_KEY_PREFIX}x.jpg`,
        fileSizeBytes: VALID_JPEG.length,
        mimeType: 'image/jpeg',
      });

      expect(mockS3Send).toHaveBeenCalledWith(expect.objectContaining({ __cmd: 'Copy' }));
    });

    it('rejects non-image bytes (e.g. a PDF renamed to .png) even when the declared mimeType is image/png', async () => {
      const fakeBytes = Buffer.from('%PDF-1.4 not actually a png');
      mockHeadAndGet(fakeBytes);

      await expect(
        service.confirmUpload('clerk-1', CV_ID, {
          r2ObjectKey: `${PENDING_KEY_PREFIX}x.png`,
          fileSizeBytes: fakeBytes.length,
          mimeType: 'image/png',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mockR2Storage.deleteObject).toHaveBeenCalledWith(`${PENDING_KEY_PREFIX}x.png`);
      expect(mockS3Send).not.toHaveBeenCalledWith(expect.objectContaining({ __cmd: 'Copy' }));
    });

    it('rejects a genuine PNG declared as image/jpeg (format/declared-type mismatch)', async () => {
      mockHeadAndGet(VALID_PNG);

      await expect(
        service.confirmUpload('clerk-1', CV_ID, {
          r2ObjectKey: `${PENDING_KEY_PREFIX}x.jpg`,
          fileSizeBytes: VALID_PNG.length,
          mimeType: 'image/jpeg',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('deletes the OLD photo only after the new one is safely persisted (replacement)', async () => {
      mockCvRepo.findOne.mockResolvedValue({
        id: CV_ID,
        userId: MOCK_USER.id,
        photoObjectKey: `cv-photos/${MOCK_USER.id}/${CV_ID}-old.png`,
      });
      mockHeadAndGet(VALID_PNG);
      const order: string[] = [];
      mockCvRepo.update.mockImplementation(() => {
        order.push('db-update');
        return Promise.resolve();
      });
      mockR2Storage.deleteObject.mockImplementation((key: string) => {
        order.push(`delete:${key}`);
        return Promise.resolve(true);
      });

      await service.confirmUpload('clerk-1', CV_ID, {
        r2ObjectKey: `${PENDING_KEY_PREFIX}x.png`,
        fileSizeBytes: VALID_PNG.length,
        mimeType: 'image/png',
      });

      expect(order.indexOf('db-update')).toBeLessThan(
        order.indexOf(`delete:cv-photos/${MOCK_USER.id}/${CV_ID}-old.png`),
      );
    });
  });

  // ── removePhoto ──
  describe('removePhoto', () => {
    it('is a no-op when the CV has no photo', async () => {
      mockCvRepo.findOne.mockResolvedValue({
        id: CV_ID,
        userId: MOCK_USER.id,
        photoObjectKey: undefined,
      });

      await service.removePhoto('clerk-1', CV_ID);

      expect(mockR2Storage.deleteObject).not.toHaveBeenCalled();
      expect(mockCvRepo.update).not.toHaveBeenCalled();
    });

    it('deletes the R2 object and clears photoObjectKey when a photo exists', async () => {
      mockCvRepo.findOne.mockResolvedValue({
        id: CV_ID,
        userId: MOCK_USER.id,
        photoObjectKey: `cv-photos/${MOCK_USER.id}/${CV_ID}-x.png`,
      });

      await service.removePhoto('clerk-1', CV_ID);

      expect(mockR2Storage.deleteObject).toHaveBeenCalledWith(
        `cv-photos/${MOCK_USER.id}/${CV_ID}-x.png`,
      );
      expect(mockCvRepo.update).toHaveBeenCalledWith(CV_ID, { photoObjectKey: null });
    });

    it('fails closed and never clears the DB pointer when the R2 delete fails', async () => {
      mockCvRepo.findOne.mockResolvedValue({
        id: CV_ID,
        userId: MOCK_USER.id,
        photoObjectKey: `cv-photos/${MOCK_USER.id}/${CV_ID}-x.png`,
      });
      mockR2Storage.deleteObject.mockResolvedValue(false);

      await expect(service.removePhoto('clerk-1', CV_ID)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockCvRepo.update).not.toHaveBeenCalled();
    });
  });

  // ── getPhotoBytes (server-side, used by PdfGenerationService) ──
  describe('getPhotoBytes', () => {
    it('returns buffer + dimensions for a valid stored photo', async () => {
      mockS3Send.mockImplementation((command: { __cmd: string }) => {
        if (command.__cmd === 'Get') return Promise.resolve({ Body: makeReadable(VALID_PNG) });
        return Promise.resolve({});
      });

      const result = await service.getPhotoBytes(`cv-photos/${MOCK_USER.id}/${CV_ID}-x.png`);

      expect(result).not.toBeNull();
      expect(result?.dimensions.format).toBe('image/png');
    });

    it('returns null (never throws) when the stored object is missing/corrupt — a photo load failure must not crash PDF generation', async () => {
      mockS3Send.mockImplementation(() => Promise.reject(new Error('NoSuchKey')));

      const result = await service.getPhotoBytes(`cv-photos/${MOCK_USER.id}/${CV_ID}-x.png`);

      expect(result).toBeNull();
    });
  });
});
