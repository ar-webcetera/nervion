<script setup lang="ts">
import { ref, computed, toRef } from 'vue';
import type { Project } from '~/types/project';
import EditorTiptap from '~/components/TipTap/EditorTiptap.vue';
import { PROJECT_STATUS_OPTIONS, PROJECT_STATUSES } from '~/constants/project.constants';
import IconTrash from './Icons/IconTrash.vue';
import type { JSONContent } from '@tiptap/vue-3';
import { PAGE_NAMES } from '~/constants/pages.constants';

const props = defineProps<{
  project: Project;
}>();

const emit = defineEmits<{
  (e: 'close' | 'delete'): void;
  (e: 'create', project: Project): void;
}>();

const isCreatingMode = computed(() => props.project.id === 0);
const project = ref(props.project);
const projectName = ref(props.project.name);

const projectRef = toRef(props, 'project');

const taskStore = useTaskStore();
const router = useRouter();

const {
  editableDescription,
  isEditableDescription,
  isGeneratingDescription,
  updateProjectDescription,
  generateDescription,
  updateProjectStatus,
  updateProjectBudget,
  updateProjectHourlyRate,
  closeDeleteProjectModal,
  openDeleteProjectModal,
  deleteProjectModal,
} = useProjectSidebar(projectRef as Ref<Project | null>);

const budgetInput = ref(props.project.budget);
const isEditingBudget = ref(false);

const normalizeNonNegativeNumber = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
};

const editableBudget = computed({
  get: () => (isEditingBudget.value ? budgetInput.value : props.project.budget),
  set: (value) => {
    budgetInput.value = value;
  },
});

const saveBudget = async () => {
  budgetInput.value = normalizeNonNegativeNumber(budgetInput.value);
  await updateProjectBudget(budgetInput.value);
  isEditingBudget.value = false;
};

const cancelBudgetEdit = () => {
  budgetInput.value = props.project.budget;
  isEditingBudget.value = false;
};

const hourlyRateInput = ref(props.project.hourlyRate);
const isEditingHourlyRate = ref(false);

const editableHourlyRate = computed({
  get: () => (isEditingHourlyRate.value ? hourlyRateInput.value : props.project.hourlyRate),
  set: (value) => {
    hourlyRateInput.value = value;
  },
});

const saveHourlyRate = async () => {
  hourlyRateInput.value = normalizeNonNegativeNumber(hourlyRateInput.value);
  await updateProjectHourlyRate(hourlyRateInput.value);
  isEditingHourlyRate.value = false;
};

const cancelHourlyRateEdit = () => {
  hourlyRateInput.value = props.project.hourlyRate;
  isEditingHourlyRate.value = false;
};

const handleStatusUpdate = (newStatus: unknown) => {
  if (typeof newStatus === 'string' && Object.values(PROJECT_STATUSES).includes(newStatus as PROJECT_STATUSES)) {
    updateProjectStatus(newStatus as PROJECT_STATUSES);
  }
};

const minWidth = 883;
const defaultWidth = 883;
const cookieName = 'project-sidebar-width';

const sidebarWidthCookie = useCookie<number>(cookieName, {
  maxAge: 365 * 24 * 60 * 60,
  path: '/',
});

const sidebarWidth = ref(
  sidebarWidthCookie.value && sidebarWidthCookie.value >= minWidth ? sidebarWidthCookie.value : defaultWidth,
);

const setSidebarWidthCookie = (width: number) => {
  sidebarWidth.value = width;
  sidebarWidthCookie.value = width;
};

const isResizing = ref(false);
const startX = ref(0);
const startWidth = ref(0);

const handleResizeStart = (e: MouseEvent) => {
  isResizing.value = true;
  startX.value = e.clientX;
  startWidth.value = sidebarWidth.value;
  document.addEventListener('mousemove', handleResizeMove);
  document.addEventListener('mouseup', handleResizeEnd);
};

const handleResizeMove = (e: MouseEvent) => {
  if (!isResizing.value) return;
  const delta = e.clientX - startX.value;
  const newWidth = Math.max(minWidth, startWidth.value - delta);
  setSidebarWidthCookie(newWidth);
};

const handleResizeEnd = () => {
  isResizing.value = false;
  setSidebarWidthCookie(sidebarWidth.value);
  document.removeEventListener('mousemove', handleResizeMove);
  document.removeEventListener('mouseup', handleResizeEnd);
};

const sidebarStyle = computed(() => ({
  width: `${sidebarWidth.value}px`,
}));

const handleTranscription = (payload: { title: string; description: JSONContent }) => {
  projectName.value = payload.title;
  if (payload?.description) {
    editableDescription.value = payload.description;
  }
};

const openProjectTasks = async () => {
  taskStore.filter.projects = [props.project.id];
  taskStore.filter.statuses = [];
  taskStore.filter.responsibles = [];
  taskStore.filter.taskTypes = [];
  taskStore.filter.title = undefined;

  await taskStore.saveFilterState();
  await taskStore.fetchTasks({
    useSavedFilters: true,
  });
  await taskStore.getKanban({
    useSavedFilters: true,
  });
  await router.push({ name: PAGE_NAMES.home });
};

const createProject = () => {
  project.value.name = projectName.value;
  project.value.budget = normalizeNonNegativeNumber(budgetInput.value);
  project.value.hourlyRate = normalizeNonNegativeNumber(hourlyRateInput.value);
  emit('create', project.value);
};

onUnmounted(() => {
  document.removeEventListener('mousemove', handleResizeMove);
  document.removeEventListener('mouseup', handleResizeEnd);
});
</script>

<template>
  <div class="project-sidebar__wrapper" @click="emit('close')"></div>
  <div class="project-sidebar" :style="sidebarStyle" @click.stop>
    <div class="project-sidebar__resize-handle" @mousedown="handleResizeStart"></div>
    <div class="project-sidebar__content">
      <div class="project-sidebar__header">
        <button v-if="!isCreatingMode" @click="openProjectTasks">Перейти к задачам</button>
        <button v-if="!isCreatingMode" class="project-sidebar__delete-button" @click="openDeleteProjectModal">
          <IconTrash />
          <span>Удалить проект</span>
        </button>
      </div>

      <div v-if="isCreatingMode" class="project-sidebar__name-input-wrapper">
        <AudioRecorder @done="handleTranscription" />
        <input
          v-model="projectName"
          type="text"
          maxlength="80"
          placeholder="Название проекта"
          class="project-sidebar__name-input"
        />
      </div>
      <h1 v-else class="project-sidebar__title">{{ project.name }}</h1>
      <div class="project-sidebar__content-container">
        <div class="project-sidebar__description-container">
          <div
            :class="[
              'project-sidebar__description',
              { 'project-sidebar__description_active': isEditableDescription || isCreatingMode },
            ]"
          >
            <div v-if="!isEditableDescription && !isCreatingMode" class="project-sidebar__description-header">
              <span>Описание</span>
              <div class="project-sidebar__description-header_actions">
                <span class="project-sidebar__description-header_edit" @click="isEditableDescription = !isEditableDescription">
                  <IconsIconPen />
                </span>
              </div>
            </div>
            <EditorTiptap
              :key="String(isEditableDescription) + isGeneratingDescription"
              v-model="editableDescription"
              placeholder="Опишите проект"
              :is-editable="isEditableDescription || isCreatingMode"
              :value="editableDescription"
              generate-button
              :is-generating-description="isGeneratingDescription"
              @generate-description="(instruction) => generateDescription(instruction)"
            />
            <div v-if="isEditableDescription && !isCreatingMode" class="project-sidebar__buttons">
              <button class="button_secondary" @click="isEditableDescription = false">Отменить</button>
              <button @click="updateProjectDescription(editableDescription)">Сохранить</button>
            </div>
          </div>

          <div v-if="isCreatingMode" class="project-sidebar__actions">
            <button class="button_secondary" @click="emit('close')">Отменить</button>
            <button class="project-sidebar__create-button-large" :disabled="!projectName.trim()" @click="createProject">
              Создать проект
            </button>
          </div>
        </div>

        <div class="project-sidebar__info">
          <div class="project-sidebar__info-item">
            <span class="project-sidebar__info-label">Статус</span>
            <BaseDropdown
              :model-value="project.status"
              :options="PROJECT_STATUS_OPTIONS"
              placeholder="Не указан"
              @update:model-value="handleStatusUpdate"
            />
          </div>
          <div class="project-sidebar__info-item">
            <span class="project-sidebar__info-label">Бюджет на месяц</span>
            <div v-if="isCreatingMode" class="project-sidebar__budget-edit">
              <input v-model.number="budgetInput" type="number" min="0" class="project-sidebar__budget-input" />
            </div>
            <div v-else-if="!isEditingBudget" class="project-sidebar__info-value" @click="isEditingBudget = true">
              {{ editableBudget }}
            </div>
            <div v-else class="project-sidebar__budget-edit">
              <input v-model.number="editableBudget" type="number" min="0" class="project-sidebar__budget-input" />
              <div class="project-sidebar__budget-buttons">
                <button class="project-sidebar__budget-button" @click="saveBudget">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="9" viewBox="0 0 12 9" fill="none">
                    <path
                      d="M0.5 4.03556L4.03553 7.5711L11.1058 0.5"
                      stroke="white"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
                <button class="project-sidebar__budget-button button_default" @click="cancelBudgetEdit">
                  <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path
                      d="M7.16665 7.16665L3.83334 3.83334M3.83334 3.83334L0.5 0.5M3.83334 3.83334L7.16669 0.5M3.83334 3.83334L0.5 7.16669"
                      stroke="#FEFEFE"
                      stroke-opacity="0.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div class="project-sidebar__info-item">
            <span class="project-sidebar__info-label">Ставка в час</span>
            <div v-if="isCreatingMode" class="project-sidebar__budget-edit">
              <input v-model.number="hourlyRateInput" type="number" min="0" class="project-sidebar__budget-input" />
            </div>
            <div v-else-if="!isEditingHourlyRate" class="project-sidebar__info-value" @click="isEditingHourlyRate = true">
              {{ editableHourlyRate }}
            </div>
            <div v-else class="project-sidebar__budget-edit">
              <input v-model.number="editableHourlyRate" type="number" min="0" class="project-sidebar__budget-input" />
              <div class="project-sidebar__budget-buttons">
                <button class="project-sidebar__budget-button" @click="saveHourlyRate">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="9" viewBox="0 0 12 9" fill="none">
                    <path
                      d="M0.5 4.03556L4.03553 7.5711L11.1058 0.5"
                      stroke="white"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
                <button class="project-sidebar__budget-button button_default" @click="cancelHourlyRateEdit">
                  <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path
                      d="M7.16665 7.16665L3.83334 3.83334M3.83334 3.83334L0.5 0.5M3.83334 3.83334L7.16669 0.5M3.83334 3.83334L0.5 7.16669"
                      stroke="#FEFEFE"
                      stroke-opacity="0.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <teleport to="#teleports">
    <BaseModal ref="deleteProjectModal">
      <div class="delete-project-modal">
        <div class="delete-project-modal__header">
          <h2>Вы уверены что хотите удалить проект?</h2>
          <span>
            Вы собираетесь удалить проект ”{{ project.name }}”. Вместе с ним будут безвозвратно удалены все истории, задачи,
            файлы.
          </span>
        </div>
        <div class="delete-project-modal__buttons">
          <button class="button_secondary" @click="closeDeleteProjectModal">Отменить</button>
          <button @click="emit('delete')">Удалить</button>
        </div>
      </div>
    </BaseModal>
  </teleport>
</template>

<style scoped lang="scss">
:deep(.base-modal__content) {
  width: auto;
}

.delete-project-modal {
  padding: 0 24px;
  @include flex(cn);
  gap: 48px;
  width: 380px;

  &__header {
    @include flex(cn);
    gap: 4px;

    h2 {
      @extend %text-l-bold;
      margin: 0;
    }

    span {
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__buttons {
    @include flex(rn);
    gap: 8px;
    width: 100%;

    button {
      padding: 10px 32px;
      flex: 1;
    }
  }
}

.project-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  background-color: var(--dark-text-background-primary);
  box-shadow: -2px 0 8px var(--black-10);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow-y: auto;

  &__content-container {
    @include flex(rn);
    gap: 16px;
    margin-top: 24px;
  }

  &__wrapper {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: var(--black-50);
    z-index: 999;
  }

  &__resize-handle {
    position: absolute;
    left: 0;
    top: 0;
    width: 4px;
    height: 100%;
    cursor: ew-resize;
    background-color: transparent;
    transition: background-color 0.2s;

    &:hover {
      background-color: var(--primary);
    }
  }

  &__content {
    padding: 24px;
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  &__delete-button {
    color: var(--danger-delete);
    background: none;
    border: none;
    transition: color 0.2s ease;
    padding: 0;
  }

  &__create-button {
    @include flex(rn, a-center);
    gap: 4px;
    color: var(--primary);
    @extend %text-s-regular;
    cursor: pointer;
    background: none;
    border: none;
    transition: color 0.2s ease;

    &:hover {
      color: var(--primary-hover);
    }
  }

  &__name-input-wrapper {
    @include flex(rn, a-center);
    gap: 12px;
    margin-bottom: 0;
  }

  &__name-input {
    width: 100%;
    @extend %display-s-bold;
    color: var(--light-text-backgroung-primary);

    &::placeholder {
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__title {
    @extend %display-s-bold;
    margin-top: 12px;
    margin-bottom: 0;
    color: var(--white-100);
  }

  &__section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
  }

  &__section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    span {
      @extend %text-xl-medium;
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__edit-button {
    @include flex(center);
    width: 24px;
    height: 24px;
    cursor: pointer;

    svg {
      width: 16px;
      height: 16px;
      stroke: var(--light-text-backgroung-primary-50);
      transition: stroke 0.2s ease;

      &:hover {
        stroke: var(--light-text-backgroung-primary);
      }
    }
  }

  &__description-container {
    @include flex(cn);
    gap: 32px;
    width: 100%;
  }

  &__description {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    flex: 1;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);

    &_active {
      border: 1px solid var(--light-text-backgroung-primary-10);
      background-color: unset;
    }

    h2 {
      @extend %text-m-medium;
      color: var(--white-100);
    }

    p {
      @extend %text-s-regular;
      color: var(--white-50);
    }

    img {
      width: 100%;
      border-radius: 8px;
    }
  }

  &__description-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    span {
      @extend %text-xl-medium;
      color: var(--light-text-backgroung-primary-50);
    }
    &_edit {
      @include flex(center);
      cursor: pointer;
      svg {
        stroke: var(--light-text-backgroung-primary-50);
        transition: stroke 0.2s ease;

        &:hover {
          stroke: var(--light-text-backgroung-primary);
        }
      }
    }
  }

  &__actions {
    @include flex(rn);
    gap: 8px;
  }

  &__buttons {
    @include flex(rn);
    gap: 8px;
    margin-left: auto;
  }

  &__quote {
    padding: 12px 16px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-10);
    @extend %text-s-regular;
    color: var(--white-100);
    border-left: 3px solid var(--primary-100);
  }

  &__link {
    @include flex(rn, a-center);
    gap: 8px;

    svg {
      width: 16px;
      height: 16px;
      fill: var(--primary-100);
    }

    a {
      @extend %text-s-regular;
      color: var(--primary-100);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
  }

  &__attach-button {
    @include flex(rn, a-center);
    gap: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px dashed var(--light-text-backgroung-primary-10);
    color: var(--white-50);
    @extend %text-s-regular;
    cursor: pointer;
    transition: border-color 0.2s ease;

    &:hover {
      border-color: var(--light-text-backgroung-primary-50);
    }

    svg {
      width: 16px;
      height: 16px;
      stroke: var(--white-50);
    }
  }

  &__info {
    @include flex(cn);
    gap: 12px;
    width: 150px;
  }

  &__info-item {
    display: flex;
    flex-direction: column;
    gap: 4px;

    &:deep(.base-dropdown__placeholder) {
      @extend %text-s-regular;
    }
  }

  &__info-label {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__info-value {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    transition: color 0.2s ease;

    &:hover {
      color: var(--light-text-backgroung-primary);
    }

    &_status {
      color: var(--status-orange);
    }
  }

  &__budget-edit {
    @include flex(rn, a-center);
    gap: 4px;
  }

  &__budget-input {
    flex: 1;
    width: 100%;
    padding: 0 8px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;

    &::-webkit-inner-spin-button {
      display: none;
    }
  }

  &__budget-buttons {
    display: flex;
    gap: 4px;
  }

  &__budget-button {
    width: 20px;
    height: 20px;
    padding: 0;
    border-radius: 4px;
    border: none;
    transition: background 0.2s ease;
  }
}
</style>
