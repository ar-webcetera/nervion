import { TASK_STATUSES } from '@tracker/contracts';

export const MAX_TASK_NAME_LENGTH = 150;
export { TASK_STATUSES };

export const TASK_STATUS_LABELS: Record<TASK_STATUSES, string> = {
  [TASK_STATUSES.open]: 'Открыто',
  [TASK_STATUSES.to_do]: 'К выполнению',
  [TASK_STATUSES.in_progress]: 'Выполняется',
  [TASK_STATUSES.in_review]: 'На ревью',
  [TASK_STATUSES.testing]: 'На тестировании',
  [TASK_STATUSES.ready_for_release]: 'Готово к релизу',
  [TASK_STATUSES.prod_check]: 'Проверка на проде',
  [TASK_STATUSES.control]: 'Контроль',
  [TASK_STATUSES.closed]: 'Закрыто',
};

export const TASK_STATUS_COLORS: Record<TASK_STATUSES, string> = {
  [TASK_STATUSES.open]: '#FEFEFE',
  [TASK_STATUSES.to_do]: '#38AEF7',
  [TASK_STATUSES.in_progress]: '#F59E0B',
  [TASK_STATUSES.in_review]: '#6F57F3',
  [TASK_STATUSES.testing]: '#F43F5E',
  [TASK_STATUSES.ready_for_release]: '#10B981',
  [TASK_STATUSES.prod_check]: '#06B6D4',
  [TASK_STATUSES.control]: '#513ACF',
  [TASK_STATUSES.closed]: '#059669',
};
