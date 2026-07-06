import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AI_CLIENT, AI_MODEL } from './constants/tokens';
import { ParsedTaskDto } from './dto/parsed-task.dto';
import { buildProxyUrlFromEnv } from '../common/utils/proxy-url';
import { fetchDirect } from '../common/utils/fetch-direct';

@Injectable()
export class DeepseekService {
  private readonly logger = new Logger(DeepseekService.name);

  private openai: OpenAI;
  private openrouter: OpenAI;

  constructor(
    @Inject(AI_CLIENT) private readonly gemini: GoogleGenerativeAI,
    @Inject(AI_MODEL) private readonly modelName: string,
  ) {
    const proxyUrl = buildProxyUrlFromEnv();

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      ...(proxyUrl ? { httpAgent: new HttpsProxyAgent(proxyUrl) } : {}),
    });

    this.openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      fetch: fetchDirect as typeof fetch,
    });
  }

  async formulateTask(text: string): Promise<string> {
    const prompt = `
      Ты — ассистент, который формулирует понятные и структурированные задачи для постановки исполнителям.

      На вход подается неструктурированный текст (обычно — транскрибированная голосовая речь).
      Нужно преобразовать его в задачу по следующей структуре:

      ---

      Заголовок:
      Краткое и ёмкое название задачи (1 строка), без лишних слов и оценочных фраз, в повелительном наклонении.

      Описание задачи:
      Чёткое объяснение, что нужно сделать, без воды. Если контекст неполный, — оставь как есть, не додумывай.

      Критерии приемки:
      Список пунктов, по которым можно проверить, что задача выполнена.
      Каждый пункт должен быть проверяемым действием.
      Не использовать общие формулировки ("сделано хорошо", "должно работать").

      Формат результата строго такой:

      Заголовок:
      <заголовок>

      Описание задачи:
      <описание>

      Критерии приемки:
      <критерий 1>
      <критерий 2>
      <критерий 3>

      ---

      Важно:
      - Не добавлять ничего от себя.
      - Не переписывать текст "красиво", а искать суть.
      - Если задача не обнаружена — вернуть фразу: "Задача не обнаружена".
    `;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: text },
      ],
      store: false,
    });

    return response.choices[0].message.content?.trim() ?? '';
  }
  async transcribeAudio(buffer: Buffer, fileName: string, mimeType?: string): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new InternalServerErrorException('OPENROUTER_API_KEY не настроен');
    }

    const model = process.env.OPENROUTER_TRANSCRIBE_MODEL || 'openai/whisper-large-v3';
    const format = this.resolveAudioFormat(fileName, mimeType);

    const response = await fetchDirect('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        language: 'ru',
        input_audio: {
          data: buffer.toString('base64'),
          format,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`OpenRouter STT ${response.status}: ${body.slice(0, 500)}`);
      throw new Error(`OpenRouter STT ${response.status}`);
    }

    const json = (await response.json()) as { text: string };
    return json.text.trim();
  }

  private resolveAudioFormat(fileName: string, mimeType?: string): string {
    const mimeToFormat: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/wave': 'wav',
      'audio/x-wav': 'wav',
      'audio/ogg': 'ogg',
      'audio/mp4': 'm4a',
      'audio/m4a': 'm4a',
      'audio/aac': 'aac',
      'audio/flac': 'flac',
    };

    if (mimeType && mimeToFormat[mimeType]) {
      return mimeToFormat[mimeType];
    }

    const extension = fileName.split('.').pop()?.toLowerCase();
    const extensionToFormat: Record<string, string> = {
      webm: 'webm',
      mp3: 'mp3',
      wav: 'wav',
      ogg: 'ogg',
      m4a: 'm4a',
      mp4: 'm4a',
      aac: 'aac',
      flac: 'flac',
    };

    if (extension && extensionToFormat[extension]) {
      return extensionToFormat[extension];
    }

    return 'webm';
  }

  async parseTextToTaskFromGemini(text: string) {
    try {
      const prompt = `
        Ты превращаешь текст задачи пользователя в строго структурированный JSON.

        ТРЕБОВАНИЯ:
        1) НЕ удаляй важную смысловую часть текста.
        2) НЕ сокращай технические детали, параметры, пункты, перечисления.
        3) Сохраняй максимум содержания: можно структурировать, но не удалять.
        4) В конце description ОБЯЗАТЕЛЬНО должна быть секция "Критерии приемки".
        5) Если критерии уже есть — используй их; если нет — сформируй реалистичные.
        6) Секция "Критерии приемки" ДОЛЖНА быть последним блоком в Tiptap JSON.
        7) Выводи ТОЛЬКО чистый JSON. Никакого текста вне JSON.

        ФОРМАТ JSON (строго соблюдать):
        {
          "title": "краткое и точное название задачи",
          "description": {
            "type": "doc",
            "content": [
              { "type": "paragraph", "content": [ { "type": "text", "text": "..." } ] },
              { "type": "paragraph", "content": [ { "type": "text", "text": "Критерии приемки:" } ] },
              {
                "type": "bullet_list",
                "content": [
                  { "type": "list_item", "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "..." } ] } ] }
                ]
              }
            ]
          }
        }

        Входные данные:
        """${text}"""
        `.trim();
      const model = this.gemini.getGenerativeModel({ model: this.modelName });
      const response = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });

      const json = JSON.parse(response.response.text()) as ParsedTaskDto;
      return {
        title: (json.title || '').trim(),
        description: json.description,
      };
    } catch (e) {
      this.logger.error(e);
      throw e;
    }
  }

  async parseTextToTaskGpt(text: string, instruction?: string): Promise<ParsedTaskDto> {
    try {
      const prompt = [
        '=== ЗАДАЧА ===',
        'Ты конвертируешь неструктурированный русский текст задачи в аккуратный Tiptap JSON.',
        'Ты обязан сохранить смысл и все важные детали, но при этом отредактировать текст до делового, ясного стиля.',
        '',
        '=== СТИЛЬ РЕДАКТИРОВАНИЯ (ОБЯЗАТЕЛЬНО) ===',
        '- Убирай вводные и пустые фразы: "в общем", "также можно будет", "в целом", "как бы", "на самом деле", "просто", "скажем так", "и т.д.", "и т.п.", "в той или иной степени", "должно получиться", "необходимо постараться".',
        '- Убирай канцелярит и воду. Избавляйся от тавтологий и повторов.',
        '- Пиши коротко, по делу, преимущественно в повелительном наклонении: "Сверстать", "Проверить", "Добавить".',
        '- Конкретизируй расплывчатые формулировки (если возможно по контексту): вместо "быстро" → "до 200мс TTFB", вместо "красиво" → "по макету Figma".',
        '- Сохраняй технические факты, цифры, параметры, пути, имена сущностей.',
        '',
        '=== СТРУКТУРА ОПИСАНИЯ (ОБЯЗАТЕЛЬНО) ===',
        'Описание строится из трёх обязательных секций, каждая начинается с heading level 2:',
        '',
        '1. "Проблема" (или "Контекст") — что сейчас не так / зачем эта задача.',
        '2. "Что нужно сделать" (или "Ожидаемое поведение") — ожидаемый результат.',
        '3. "Критерии приёмки" — ВСЕГДА ПОСЛЕДНЯЯ СЕКЦИЯ, оформляется taskList с taskItem (attrs.checked=false).',
        '',
        'Опциональные секции (только если уместно): "Ограничения", "Примечание", "Материалы".',
        '',
        '=== ПРАВИЛА ФОРМАТИРОВАНИЯ ===',
        '- Секции — heading level 2, не жирный текст.',
        '- Перечисления — bulletList/listItem или orderedList/listItem.',
        '- Критерии приёмки — ТОЛЬКО taskList/taskItem (не буллеты). Каждый критерий — конкретный и проверяемый.',
        '- Если критериев не было — сгенерируй реалистичные. Минимум 2, включая "Нет регрессии в текущем сценарии".',
        '- Если в тексте есть ссылки или упоминания файлов — сохрани их.',
        '- Допускай жирный/курсив/код через marks: bold/italic/code.',
        '',
        '=== ДОПУСТИМЫЕ НОДЫ/МАРКИ Tiptap ===',
        '- Ноды: doc, paragraph, text, heading{attrs.level:number}, bulletList, orderedList, listItem, taskList, taskItem{attrs.checked:boolean}, blockquote, codeBlock, hardBreak.',
        '- Марки: bold, italic, code, link (если есть явные URL).',
        '- Используй camelCase типы нод.',
        '',
        '=== ФОРМАТ ВЫХОДА ===',
        'Только JSON. Без комментариев. Без Markdown. Без текста вне JSON.',
        '',
        '=== СХЕМА ВЫХОДНОГО JSON ===',
        '{',
        '  "title": "краткий, точный заголовок без воды",',
        '  "description": {',
        '    "type": "doc",',
        '    "content": [',
        '      { "type": "heading", "attrs": { "level": 2 }, "content": [ { "type": "text", "text": "Проблема" } ] },',
        '      { "type": "paragraph", "content": [ { "type": "text", "text": "Кратко в чём проблема." } ] },',
        '      { "type": "heading", "attrs": { "level": 2 }, "content": [ { "type": "text", "text": "Что нужно сделать" } ] },',
        '      { "type": "paragraph", "content": [ { "type": "text", "text": "Кратко ожидаемое поведение." } ] },',
        '      { "type": "heading", "attrs": { "level": 2 }, "content": [ { "type": "text", "text": "Критерии приёмки" } ] },',
        '      { "type": "taskList", "content": [',
        '          { "type": "taskItem", "attrs": { "checked": false }, "content": [',
        '              { "type": "paragraph", "content": [ { "type": "text", "text": "Первый критерий" } ] }',
        '          ] },',
        '          { "type": "taskItem", "attrs": { "checked": false }, "content": [',
        '              { "type": "paragraph", "content": [ { "type": "text", "text": "Нет регрессии в текущем сценарии" } ] }',
        '          ] }',
        '      ] }',
        '    ]',
        '  }',
        '}',
        '',
        '=== INPUT DATA ===',
        `"""${text}"""`,
        '',
        ...(instruction ? [`=== ДОПОЛНИТЕЛЬНАЯ ИНСТРУКЦИЯ ===`, `${instruction}`, ''] : []),
        'Сформируй чистый JSON строго по схеме, применив правила редактуры и структурирования.',
      ].join('\n');

      const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-pro';

      const response = await this.openrouter.chat.completions.create(
        {
          model,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'Ты — ассистент, который формирует структурированные задачи, не теряя смысл и не удаляя важные детали.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
        },
        { timeout: 60000 },
      );

      const raw = response.choices?.[0]?.message?.content ?? '{}';

      const jsonStr = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      let json: ParsedTaskDto;
      try {
        json = JSON.parse(jsonStr) as ParsedTaskDto;
      } catch {
        this.logger.error('Не удалось распарсить JSON от модели:', jsonStr.slice(0, 300));
        throw new InternalServerErrorException('Модель вернула невалидный JSON');
      }

      return {
        title: (json.title || '').trim(),
        description: json.description,
      };
    } catch (e) {
      if (!(e instanceof InternalServerErrorException)) {
        this.logger.error('parseTextToTaskGpt error:', e instanceof Error ? e.message : e);
      }
      throw e;
    }
  }
}
