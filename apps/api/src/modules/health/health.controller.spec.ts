import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import type { Response } from 'express';

import { HealthController } from './health.controller';

function mockResponse() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { status: jest.Mock; json: jest.Mock };
}

describe('HealthController', () => {
  let controller: HealthController;

  const mockDataSource = { query: jest.fn() };
  const mockPing = jest.fn();
  const mockQueue = { client: Promise.resolve({ ping: mockPing }) };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueue.client = Promise.resolve({ ping: mockPing });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: getQueueToken('cv-analysis'), useValue: mockQueue },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns 200 with an all-ok body when both dependencies are healthy', async () => {
    mockDataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    mockPing.mockResolvedValue('PONG');
    const res = mockResponse();

    await controller.check(res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', db: 'ok', redis: 'ok' }),
    );
  });

  it('returns 503 with db: "error" when PostgreSQL is unavailable', async () => {
    mockDataSource.query.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    mockPing.mockResolvedValue('PONG');
    const res = mockResponse();

    await controller.check(res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', db: 'error', redis: 'ok' }),
    );
  });

  it('returns 503 with redis: "error" when Redis is unavailable', async () => {
    mockDataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    mockPing.mockRejectedValue(new Error('connect ETIMEDOUT'));
    const res = mockResponse();

    await controller.check(res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', db: 'ok', redis: 'error' }),
    );
  });

  it('returns 503 with both marked "error" when both dependencies fail', async () => {
    mockDataSource.query.mockRejectedValue(new Error('connect ECONNREFUSED'));
    mockPing.mockRejectedValue(new Error('connect ETIMEDOUT'));
    const res = mockResponse();

    await controller.check(res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', db: 'error', redis: 'error' }),
    );
  });

  it('never leaks the underlying error message/details into the response body', async () => {
    mockDataSource.query.mockRejectedValue(
      new Error('password authentication failed for user "cvpilot"'),
    );
    mockPing.mockResolvedValue('PONG');
    const res = mockResponse();

    await controller.check(res);

    const [body] = res.json.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(body).sort()).toEqual(['db', 'redis', 'status', 'timestamp']);
    expect(JSON.stringify(body)).not.toContain('password authentication failed');
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });

  it('includes an ISO timestamp', async () => {
    mockDataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    mockPing.mockResolvedValue('PONG');
    const res = mockResponse();

    await controller.check(res);

    const [body] = res.json.mock.calls[0] as [{ timestamp: string }];
    expect(typeof body.timestamp).toBe('string');
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
  });
});
