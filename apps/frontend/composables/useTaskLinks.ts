import type { Task } from '~/types/task';
import { debounce } from '~/utils/debounce';
import { getErrorMessage } from '~/utils/error';
import { TypeLinkTask } from '~/enums/task-link.enums';

export const useTaskLinks = (taskId: Ref<number | null>) => {
  const taskStore = useTaskStore();
  const { $toast } = useNuxtApp();

  const isOpenLinkInput = ref(false);
  const typeLinkTask = ref<TypeLinkTask>(TypeLinkTask.NEW);
  const newLinkTaskName = ref('');
  const isOpenExitingTaskDropdown = ref(false);
  const existingTasks = ref<Task[]>([]);
  const createLinkTaskLoader = ref(false);
  const deleteLinkLoader = ref<{ [key: number]: boolean }>({});

  const fetchTask = async () => {
    try {
      if (!taskId.value) return;
      await taskStore.fetchTask(taskId.value);
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const createNewLinkTask = async () => {
    try {
      if (newLinkTaskName.value.length < 3) {
        $toast.error('Название задачи должно содержать не менее 3 символов');
        return;
      }
      if (!taskId.value) return;

      createLinkTaskLoader.value = true;
      const projectId = taskStore.currentTask?.project?.id;
      if (!projectId) return;

      const newTask = await taskStore.createTask({
        title: newLinkTaskName.value,
        project_id: projectId,
      });

      if (newTask) {
        await taskStore.linkExistingTask(taskId.value, newTask.id);
      }

      newLinkTaskName.value = '';
      isOpenLinkInput.value = false;
      await fetchTask();
    } catch (e) {
      console.error(e);
      $toast.error(getErrorMessage(e));
    } finally {
      createLinkTaskLoader.value = false;
      existingTasks.value = [];
    }
  };

  const linkExistingTask = async (id: number) => {
    try {
      if (!taskId.value) return;
      await taskStore.linkExistingTask(taskId.value, id);
      await fetchTask();
    } catch (e) {
      console.error(e);
      $toast.error(getErrorMessage(e));
    } finally {
      existingTasks.value = [];
      newLinkTaskName.value = '';
      isOpenExitingTaskDropdown.value = false;
      isOpenLinkInput.value = false;
    }
  };

  const unlinkTask = async (linkedTaskId: number) => {
    try {
      if (!taskId.value) return;
      deleteLinkLoader.value[linkedTaskId] = true;
      await taskStore.unlinkTask(linkedTaskId, taskId.value);

      if (taskStore.currentTask) {
        taskStore.currentTask.related_tasks = taskStore.currentTask.related_tasks.filter((t) => t.id !== linkedTaskId);
      }
    } catch (e) {
      console.error(e);
      $toast.error(getErrorMessage(e));
    } finally {
      deleteLinkLoader.value[linkedTaskId] = false;
    }
  };

  const debounceChangeTitle = debounce(async (_e: Event) => {
    try {
      const projectId = taskStore.currentTask?.project?.id;
      if (!projectId) return;
      const existingTasksResponse = await taskStore.fetchTasks({
        title: newLinkTaskName.value,
        projects: [projectId],
      });
      existingTasks.value = existingTasksResponse;
    } catch (e) {
      console.error(e);
    }
  }, 300);

  const cancelLinkTask = () => {
    isOpenLinkInput.value = false;
    isOpenExitingTaskDropdown.value = false;
    existingTasks.value = [];
    typeLinkTask.value = TypeLinkTask.EXISTING;
  };

  return {
    isOpenLinkInput,
    typeLinkTask,
    newLinkTaskName,
    isOpenExitingTaskDropdown,
    existingTasks,
    createLinkTaskLoader,
    deleteLinkLoader,
    createNewLinkTask,
    linkExistingTask,
    unlinkTask,
    debounceChangeTitle,
    cancelLinkTask,
  };
};
