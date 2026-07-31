import { TASK_STATUSES } from '../../common/enums/statuses.enum';

export const CreateTaskResponseDto = {
  type: 'object',
  properties: {
    id: {
      type: 'number',
      example: 1,
    },
    project_id: {
      type: 'number',
      example: 2,
    },
    responsible_id: {
      type: 'number',
      example: 3,
    },
    priority: {
      type: 'number',
      example: 100,
    },
    timelogs: {
      type: 'number',
      example: [
        {
          date: '2025-07-14',
          time_spent: 433,
          user_id: 6,
          description: 'Провел заключительный ретест багов верстки перед выходом в прод (роли: Редактор, Ученик, Админ школы)',
        },
        {
          date: '2025-07-13',
          time_spent: 345435,
          user_id: 8,
          description: 'Подготовка и обсуждение ТЗ с продукт-менеджером',
        },
      ],
    },
    title: {
      type: 'string',
      example: 'Отверстать страницу контакты',
    },
    total_time_spent: {
      type: 'number',
      description: 'Сумма всех таймтреков в секундах',
      example: 478,
    },
    description: {
      type: 'object',
      description: 'Контент в формате JSON для TipTap-редактора',
      example: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Необходимо сверстать страницу контактов.' }],
          },
        ],
      },
    },
    participant_ids: {
      type: 'array',
      description: 'Массив id участников задачи',
      example: [1, 2, 3],
    },
    status: {
      type: 'string',
      enum: Object.values(TASK_STATUSES),
      example: TASK_STATUSES.open,
    },
    created_at: {
      type: 'string',
      example: '2025-07-18T09:55:24.540Z',
    },
    updated_at: {
      type: 'string',
      example: '2025-07-18T09:55:24.540Z',
    },
    closed_date: {
      type: 'string',
      format: 'date-time',
      example: '2025-07-18T09:55:24.540Z',
      nullable: true,
    },
  },
  required: ['id', 'title', 'status', 'priority'],
};
