<script setup lang="ts">
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useProjectStore } from '~/stores/projectStore';
import { ROLES } from '@/types/user';
import { getErrorMessage } from '~/utils/error';
import type { Project } from '~/types/project';
import { PROJECT_STATUSES, PROJECT_STATUS_OPTIONS, getStatusColor } from '~/constants/project.constants';
import ProjectSidebar from '~/components/ProjectSidebar.vue';
import ProjectMembersModal from '~/components/ProjectMembersModal.vue';
import IconPlus from '~/components/Icons/IconPlus.vue';
import IconAddUser from '~/components/Icons/IconAddUser.vue';
import { useProject } from '~/composables/useProject';
const config = useRuntimeConfig();

const { $toast } = useNuxtApp();
const projectStore = useProjectStore();
const userStore = useUserStore();
const isOpenTaskCreateModal = ref(false);

const selectedProject = ref<Project | null>(null);
const isProjectSidebarOpen = ref(false);
const selectedProjectForMembers = ref<Project | null>(null);

const { membersModal, openMembersModal } = useProject();

await useAsyncData('projects-with-archived', async () => {
  await projectStore.fetchProjectsWithArchived();
  return true;
});

const currentMonthName = computed(() => {
  return format(new Date(), 'LLLL', { locale: ru });
});

const getProgressColor = (current: number, total: number): string => {
  if (total === 0) return '#10B981';
  const percentage = (current / total) * 100;

  if (percentage >= 90) return '#FB1616';
  if (percentage >= 70) return '#F59E0B';
  return '#10B981';
};

const getStatusLabel = (status: string): string => {
  const statusOption = PROJECT_STATUS_OPTIONS.find((option) => option.value === status);
  return statusOption?.label || status;
};

const openCreateProjectSidebar = () => {
  selectedProject.value = {
    id: 0,
    name: '',
    description: {},
    status: 'in_progress',
    budget: 0,
    hourlyRate: 0,
    spentBudget: 0,
    members: [],
  } as Project;
  isProjectSidebarOpen.value = true;
  isOpenTaskCreateModal.value = false;
};

const createProjectFromSidebar = async (project: Project) => {
  if (!selectedProject.value || !selectedProject.value.name.trim()) {
    $toast.error('Введите название проекта');
    return;
  }

  try {
    selectedProject.value = project;
    const projectName = selectedProject.value.name.trim();
    await projectStore.createProject({
      name: projectName,
      description: selectedProject.value.description,
      status: selectedProject.value.status as PROJECT_STATUSES,
      budget: Math.max(0, selectedProject.value.budget),
      hourlyRate: Math.max(0, selectedProject.value.hourlyRate),
    });
    await projectStore.fetchProjectsWithArchived();
    closeProjectSidebar();
    $toast.success(`Проект “${projectName}” создан`);
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const openProjectSidebar = (project: Project) => {
  if (userStore.user?.role !== ROLES.admin) return;
  selectedProject.value = project;
  isProjectSidebarOpen.value = true;
};

const closeProjectSidebar = () => {
  isProjectSidebarOpen.value = false;
  selectedProject.value = null;
};

const openSelectedMembersModal = (project: Project) => {
  selectedProjectForMembers.value = project;
  openMembersModal();
};

const saveMembersModal = async (membersData: Array<{ id: number; role: string }>) => {
  if (!selectedProjectForMembers.value) return;
  try {
    await $fetch(`/api/projects/${selectedProjectForMembers.value.id}/members`, {
      baseURL: config.public.API_URL,
      method: 'PATCH',
      credentials: 'include',
      body: { members: membersData },
    });

    await projectStore.fetchProjectsWithArchived();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const deleteProject = async () => {
  if (!selectedProject.value) return;

  try {
    const projectName = selectedProject.value.name;
    await projectStore.deleteProject(selectedProject.value.id);
    $toast.trash(`Проект “${projectName}” успешно удален`);
    closeProjectSidebar();
  } catch (e) {
    if (!import.meta.server) {
      $toast.error(getErrorMessage(e));
    }
  }
};

definePageMeta({
  middleware: ['auth', 'role'],
  name: 'projects',
  roles: [ROLES.admin, ROLES.employee, ROLES.guest],
});
</script>

<template>
  <div class="project">
    <div class="project__header">
      <div class="project__title">Проекты</div>
      <div class="project__add-task">
        <div v-if="userStore.user?.role === ROLES.admin" class="project__open-modal" @click.stop="openCreateProjectSidebar">
          <button>
            <IconsIconPlus />
            Новый проект
          </button>
        </div>
      </div>
    </div>
    <div class="divider" />

    <div v-if="!projectStore.projectsWithArchived.length" class="project__empty">Список проектов пуст</div>
    <div v-else class="project__items">
      <div
        v-for="project of projectStore.projectsWithArchived"
        :key="project.id"
        :class="['project-item', { 'project-item_hold': project.status === PROJECT_STATUSES.on_hold }]"
        @click="openProjectSidebar(project)"
      >
        <div class="project-item__header">
          <span class="project-item__title">{{ project.name }}</span>
          <IconsIconArrowRight v-if="userStore.user?.role === ROLES.admin" class="project-item__arrow" />
        </div>

        <div v-if="userStore.user?.role === ROLES.admin" class="project-item__content">
          <div class="project-item__subtitle">Выработка за {{ currentMonthName }}</div>

          <div class="project-item__progress-text">
            <span class="project-item__progress-current">
              {{ Math.round(project.spentBudget) }}
            </span>
            <span class="project-item__progress-total">/{{ project.budget }}</span>
          </div>

          <div class="project-item__progress">
            <div class="project-item__progress-bar">
              <div
                class="project-item__progress-fill"
                :style="{
                  width: project.budget > 0 ? Math.min((project.spentBudget / project.budget) * 100, 100) + '%' : '0%',
                  backgroundColor: getProgressColor(project.spentBudget, project.budget),
                }"
              ></div>
            </div>
          </div>
        </div>

        <div class="project-item__footer">
          <div class="project-item__status" :style="{ color: getStatusColor(project.status) }">
            {{ getStatusLabel(project.status) }}
          </div>
          <div class="project-item__members" @click.stop="openSelectedMembersModal(project)">
            <div class="project-item__members-container">
              <ProjectMemberAvatar
                v-for="(member, idx) in (project.members || []).slice(0, 3)"
                :key="member.id"
                :style="{ 'z-index': 3 - idx }"
                :member="member"
              />
              <div v-if="(project.members || []).length > 3" class="project-item__more">
                +{{ (project.members || []).length - 3 }}
              </div>
            </div>
            <template v-if="userStore.user?.role === ROLES.admin">
              <button v-if="project.members?.length" title="Управлять участниками" class="project-item__members-button">
                <IconPlus />
              </button>
              <div v-else class="project-item__add-user">
                <IconAddUser />
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <ProjectSidebar
      v-if="isProjectSidebarOpen && selectedProject"
      :project="selectedProject"
      @close="closeProjectSidebar"
      @delete="deleteProject"
      @create="createProjectFromSidebar"
    />

    <teleport to="#teleports">
      <BaseModal ref="membersModal">
        <ProjectMembersModal v-if="selectedProjectForMembers" :project="selectedProjectForMembers" @save="saveMembersModal" />
      </BaseModal>
    </teleport>
  </div>
</template>

<style scoped lang="scss">
:deep(.base-modal__content) {
  width: auto;
}

.project-create-project-modal {
  z-index: 100;
  position: absolute;
  border-radius: 16px;
  background: var(--black-50);
  backdrop-filter: blur(12px);
  padding: 20px;
  top: 46px;
  right: 0;
  width: 540px;
  @include flex(cn);
  gap: 24px;

  &__name {
    input {
      width: 100%;
      padding: 18px 20px;
      border-radius: 12px;
      background: var(--light-text-backgroung-primary-5);
      color: var(--white-100);
      @extend %p14-medium;

      &::placeholder {
        color: var(--white-50);
      }
    }
  }

  &__button {
    margin-top: 24px;
    width: 100%;
    display: flex;
    justify-content: flex-end;

    button {
      display: flex;
      border-radius: 8px;
      width: 32px;
      height: 32px;
      align-items: center;
      justify-content: center;
      background: var(--primary-100);

      svg {
        width: 24px;
        height: 24px;
      }
    }

    &_grey {
      button {
        background: var(--white-50);
      }
    }
  }

  &__spinner {
    display: inline-block;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--white-100);
    border-top-color: transparent;
    animation: project-create-project-modal-spinner 0.6s linear infinite;
  }
}

@keyframes project-create-project-modal-spinner {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.loader {
  &__container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }
}

.divider {
  width: 100%;
  height: 1px;
  background-color: var(--light-text-backgroung-primary-10);
}

.project {
  width: 100%;
  height: 100dvh;
  padding: 16px;
  min-width: 0;
  flex: 1;
  @include flex(cn);

  &__header {
    @include flex(rn, a-center);
    margin-bottom: 16px;
    justify-content: space-between;
    gap: 12px;
  }

  &__add-task {
    position: relative;
    cursor: pointer;

    &_rotate {
      transition: transform 0.5s ease;
      transform: rotate(45deg);
    }
  }

  &__open-modal {
    border-radius: 1000px;
    display: flex;
    align-items: center;
    @extend %text-s-regular;
    justify-content: center;
    transition: transform 0.5s ease;
    transform: rotate(0deg);

    svg {
      stroke: var(--light-text-backgroung-primary);
    }
  }

  &__title {
    @extend %display-xs-medium;
  }

  &__items {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-top: 16px;
    overflow: auto;

    @media (max-width: $screen-desktop-xl) {
      grid-template-columns: repeat(3, 1fr);
    }

    @media (max-width: $screen-desktop-l) {
      grid-template-columns: repeat(2, 1fr);
    }

    @media (max-width: $screen-tablet) {
      grid-template-columns: repeat(1, 1fr);
    }
  }

  &__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: var(--white-50);
    @extend %text-m-medium;
  }
}

.project-item {
  @include flex(cn, between);
  border-radius: 8px;
  background: var(--light-text-backgroung-primary-5);
  backdrop-filter: blur(12px);
  padding: 8px;
  cursor: pointer;
  transition: background 0.2s ease;

  &_hold {
    opacity: 0.6;
  }

  &:hover {
    background: var(--light-text-backgroung-primary-10);
  }

  &__header {
    @include flex(rn, a-center, between);
    width: 100%;
  }

  &__title {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__arrow {
    width: 14px;
    height: 14px;
    stroke: var(--light-text-backgroung-primary);
  }

  &__content {
    margin-top: 8px;
    @include flex(cn);
    gap: 4px;
    width: 100%;
  }

  &__subtitle {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__progress {
    @include flex(cn);
    gap: 8px;
    width: 100%;
  }

  &__progress-bar {
    width: 100%;
    height: 8px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    overflow: hidden;
  }

  &__progress-fill {
    height: 100%;
    border-radius: 8px;
    transition:
      width 0.3s ease,
      background-color 0.3s ease;
  }

  &__progress-text {
    @include flex(rn, a-center);
  }

  &__progress-current {
    @extend %text-xs-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__progress-total {
    @extend %text-xs-medium;
    color: var(--light-text-backgroung-primary-50);
  }

  &__footer {
    margin-top: 60px;
    @include flex(rn, a-center, between);
    width: 100%;
  }

  &__status {
    @extend %text-xs-regular;
  }

  &__members-container {
    @include flex(rn, a-center);

    & > * {
      margin-right: -6px;

      &:last-child {
        margin-right: 0;
      }
    }
  }

  &__members {
    @include flex(rn, a-center);
  }

  &__add-user {
    @include flex(center);

    svg {
      width: 24px;
      height: 24px;
      transition: all 0.2s ease;
    }

    &:hover {
      svg {
        stroke-opacity: 1;
      }
    }
  }

  &__more {
    @include flex(center);
    width: 28px;
    height: 28px;
    border-radius: 16px;
    @extend %text-s-regular;
    background-color: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary-50);
  }

  &__members-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background-color: var(--primary-25);
    border: none;
    cursor: pointer;
    color: var(--light-text-backgroung-primary);
    transition: background-color 0.2s ease;
    margin-left: 8px;
    padding: 0;

    &:hover {
      background-color: var(--primary-50);
    }

    svg {
      stroke: var(--light-text-backgroung-primary);
    }
  }
}
</style>
