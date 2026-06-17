import { computed } from 'vue';
import { TASK_STATUS_COLORS, TASK_STATUS_LABELS } from '~/constants/task.constants';
import type { TASK_STATUSES } from '~/types/task';

export const useStatusOptions = () => {
  return computed(() => {
    return (Object.keys(TASK_STATUS_LABELS) as TASK_STATUSES[]).map((key) => ({
      value: key,
      label: TASK_STATUS_LABELS[key],
      color: TASK_STATUS_COLORS[key],
    }));
  });
};
