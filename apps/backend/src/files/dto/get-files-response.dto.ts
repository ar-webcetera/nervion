export const GetFilesResponseDto = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      Key: {
        type: 'string',
        example: 'task-files/123/OJ6KiXQUNdA.jpg',
        description: 'Путь до файла',
      },
      LastModified: {
        type: 'string',
        format: 'date-time',
        example: '2025-03-24T04:27:26.864Z',
        description: 'Дата изменения',
      },
      ETag: {
        type: 'string',
        example: 'f19a9e8594403bd7cd82f2e9b56dd4a4',
        description: 'ETag файла',
      },
      Size: {
        type: 'number',
        example: 949935,
        description: 'Размер файла в байтах',
      },
      StorageClass: {
        type: 'string',
        example: 'STANDARD',
        description: 'Тип хранилища',
      },
    },
  },
};
