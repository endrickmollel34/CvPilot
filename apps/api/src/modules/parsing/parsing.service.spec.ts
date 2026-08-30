import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import type { Job } from 'bullmq';

import { ParsingService } from './parsing.service';
import { CvEntity } from '../../entities/cv.entity';

// pdf-parse and mammoth do real binary parsing — mocked here so tests stay
// fast/deterministic and don't need real PDF/DOCX fixtures. The point of
// these tests is to lock in *which library is called for which mime type*
// and that a no-text result is treated as a failure, not silently a success.
jest.mock('pdf-parse', () => ({ PDFParse: jest.fn() }));
jest.mock('mammoth', () => ({ extractRawText: jest.fn() }));

import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

const mockPDFParse = PDFParse as unknown as jest.Mock;
const mockExtractRawText = mammoth.extractRawText as jest.Mock;

const mockConfig = {
  getOrThrow: jest.fn((key: string) => {
    const vals: Record<string, string> = {
      CLOUDFLARE_R2_ENDPOINT: 'https://r2.example.com',
      CLOUDFLARE_R2_ACCESS_KEY_ID: 'key',
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret',
      CLOUDFLARE_R2_BUCKET_NAME: 'bucket',
    };
    return vals[key] ?? '';
  }),
};

function readableFromBuffer(buf: Buffer): Readable {
  return new Readable({
    read() {
      this.push(buf);
      this.push(null);
    },
  });
}

describe('ParsingService', () => {
  let service: ParsingService;

  const mockRepo = {
    update: jest.fn(),
    findOneByOrFail: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParsingService,
        { provide: getRepositoryToken(CvEntity), useValue: mockRepo },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<ParsingService>(ParsingService);
  });

  // ─── extractText() — mime-type dispatch ────────────────────────────────────
  // Regression coverage for the bug where this method was a stub that
  // returned the literal string 'TODO: extracted text' instead of real
  // content, silently poisoning every downstream AI prefill/analysis call.

  describe('extractText()', () => {
    it('extracts text from a PDF buffer via pdf-parse and destroys the parser', async () => {
      const getText = jest.fn().mockResolvedValue({ text: 'Jane Doe\njane@example.com' });
      const destroy = jest.fn().mockResolvedValue(undefined);
      mockPDFParse.mockImplementation(() => ({ getText, destroy }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: string = await (service as any).extractText(
        Buffer.from('%PDF-1.4 fake'),
        'application/pdf',
      );

      expect(mockPDFParse).toHaveBeenCalledWith({ data: expect.any(Buffer) });
      expect(getText).toHaveBeenCalled();
      expect(destroy).toHaveBeenCalled();
      expect(result).toBe('Jane Doe\njane@example.com');
    });

    it('extracts text from a DOCX buffer via mammoth', async () => {
      mockExtractRawText.mockResolvedValue({ value: 'Jane Doe\njane@example.com', messages: [] });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: string = await (service as any).extractText(
        Buffer.from('PK fake docx'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );

      expect(mockExtractRawText).toHaveBeenCalledWith({ buffer: expect.any(Buffer) });
      expect(result).toBe('Jane Doe\njane@example.com');
    });

    it('returns an empty string for an empty buffer without invoking any parser', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: string = await (service as any).extractText(Buffer.alloc(0), 'application/pdf');

      expect(result).toBe('');
      expect(mockPDFParse).not.toHaveBeenCalled();
      expect(mockExtractRawText).not.toHaveBeenCalled();
    });

    it('throws for an unsupported mime type instead of returning placeholder text', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).extractText(Buffer.from('data'), 'image/png'),
      ).rejects.toThrow('Unsupported CV file type');
    });
  });

  // ─── process() — end-to-end job handling ───────────────────────────────────

  describe('process()', () => {
    it('marks the CV done with the real extracted text on success', async () => {
      mockRepo.findOneByOrFail.mockResolvedValue({
        id: 'cv-1',
        r2ObjectKey: 'cvs/user-1/file.pdf',
        mimeType: 'application/pdf',
      });
      jest
        .spyOn(S3Client.prototype, 'send')
        .mockResolvedValue({ Body: readableFromBuffer(Buffer.from('irrelevant')) } as never);
      const getText = jest.fn().mockResolvedValue({ text: 'Jane Doe\njane@example.com' });
      mockPDFParse.mockImplementation(() => ({ getText, destroy: jest.fn() }));

      await service.process({ data: { cvId: 'cv-1' } } as Job<{ cvId: string }>);

      expect(mockRepo.update).toHaveBeenCalledWith('cv-1', {
        parsedContent: 'Jane Doe\njane@example.com',
        parseStatus: 'done',
      });
    });

    it('marks the CV as failed — not done — when extraction yields no text', async () => {
      // Regression test: this used to persist the placeholder string
      // 'TODO: extracted text' and mark the CV 'done', which made every
      // uploaded CV look successfully parsed while carrying no real content.
      mockRepo.findOneByOrFail.mockResolvedValue({
        id: 'cv-1',
        r2ObjectKey: 'cvs/user-1/file.pdf',
        mimeType: 'application/pdf',
      });
      jest
        .spyOn(S3Client.prototype, 'send')
        .mockResolvedValue({ Body: readableFromBuffer(Buffer.from('irrelevant')) } as never);
      const getText = jest.fn().mockResolvedValue({ text: '   ' }); // whitespace-only
      mockPDFParse.mockImplementation(() => ({ getText, destroy: jest.fn() }));

      await service.process({ data: { cvId: 'cv-1' } } as Job<{ cvId: string }>);

      expect(mockRepo.update).toHaveBeenLastCalledWith('cv-1', { parseStatus: 'failed' });
      expect(mockRepo.update).not.toHaveBeenCalledWith(
        'cv-1',
        expect.objectContaining({ parseStatus: 'done' }),
      );
    });

    it('marks a builder CV (no r2ObjectKey) as done immediately without parsing', async () => {
      mockRepo.findOneByOrFail.mockResolvedValue({ id: 'cv-2', r2ObjectKey: undefined });

      await service.process({ data: { cvId: 'cv-2' } } as Job<{ cvId: string }>);

      expect(mockRepo.update).toHaveBeenLastCalledWith('cv-2', { parseStatus: 'done' });
      expect(mockPDFParse).not.toHaveBeenCalled();
    });
  });
});
