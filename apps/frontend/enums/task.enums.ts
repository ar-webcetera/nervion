export enum TaskType {
  USER_STORY = 'user-story',
  TASK = 'task',
}

export const TASK_TYPE_OPTIONS = [
  {
    label: 'История',
    value: TaskType.USER_STORY,
  },
  {
    label: 'Задача',
    value: TaskType.TASK,
  },
];
