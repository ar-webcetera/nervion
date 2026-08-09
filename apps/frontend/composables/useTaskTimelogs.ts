import type { Timelog } from '~/types/task';
import { TIMELOG_STATUSES } from '~/types/task';
import { TASK_STATUSES } from '~/constants/task.constants';
import { getErrorMessage } from '~/utils/error';

export const useTaskTimelogs = (taskId: Ref<number | null>) => {
  const timelogStore = useTimelogStore();
  const taskStore = useTaskStore();
  const userStore = useUserStore();
  const { $toast } = useNuxtApp();
  const { updateTaskStatus } = useTaskSidebar(taskId);

  const newTimelog = ref<Partial<Timelog>>({
    time_spent: NaN,
    summary: '',
  });

  const createTimelog = async () => {
    if (!taskId.value || !userStore.user?.id) return null;

    if (taskStore.currentTask?.status === TASK_STATUSES.open || taskStore.currentTask?.status === TASK_STATUSES.to_do) {
      await updateTaskStatus(TASK_STATUSES.in_progress);
      await taskStore.getKanban({ useSavedFilters: true });
    }

    const timelog = await timelogStore.createTimelog({
      task_id: taskId.value,
      author_id: userStore.user.id,
      status: TIMELOG_STATUSES.in_progress,
      tracking_date: taskStore.currentTaskDate ?? undefined,
    });

    if (timelog) {
      timelogStore.upsertCurrentTimelog(timelog);
    }

    const task =
      (taskStore.currentTask?.id === taskId.value ? taskStore.currentTask : null) ??
      taskStore.tasks.find((item) => item.id === taskId.value) ??
      taskStore.tasksWithTimelogs.find((item) => item.id === taskId.value);

    if (task && !taskStore.tasksWithTimelogs.some((item) => item.id === taskId.value)) {
      taskStore.tasksWithTimelogs.push({
        ...task,
        active_tracking_date: timelog?.tracking_date ?? null,
      });
    }
    return timelog;
  };

  const continueTimelog = async () => {
    if (taskStore.currentTask?.status === TASK_STATUSES.open || taskStore.currentTask?.status === TASK_STATUSES.to_do) {
      await updateTaskStatus(TASK_STATUSES.in_progress);
      await taskStore.getKanban({ useSavedFilters: true });
    }
  };

  const fixNewTimelog = async (timelog: Partial<Timelog>) => {
    try {
      if (!timelog.summary) {
        $toast.error('Вы не заполнили поле с описанием');
        return;
      }
      if (!timelog.time_spent || Number.isNaN(timelog.time_spent)) {
        $toast.error('Вы не заполнили поле с затраченным временем');
        return;
      }

      if (!taskId.value || !userStore.user?.id) return;

      const response = await timelogStore.createTimelog({
        task_id: taskId.value,
        author_id: userStore.user.id,
        time_spent: timelog.time_spent,
        summary: timelog.summary,
        status: TIMELOG_STATUSES.completed,
      });

      newTimelog.value = {
        time_spent: NaN,
        summary: '',
      };

      $toast('Логирование времени сохранено');

      return response;
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const currentTimelog = computed(() => {
    if (!timelogStore.currentTimelogs.length) return null;
    return timelogStore.currentTimelogs.find((timelog) => timelog.task_id === taskId.value) || null;
  });

  const resetTimelog = async (timelogId: number, closeModal?: () => void) => {
    try {
      const findTimelog = timelogStore.currentTimelogs.find((timelog) => timelogId === timelog.id);
      if (findTimelog) {
        await timelogStore.deleteTimelog(timelogId);
        taskStore.tasksWithTimelogs = taskStore.tasksWithTimelogs.filter((task) => task.id !== findTimelog.task_id);
        timelogStore.currentTimelogs = timelogStore.currentTimelogs.filter((t) => t.id !== timelogId);
        timelogStore.timelogs = timelogStore.timelogs.filter((t) => t.id !== timelogId);
        $toast('Логирование времени удалено');
        closeModal?.();
      }
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  return {
    newTimelog,
    currentTimelog,
    createTimelog,
    continueTimelog,
    fixNewTimelog,
    resetTimelog,
  };
};
