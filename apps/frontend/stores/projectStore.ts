import { defineStore } from 'pinia';
import type { Ref } from 'vue';
import type { Project } from '~/types/project';
import { useUserStore } from '~/stores/userStore';
import { PROJECT_STATUSES } from '~/constants/project.constants';

export const useProjectStore = defineStore('project', () => {
  const tenantFetch = useTenantFetch();
  const apiBaseUrl = useApiBaseUrl();
  const requestHeaders = useApiRequestHeaders();
  const projects = ref<Project[]>([]);
  const revision = ref(0);
  const projectsWithArchived = ref<Project[]>([]);

  interface CreateProjectPayload {
    name: string;
    description?: Project['description'];
    status: PROJECT_STATUSES;
    budget: number;
    hourlyRate: number;
    isPrivate: boolean;
  }

  const upsertProject = (list: Ref<Project[]>, project: Project) => {
    const index = list.value.findIndex((item) => item.id === project.id);

    if (index === -1) {
      list.value.push(project);
      return;
    }

    list.value[index] = { ...list.value[index], ...project };
  };

  const removeProjectFromList = (list: Ref<Project[]>, projectId: number) => {
    const index = list.value.findIndex((project) => project.id === projectId);

    if (index !== -1) {
      list.value.splice(index, 1);
    }
  };

  const syncActiveProject = (project: Project) => {
    if (project.status === PROJECT_STATUSES.on_hold) {
      removeProjectFromList(projects, project.id);
      return;
    }

    upsertProject(projects, project);
  };

  const fetchProjectList = async (endpoint: string): Promise<Project[]> => {
    const cookies = requestHeaders;
    const response = await tenantFetch<Project[]>(endpoint, {
      baseURL: apiBaseUrl,
      credentials: 'include',
      method: 'GET',
      headers: {
        ...cookies,
      },
    });

    return response || [];
  };

  const fetchProjects = async () => {
    const userStore = useUserStore();
    const endpoint = userStore.user?.role === 'admin' ? '/api/projects' : '/api/projects/me';
    projects.value = await fetchProjectList(endpoint);
  };

  const fetchMyProjects = async () => {
    projects.value = await fetchProjectList('/api/projects/me');
  };

  const fetchProjectsWithArchived = async () => {
    projectsWithArchived.value = await fetchProjectList('/api/projects/with-archived');
    projects.value = projectsWithArchived.value.filter((project) => project.status !== PROJECT_STATUSES.on_hold);
  };

  const createProject = async (projectData: CreateProjectPayload) => {
    const headers = useApiRequestHeaders();
    const response = await tenantFetch<Project>('/api/projects', {
      baseURL: apiBaseUrl,
      credentials: 'include',
      method: 'POST',
      headers,
      body: projectData,
    });

    if (response) {
      syncActiveProject(response);
      upsertProject(projectsWithArchived, response);
    }
  };

  const updateProject = async (projectId: number, data: Partial<Project>) => {
    const headers = useApiRequestHeaders();
    const updatedProject = await tenantFetch<Project>(`/api/projects/${projectId}`, {
      baseURL: apiBaseUrl,
      credentials: 'include',
      method: 'PATCH',
      headers,
      body: data,
    });

    if (updatedProject) {
      useTaskStore().tasksPageHydrated = false;
      syncActiveProject({ ...projectsWithArchived.value.find((project) => project.id === projectId), ...updatedProject });
      upsertProject(projectsWithArchived, updatedProject);
    }
    return updatedProject;
  };

  const deleteProject = async (projectId: number) => {
    const headers = useApiRequestHeaders();
    await tenantFetch(`/api/projects/${projectId}`, {
      baseURL: apiBaseUrl,
      credentials: 'include',
      method: 'DELETE',
      headers,
    });

    useTaskStore().tasksPageHydrated = false;
    removeProjectFromList(projects, projectId);
    removeProjectFromList(projectsWithArchived, projectId);
  };

  return {
    revision,
    projects,
    projectsWithArchived,
    fetchProjects,
    fetchProjectsWithArchived,
    createProject,
    fetchMyProjects,
    updateProject,
    deleteProject,
  };
});
