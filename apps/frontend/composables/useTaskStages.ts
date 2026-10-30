import type { TaskStage } from '@tracker/contracts';

export const useTaskStages = () => {
  const stages = useState<TaskStage[]>('task-stages', () => []);
  const baseURL = useApiBaseUrl();
  const headers = useApiRequestHeaders();
  const refresh = async () => {
    stages.value = await $fetch<TaskStage[]>('/api/tasks/stages', { baseURL, credentials: 'include', headers });
    return stages.value;
  };
  return { stages, refresh };
};
