import type { TaskActivityItem } from '@tracker/contracts';

export const useTaskActivity = (taskId: Ref<number | null | undefined>) => {
  const baseURL = useApiBaseUrl();
  const headers = useRequestHeaders(['cookie']);
  const state = useAsyncData(
    `task-activity-${useId()}`,
    () =>
      taskId.value
        ? $fetch<TaskActivityItem[]>(`/api/tasks/${taskId.value}/activity`, { baseURL, headers, credentials: 'include' })
        : Promise.resolve([]),
    { default: () => [] as TaskActivityItem[], watch: [taskId] },
  );
  const taskStore = useTaskStore();
  let timer: ReturnType<typeof setInterval> | undefined;
  const unsubscribe = taskStore.$onAction(({ name, after }) => {
    if (name === 'updateTask' || name === 'completeRecurringTask' || name === 'uncompleteRecurringTask')
      after(() => {
        void state.refresh();
      });
  });
  onMounted(() => {
    timer = setInterval(() => {
      if (!document.hidden && taskId.value) void state.refresh();
    }, 15000);
  });
  onBeforeUnmount(() => {
    clearInterval(timer);
    unsubscribe();
  });
  return state;
};
