import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { TASK_STATUS_COLORS, TASK_STATUS_LABELS } from '~/constants/task.constants';

export const useStatusOptions = (sales: MaybeRefOrGetter<boolean> = false) => {
  const { stages } = useTaskStages();
  return computed(() => {
    const definitions = toValue(sales)
      ? ['to_do', 'in_progress', 'closed'].map((id) => ({ id, title: TASK_STATUS_LABELS[id] }))
      : stages.value;
    return definitions.map((stage) => ({
      value: stage.id,
      label: stage.title,
      color: TASK_STATUS_COLORS[stage.id] ?? 'var(--light-text-backgroung-primary-50)',
    }));
  });
};
