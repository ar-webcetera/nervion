<script setup lang="ts">
import { TaskType } from '~/types/task';

const props = defineProps<{ taskType: TaskType }>();
const label = computed(() => (props.taskType === TaskType.USER_STORY ? 'Фича' : 'Задача'));
</script>

<template>
  <span
    class="task-type-badge"
    :class="`task-type-badge_${taskType === TaskType.USER_STORY ? 'story' : 'task'}`"
    role="img"
    :aria-label="label"
    :title="label"
  >
    <IconsIconTypeUserStory v-if="taskType === TaskType.USER_STORY" aria-hidden="true" />
    <IconsIconTypeTask v-else aria-hidden="true" />
  </span>
</template>

<style scoped lang="scss">
.task-type-badge {
  width: 18px;
  height: 18px;
  padding: 1px;
  border-radius: 4px;
  flex: 0 0 18px;
  @include flex(center);

  &_task {
    border: 1px solid var(--primary);
    background: var(--primary-50);
  }

  &_story {
    border: 1px solid var(--accent);
    background: var(--accent-50);
  }
}
</style>
