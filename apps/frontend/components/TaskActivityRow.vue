<script setup lang="ts">
import { AuditActionType, TaskBillingType, type TaskActivityItem } from '@tracker/contracts';
import { History } from '@lucide/vue';
import { TASK_STATUS_LABELS } from '~/constants/task.constants';
import { TASK_TYPE_OPTIONS } from '~/enums/task.enums';

const props = defineProps<{ activity: TaskActivityItem }>();
const actionLabel = computed(() => {
  switch (props.activity.action_type) {
    case AuditActionType.TASK_CREATED:
      return 'Создание задачи';
    case AuditActionType.TASK_COMPLETED:
      return 'Отмечено выполнение задачи';
    case AuditActionType.TASK_UNCOMPLETED:
      return 'Отменена отметка выполнения';
    case AuditActionType.TASK_RECURRENCE_CHANGED:
      return 'Изменение повторения';
    default:
      return 'Изменение задачи';
  }
});
const formattedDate = computed(() =>
  new Date(props.activity.created_at).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }),
);
const valueLabel = (field: string, value: string | null) => {
  if (field === 'billing_type') {
    if (value === TaskBillingType.HOURLY) return 'Почасовая';
    if (value === TaskBillingType.FIXED) return 'Фиксированная';
    return 'Не учитывать';
  }
  if (field === 'recurrence_days') {
    const days = value?.match(/[0-6]/g) ?? [];
    const labels = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    return days.length ? days.map((day) => labels[Number(day)]).join(', ') : 'Без повторения';
  }
  if (value == null || value === '') return 'Не указано';
  if (field === 'status') return Object.entries(TASK_STATUS_LABELS).find(([key]) => key === value)?.[1] ?? value;
  if (field === 'taskType') return TASK_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
  if (['planned_date', 'closed_date', 'recurrence_since'].includes(field)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('ru-RU');
  }
  return value;
};
</script>

<template>
  <article class="task-activity">
    <History class="task-activity__icon" :size="16" aria-hidden="true" />
    <div class="task-activity__content">
      <div class="task-activity__header">
        <strong>{{ activity.actor_name }}</strong>
        <time :datetime="activity.created_at" :title="formattedDate">{{ formattedDate }}</time>
      </div>
      <div>{{ actionLabel }}</div>
      <ul v-if="activity.changes.length" class="task-activity__changes">
        <li v-for="change in activity.changes" :key="change.field">
          <template v-if="change.field === 'description'">Обновлено описание</template>
          <template v-else>
            <span>{{ change.label }}: </span>
            <span class="task-activity__before">{{ valueLabel(change.field, change.before) }}</span>
            <span> на </span>
            <span>{{ valueLabel(change.field, change.after) }}</span>
          </template>
        </li>
      </ul>
    </div>
  </article>
</template>

<style scoped lang="scss">
.task-activity {
  @include flex(rn, a-start);
  gap: 12px;
  padding: 4px 0;
  color: var(--light-text-backgroung-primary);
  @extend %text-s-regular;

  &__icon {
    position: relative;
    background: var(--dark-text-background-primary);
    box-shadow: 0 0 0 3px var(--dark-text-background-primary);
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--light-text-backgroung-primary-50);
  }
  &__content {
    @include flex(cn);
    gap: 2px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  &__header {
    @include flex(rw, a-center);
    gap: 4px 12px;
    strong {
      @extend %text-s-medium;
    }
    time {
      @extend %text-xs-regular;
      color: var(--light-text-backgroung-primary-50);
    }
  }
  &__changes {
    @include flex(cn);
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  &__before {
    color: var(--light-text-backgroung-primary-50);
    text-decoration: line-through;
  }
}
</style>
