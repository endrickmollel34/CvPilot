import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';
import type { SubmitContactDto } from './dto/submit-contact.dto';

describe('ContactController', () => {
  let controller: ContactController;

  const mockContactService = { submit: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContactController],
      providers: [{ provide: ContactService, useValue: mockContactService }],
    }).compile();

    controller = module.get<ContactController>(ContactController);
  });

  it('forwards the validated DTO to ContactService unchanged', async () => {
    const dto: SubmitContactDto = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      category: 'general',
      message: 'Hello, I have a question.',
    } as SubmitContactDto;
    mockContactService.submit.mockResolvedValue(undefined);

    await controller.submit(dto);

    expect(mockContactService.submit).toHaveBeenCalledWith(dto);
  });

  it('propagates a ContactService failure rather than swallowing it', async () => {
    mockContactService.submit.mockRejectedValue(new Error('send failed'));

    await expect(
      controller.submit({
        name: 'Jane Doe',
        email: 'jane@example.com',
        category: 'general',
        message: 'Hello.',
      } as SubmitContactDto),
    ).rejects.toThrow('send failed');
  });
});
