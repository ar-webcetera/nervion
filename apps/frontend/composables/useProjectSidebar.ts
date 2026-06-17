import type { JSONContent } from '@tiptap/core';
import { getErrorMessage } from '~/utils/error';
import type { Project } from '~/types/project';
import { useProjectStore } from '~/stores/projectStore';

import type { PROJECT_STATUSES } from '~/constants/project.constants';
import type BaseModal from '~/components/BaseModal.vue';

export const useProjectSidebar = (project: Ref<Project | null>) => {
  const aiStore = useAiStore();
  const projectStore = useProjectStore();
  const { $toast } = useNuxtApp();

  const editableDescription = ref<JSONContent>(project.value?.description || {});
  const isEditableDescription = ref(false);
  const isGeneratingDescription = ref(false);
  const deleteProjectModal = ref<InstanceType<typeof BaseModal> | null>(null);

  const openDeleteProjectModal = () => {
    if (!deleteProjectModal.value) return;
    deleteProjectModal.value.open();
  };

  const closeDeleteProjectModal = () => {
    if (!deleteProjectModal.value) return;
    deleteProjectModal.value.close();
  };

  const openEditDescription = () => {
    if (!project.value) return;
    editableDescription.value = project.value.description || {};
    isEditableDescription.value = true;
  };

  const closeEditDescription = () => {
    if (!project.value) return;
    editableDescription.value = project.value.description || {};
    isEditableDescription.value = false;
  };

  const updateProjectDescription = async (description: JSONContent) => {
    try {
      if (!project.value) return;
      const updatedProject = await projectStore.updateProject(project.value.id, { description });
      if (updatedProject && project.value) {
        project.value.description = updatedProject.description;
      }
      isEditableDescription.value = false;
      $toast.success('Описание проекта обновлено');
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const updateProjectStatus = async (status: PROJECT_STATUSES) => {
    try {
      if (!project.value) return;
      const updatedProject = await projectStore.updateProject(project.value.id, { status });
      if (updatedProject && project.value) {
        project.value.status = updatedProject.status;
      }
      $toast.success('Статус проекта обновлен');
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const updateProjectBudget = async (budget: number) => {
    try {
      if (!project.value) return;
      const updatedProject = await projectStore.updateProject(project.value.id, { budget });
      if (updatedProject && project.value) {
        project.value.budget = updatedProject.budget;
      }
      $toast.success('Бюджет проекта обновлен');
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const updateProjectHourlyRate = async (hourlyRate: number) => {
    try {
      if (!project.value) return;
      const updatedProject = await projectStore.updateProject(project.value.id, { hourlyRate });
      if (updatedProject && project.value) {
        project.value.hourlyRate = updatedProject.hourlyRate;
      }
      $toast.success('Часовая ставка обновлена');
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  };

  const generateDescription = async (instruction?: string) => {
    if (!project.value) return;
    isGeneratingDescription.value = true;
    try {
      const parsedProject = await aiStore.parseTextToTask(
        JSON.stringify(editableDescription.value),
        instruction,
      );
      editableDescription.value = parsedProject.description;
      $toast.success('Описание успешно сгенерировано');
    } catch (e) {
      $toast.error(getErrorMessage(e));
    } finally {
      isGeneratingDescription.value = false;
    }
  };

  return {
    editableDescription,
    isEditableDescription,
    isGeneratingDescription,
    openEditDescription,
    closeEditDescription,
    updateProjectDescription,
    updateProjectStatus,
    updateProjectBudget,
    updateProjectHourlyRate,
    generateDescription,
    openDeleteProjectModal,
    closeDeleteProjectModal,
    deleteProjectModal,
  };
};
