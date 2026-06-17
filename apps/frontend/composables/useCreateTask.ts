import { ref, computed } from 'vue';
import { useTaskStore } from '~/stores/taskStore';
import { TaskType } from '~/enums/task.enums';
import { TASK_STATUSES } from '~/constants/task.constants';
import type { JSONContent } from '@tiptap/core';
import type { Task } from '~/types/task';

export const useCreateTask = () => {
  const taskStore = useTaskStore();
  const { $toast } = useNuxtApp();

  const newTask = ref({
    title: '',
    description: {} as JSONContent,
    status: TASK_STATUSES.open,
    taskType: TaskType.TASK,
    project_id: null as number | null,
    responsible_id: null as number | null,
    planned_date: null as string | null,
  });

  const isCreating = ref(false);

  const isDisabled = computed(() => {
    return isCreating.value;
  });

  const createTask = async (): Promise<Task | null> => {
    if (!newTask.value.title.trim()) {
      $toast.error('Введите название');
      return null;
    }

    if (!newTask.value.project_id) {
      $toast.error('Выберите проект');
      return null;
    }

    try {
      isCreating.value = true;

      const createdTask = await taskStore.createTask({
        title: newTask.value.title,
        description: newTask.value.description,
        status: newTask.value.status,
        taskType: newTask.value.taskType,
        project_id: newTask.value.project_id,
        responsible_id: newTask.value.responsible_id,
        planned_date: newTask.value.planned_date,
      });

      $toast.success('Задача успешно создана');

      await Promise.all([taskStore.fetchTasks({ useSavedFilters: true }), taskStore.getKanban({ useSavedFilters: true })]);

      return createdTask;
    } catch (error) {
      console.error('Ошибка создания задачи:', error);
      $toast.error('Не удалось создать задачу');
      return null;
    } finally {
      isCreating.value = false;
    }
  };

  const resetForm = () => {
    newTask.value = {
      title: '',
      description: {} as JSONContent,
      status: TASK_STATUSES.open,
      taskType: TaskType.TASK,
      project_id: null,
      responsible_id: null,
      planned_date: null,
    };
  };

  return {
    newTask,
    isCreating,
    isDisabled,
    createTask,
    resetForm,
  };
};
