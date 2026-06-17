export const UpdateTaskResponseDto = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      example: '1475',
    },
    title: {
      type: 'string',
      example: 'test2',
    },
    webUrl: {
      type: 'string',
      example: 'https://tracker.example.com/tasks/10',
    },
    assignees: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: '13',
          },
          name: {
            type: 'string',
            example: 'Сергеев Егор',
          },
        },
      },
    },
    labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: '180',
          },
          title: {
            type: 'string',
            example: 'Выполняется',
          },
        },
      },
    },
    closed_date: {
      type: 'string',
      format: 'date-time',
      example: '2025-07-18T09:55:24.540Z',
      nullable: true,
    },
  },
};
