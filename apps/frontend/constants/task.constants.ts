import type { TaskStatus } from '@tracker/contracts';
import { TASK_STATUSES } from '@tracker/contracts';

export const MAX_TASK_NAME_LENGTH = 150;
export { TASK_STATUSES };

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  [TASK_STATUSES.archive]: 'Архив',
  [TASK_STATUSES.open]: 'Открыто',
  [TASK_STATUSES.to_do]: 'К выполнению',
  [TASK_STATUSES.in_progress]: 'Выполняется',
  [TASK_STATUSES.waiting]: 'Ожидание',
  [TASK_STATUSES.in_review]: 'На ревью',
  [TASK_STATUSES.control]: 'Контроль',
  [TASK_STATUSES.closed]: 'Закрыто',
};

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  [TASK_STATUSES.archive]: '#8B8B8B',
  [TASK_STATUSES.open]: '#FEFEFE',
  [TASK_STATUSES.to_do]: '#38AEF7',
  [TASK_STATUSES.in_progress]: '#F59E0B',
  [TASK_STATUSES.waiting]: 'var(--status-waiting)',
  [TASK_STATUSES.in_review]: '#6F57F3',
  [TASK_STATUSES.control]: '#513ACF',
  [TASK_STATUSES.closed]: '#059669',
};

export const TASK_STATUS_DESCRIPTIONS: Record<TaskStatus, string> = {
  [TASK_STATUSES.archive]: 'Вход: задача больше не участвует в работе. Выход: вернуть в "Открыто", если она снова актуальна.',
  [TASK_STATUSES.open]:
    'Вход: задача зафиксирована, но еще не готова к выполнению. Выход: уточнить условия и перенести в "К выполнению".',
  [TASK_STATUSES.to_do]:
    'Вход: задача понятна и готова к старту. Выход: начать работу или перенести в "Ожидание", если появился блокер.',
  [TASK_STATUSES.in_progress]:
    'Вход: по задаче идет работа. Выход: передать результат на ревью, закрыть задачу или перенести в "Ожидание".',
  [TASK_STATUSES.waiting]:
    'Вход: продолжение зависит от ответа, информации, доступа или решения. Выход: после снятия блокера вернуть задачу в рабочий статус.',
  [TASK_STATUSES.in_review]:
    'Вход: результат готов и его можно проверить. Выход: вернуть в работу на доработку, перевести на контроль или закрыть.',
  [TASK_STATUSES.control]:
    'Вход: результат принят, но его нужно проверить спустя время. Выход: закрыть задачу или вернуть в работу по итогам проверки.',
  [TASK_STATUSES.closed]:
    'Вход: результат принят и дополнительных действий не требуется. Выход: переоткрыть задачу, если работа возобновилась.',
};
