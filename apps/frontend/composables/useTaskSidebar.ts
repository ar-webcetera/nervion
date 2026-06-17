import type { JSONContent } from '@tiptap/core';
import type { SelectOption } from '~/types/select';
import type { User } from '~/types/user';
import type { TASK_STATUSES } from '~/constants/task.constants';
import type { TaskType } from '~/enums/task.enums';
import { getErrorMessage } from '~/utils/error';
import type { Task } from '~/types/task';
import type { KanbanCard } from '~/stores/taskStore';
import { extractPlainText } from '~/utils/extractPainText';
import type { TiptapDoc } from '~/utils/extractPainText';

export const useTaskSidebar = (taskId: Ref<number | null>) => {
  const taskStore = useTaskStore();
  const aiStore = useAiStore();
  const filesStore = useFilesStore();
  const userStore = useUserStore();
  const { $toast } = useNuxtApp();
  const router = useRouter();

  const pending = ref(true);
  const hasError = ref(false);
  const isEditName = ref(false);
  const editableName = ref<string>('');
  const editableDescription = ref<JSONContent>({});
  const originalDescription = ref<JSONContent>({});
  const isEditableDescription = ref(false);
  const isGeneratingDescription = ref(false);
  const descriptionKey = ref(0);
  const responsibleId = ref<number | null>(null);

  const prefix = computed(() => `tracker-tasks/${taskId.value}/`);

  const usersOptions = computed(() => {
    if (userStore.users.length) {
      const users: SelectOption[] = userStore.users.map((user: User) => ({
        label: user.last_name + ' ' + user.first_name,
        value: user.id,
      }));

      if (userStore.user) {
        const currentIndex = users.findIndex((user) => user.value === userStore.user?.id);
        if (currentIndex > -1) {
          const [currentUser] = users.splice(currentIndex, 1);
          users.unshift(currentUser);
        }
      }
      users.unshift({
        label: 'Не назначен',
        value: null,
      });
      return users;
    }
    return [];
  });

  const fetchTask = async () => {
    try {
      if (!taskId.value) return;
      hasError.value = false;
      await taskStore.fetchTask(taskId.value);
    } catch (e) {
      hasError.value = true;
      $toast.error(getErrorMessage(e));
    }
  };

  const fetchData = async () => {
    try {
      await filesStore.fetchFiles(prefix.value);
    } catch (e) {
      console.error(e);
    } finally {
      pending.value = false;
    }
  };

  const openEditPageName = () => {
    if (!taskStore.currentTask) return;
    editableName.value = taskStore.currentTask.title;
    isEditName.value = true;
  };

  const confirmEdit = async () => {
    if (!taskStore.currentTask || !taskId.value) return;
    taskStore.currentTask.title = editableName.value;
    const title = taskStore.currentTask.title;
    await taskStore.updateTask(taskId.value, { title });
    updateTaskInCollections(taskId.value, { title });
    isEditName.value = false;
    closeEditPageName();
  };

  const closeEditPageName = () => {
    if (!taskStore.currentTask) return;
    editableName.value = taskStore.currentTask.title;
    isEditName.value = false;
  };

  const openEditDescription = () => {
    if (!taskStore.currentTask) return;
    originalDescription.value = JSON.parse(JSON.stringify(taskStore.currentTask.description));
    editableDescription.value = taskStore.currentTask.description;
    isEditableDescription.value = true;
  };

  const closeEditDescription = () => {
    if (!taskStore.currentTask) return;
    editableDescription.value = JSON.parse(JSON.stringify(originalDescription.value));
    taskStore.currentTask.description = JSON.parse(JSON.stringify(originalDescription.value));
    isEditableDescription.value = false;
    descriptionKey.value++;
  };

  const updateTaskStatus = async (value: string | number | (string | number)[] | null) => {
    try {
      if (!taskId.value) return;
      const status = value as TASK_STATUSES;
      await taskStore.updateTask(taskId.value, { status });

      const task = taskStore.tasks.find((t) => t.id === taskId.value);
      if (task) task.status = status;
      if (taskStore.currentTask?.id === taskId.value) taskStore.currentTask.status = status;
      moveTaskToStatusColumn(taskId.value, status);
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const updateTaskType = async (value: string | number | (string | number)[] | null) => {
    try {
      if (!taskId.value) return;
      const taskType = value as TaskType;
      await taskStore.updateTask(taskId.value, { taskType });
      updateTaskInCollections(taskId.value, { taskType });
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const updateTaskResponsible = async (value: string | number | (string | number)[] | null) => {
    try {
      if (!taskId.value) return;
      const responsible_id = Number(value) || null;
      await taskStore.updateTask(taskId.value, { responsible_id });
      if (taskStore.currentTask?.id === taskId.value) {
        taskStore.currentTask.responsible_id = responsible_id;
        taskStore.currentTask.responsible = responsible_id
          ? (userStore.users.find((user) => user.id === responsible_id) ?? null)
          : null;
      }
      updateTaskInCollections(taskId.value, { responsible_id });
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const updateTaskDescription = async (value: JSONContent) => {
    try {
      if (!taskId.value) return;
      const description = value;
      await taskStore.updateTask(taskId.value, { description });
      updateTaskInCollections(taskId.value, { description });
      isEditableDescription.value = false;
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const setPlannedDate = async (value: string) => {
    try {
      if (!taskId.value) return;
      const planned_date = value || null;
      await taskStore.updateTask(taskId.value, { planned_date });
      updateTaskInCollections(taskId.value, { planned_date });
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const updateStoryPoints = async (value: number | null) => {
    try {
      if (!taskId.value) return;
      const story_points = value;
      await taskStore.updateTask(taskId.value, { story_points });
      updateTaskInCollections(taskId.value, { story_points } as any);
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const updateRecurrenceDays = async (days: number[] | null) => {
    try {
      if (!taskId.value) return;
      const recurrence_days = days?.length ? days : null;
      await taskStore.updateTask(taskId.value, { recurrence_days });
      if (taskStore.currentTask) {
        taskStore.currentTask.recurrence_days = recurrence_days;
      }
      taskStore.applyRecurrenceChangeToWeeklyView(taskId.value, recurrence_days);
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const moveTaskToStatusColumn = (id: number, status: TASK_STATUSES) => {
    const task = taskStore.tasks.find((t) => t.id === id) ?? (taskStore.currentTask?.id === id ? taskStore.currentTask : null);
    if (!task) return;

    for (const column of taskStore.kanban) {
      const cardIndex = column.cards.findIndex((card) => card.id === id);
      if (cardIndex !== -1) {
        column.cards.splice(cardIndex, 1);
      }
    }

    const targetColumn = taskStore.kanban.find((col) => col.status === status);
    if (targetColumn) {
      const kanbanCard: KanbanCard = {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        projectName: task.project?.name,
        taskType: task.taskType,
        description: extractPlainText(task.description as TiptapDoc, 80),
      };

      const insertIndex = targetColumn.cards.findIndex((card) => card.priority < task.priority);

      if (insertIndex === -1) {
        targetColumn.cards.push(kanbanCard);
      } else {
        targetColumn.cards.splice(insertIndex, 0, kanbanCard);
      }
    }
  };

  const updateTaskInCollections = (id: number, updates: Partial<Task>) => {
    const taskIndex = taskStore.tasks.findIndex((task) => task.id === id);
    if (taskIndex !== -1) {
      Object.assign(taskStore.tasks[taskIndex], updates);
    }

    const timelogIndex = taskStore.tasksWithTimelogs.findIndex((task) => task.id === id);
    if (timelogIndex !== -1) {
      Object.assign(taskStore.tasksWithTimelogs[timelogIndex], updates);
    }

    for (const column of taskStore.kanban) {
      const cardIndex = column.cards.findIndex((card) => card.id === id);
      if (cardIndex !== -1) {
        const card = column.cards[cardIndex];
        if (updates.title !== undefined) card.title = updates.title;
        if (updates.status !== undefined) card.status = updates.status;
        if (updates.priority !== undefined) card.priority = updates.priority;
        if (updates.story_points !== undefined) card.story_points = updates.story_points;
        if (updates.planned_date !== undefined) card.planned_date = updates.planned_date as string | null;
        if (updates.taskType !== undefined) card.taskType = updates.taskType;
        if (updates.description !== undefined) {
          card.description = extractPlainText(updates.description as TiptapDoc, 80);
        }
        if (updates.responsible_id !== undefined) {
          const responsible = updates.responsible_id ? userStore.users.find((u) => u.id === updates.responsible_id) : null;
          card.users = responsible?.photo_url ? [responsible.photo_url] : [];
        }

        if (updates.priority !== undefined) {
          column.cards.splice(cardIndex, 1);

          const insertIndex = column.cards.findIndex((c) => c.priority < card.priority);
          if (insertIndex === -1) {
            column.cards.push(card);
          } else {
            column.cards.splice(insertIndex, 0, card);
          }
        }
      }
    }
  };

  const deleteTask = async () => {
    try {
      if (!taskId.value) return;
      await taskStore.deleteTask(taskId.value);
      taskStore.tasks = taskStore.tasks.filter((task) => task.id !== taskId.value);
      taskStore.tasksWithTimelogs = taskStore.tasksWithTimelogs.filter((task) => task.id !== taskId.value);
      for (const column of taskStore.kanban) {
        column.cards = column.cards.filter((card) => card.id !== taskId.value);
      }
      await router.push({ query: {} });
      $toast.trash('Задача успешно удалена');
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const openTaskSidebar = async (newTaskId: number) => {
    pending.value = true;
    taskStore.currentTaskId = newTaskId;
    await router.push({
      query: { 'task-id': newTaskId },
    });
  };

  const duplicateTask = async () => {
    try {
      if (!taskId.value) return;
      const newTask = await taskStore.duplicateTask(taskId.value);
      // Сразу показываем копию на доске в колонке её статуса
      moveTaskToStatusColumn(newTask.id, newTask.status);
      $toast.success('Задача продублирована');
      await openTaskSidebar(newTask.id);
      return newTask;
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const generateDescription = async (instruction?: string) => {
    if (!taskStore.currentTask) return;
    isGeneratingDescription.value = true;
    try {
      const parsedTask = await aiStore.parseTextToTask(
        JSON.stringify(taskStore.currentTask.description),
        instruction,
      );
      taskStore.currentTask.description = parsedTask.description;
      editableDescription.value = parsedTask.description;
      descriptionKey.value++;
      $toast.success('Описание успешно сгенерировано');
    } catch (e) {
      $toast.error(getErrorMessage(e));
    } finally {
      isGeneratingDescription.value = false;
    }
  };

  return {
    pending,
    hasError,
    isEditName,
    editableName,
    closeEditDescription,
    isEditableDescription,
    editableDescription,
    isGeneratingDescription,
    descriptionKey,
    responsibleId,
    prefix,
    usersOptions,
    fetchTask,
    fetchData,
    openEditPageName,
    confirmEdit,
    closeEditPageName,
    updateTaskStatus,
    updateTaskType,
    updateTaskResponsible,
    updateTaskDescription,
    openEditDescription,
    setPlannedDate,
    deleteTask,
    duplicateTask,
    openTaskSidebar,
    generateDescription,
    updateTaskInCollections,
    updateStoryPoints,
    updateRecurrenceDays,
  };
};
