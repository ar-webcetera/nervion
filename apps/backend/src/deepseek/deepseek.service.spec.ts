import type { GoogleGenerativeAI } from '@google/generative-ai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { DeepseekService } from './deepseek.service';

const parsedTask = {
  title: 'Исправить форму',
  description: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Исправить ошибку со скриншота' }] }],
  },
};

describe('DeepseekService', () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

  beforeAll(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  });

  afterAll(() => {
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  });

  it('передаёт текст и скриншоты модели как мультимодальный запрос', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(parsedTask) } }],
    });
    const service = new DeepseekService({} as GoogleGenerativeAI, 'gemini-test');
    Object.defineProperty(service, 'openrouter', {
      value: { chat: { completions: { create } } },
    });

    await service.parseTextToTaskGpt('Исправить форму', undefined, [
      {
        buffer: Buffer.from('screenshot'),
        mimeType: 'image/png',
      },
    ]);

    const [request, options] = create.mock.calls[0] as [ChatCompletionCreateParamsNonStreaming, { timeout: number }];
    const userMessage = request.messages.find((message) => message.role === 'user');
    if (!userMessage || typeof userMessage.content === 'string' || !userMessage.content) {
      throw new Error('Мультимодальное сообщение не сформировано');
    }

    const textPart = userMessage.content.find((part) => part.type === 'text');
    const imagePart = userMessage.content.find((part) => part.type === 'image_url');

    expect(options).toEqual({ timeout: 90000 });
    expect(textPart?.text).toContain('Исправить форму');
    expect(imagePart).toEqual({
      type: 'image_url',
      image_url: {
        url: `data:image/png;base64,${Buffer.from('screenshot').toString('base64')}`,
        detail: 'high',
      },
    });
  });
});
