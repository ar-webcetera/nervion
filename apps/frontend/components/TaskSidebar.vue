<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useTaskStore } from '~/stores/taskStore';
import IconPlus from '~/components/Icons/IconPlus.vue';
import type { Timelog } from '~/types/task';
import DatePickerType from '~/enums/datepicker.enums';
import { TASK_TYPE_OPTIONS } from '~/enums/task.enums';
import EditorTiptap from '~/components/TipTap/EditorTiptap.vue';
import IconButtonLoader from '~/components/Icons/IconButtonLoader.vue';
import IconClose from '~/components/Icons/IconClose.vue';
import { TYPE_SORT_LABELS, TypeSort } from '~/constants/sort.constants';
import { MAX_TASK_NAME_LENGTH } from '~/constants/task.constants';
import IconPen from './Icons/IconPen.vue';
import IconTrash from './Icons/IconTrash.vue';
import IconCopy from './Icons/IconCopy.vue';
import IconSortAsc from './Icons/IconSortAsc.vue';
import IconSortDesc from './Icons/IconSortDesc.vue';
import { hasTiptapContent } from '~/utils/tiptap/content';
import IconArrowDown from './Icons/IconArrowDown.vue';
import IconSendTime from './Icons/IconSendTime.vue';
import IconLongBack from './Icons/IconLongBack.vue';
import IconRecurrence from './Icons/IconRecurrence.vue';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { getErrorMessage } from '~/utils/error';
import { TaskBillingType } from '@tracker/contracts';
import { ROLES } from '~/types/user';

const RECURRENCE_DAY_OPTIONS = [
  { label: 'Пн', value: 1 },
  { label: 'Вт', value: 2 },
  { label: 'Ср', value: 3 },
  { label: 'Чт', value: 4 },
  { label: 'Пт', value: 5 },
  { label: 'Сб', value: 6 },
  { label: 'Вс', value: 0 },
] as const;

const taskStore = useTaskStore();
const commentStore = useCommentStore();
const userStore = useUserStore();
const route = useRoute();
const notificationStore = useNotificationStore();
const { $toast } = useNuxtApp();

const props = defineProps<{ currentTaskId: number | null }>();
const currentTaskIdRef = computed(() => props.currentTaskId);

const { fetchComments, createComment, deleteComment, deleteComments, commentsPending, newComments, saveComment } =
  useTaskComments(currentTaskIdRef as Ref<number | null>);
const {
  openEditPageName,
  deleteTask,
  duplicateTask,
  updateTaskStatus,
  updateTaskType,
  updateTaskResponsible,
  updateTaskDescription,
  openEditDescription,
  closeEditDescription,
  setPlannedDate,
  fetchTask,
  confirmEdit,
  closeEditPageName,
  usersOptions,
  isEditableDescription,
  isGeneratingDescription,
  descriptionKey,
  openTaskSidebar,
  isEditName,
  editableName,
  editableDescription,
  responsibleId,
  fetchData,
  generateDescription,
  hasError,
  updateStoryPoints,
  updateRecurrenceDays,
} = useTaskSidebar(currentTaskIdRef as Ref<number | null>);

const isRecurring = computed(() => !!taskStore.currentTask?.recurrence_days?.length);

const completionDate = computed(() => taskStore.currentTaskDate ?? format(new Date(), 'yyyy-MM-dd'));

const completionDateLabel = computed(() => {
  const today = format(new Date(), 'yyyy-MM-dd');
  if (completionDate.value === today) return 'Выполнено сегодня';
  return `Выполнено ${format(parseISO(completionDate.value), 'd MMM', { locale: ru })}`;
});

const todayCompleted = computed(() => {
  if (!taskStore.currentTask) return false;
  if (taskStore.currentTaskDate && taskStore.weeklyTasks) {
    const col = taskStore.weeklyTasks.columns.find((c) => c.date === taskStore.currentTaskDate);
    return col?.cards.find((c) => c.id === taskStore.currentTask!.id)?.completed ?? false;
  }
  return !!taskStore.currentTask.is_completed_today;
});

const toggleTodayCompletion = async () => {
  if (!taskStore.currentTask) return;
  try {
    if (todayCompleted.value) {
      await taskStore.uncompleteRecurringTask(taskStore.currentTask.id, completionDate.value);
    } else {
      await taskStore.completeRecurringTask(taskStore.currentTask.id, completionDate.value);
    }
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const toggleRecurrenceDay = (day: number) => {
  if (!taskStore.currentTask) return;
  const current = taskStore.currentTask.recurrence_days ?? [];
  const updated = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
  updateRecurrenceDays(updated.length ? updated : null);
};

const statusOptions = useStatusOptions();
const {
  createLinkTaskLoader,
  isOpenLinkInput,
  existingTasks,
  newLinkTaskName,
  createNewLinkTask,
  linkExistingTask,
  debounceChangeTitle,
  cancelLinkTask,
} = useTaskLinks(currentTaskIdRef as Ref<number | null>);

const { resetTimelog, createTimelog, continueTimelog, fixNewTimelog, currentTimelog } = useTaskTimelogs(
  currentTaskIdRef as Ref<number | null>,
);

const useFullName = (user: { last_name: string; first_name: string }) => `${user.last_name} ${user.first_name}`;

const pending = ref(true);
const newTimelog = ref<Partial<Timelog>>({
  time_spent: NaN,
  summary: '',
});

const taskTypeOptions = TASK_TYPE_OPTIONS;
const billingTypeOptions = [
  { label: 'Не учитывать', value: null },
  { label: 'Почасовая', value: TaskBillingType.HOURLY },
  { label: 'Фиксированная', value: TaskBillingType.FIXED },
];
const isAdmin = computed(() => userStore.user?.role === ROLES.admin);

const updateBilling = async (value?: string | number | (string | number)[] | null) => {
  if (!taskStore.currentTask) return;
  const billing_type = value === undefined ? taskStore.currentTask.billing_type : (value as TaskBillingType | null);
  const fixed_price = billing_type === TaskBillingType.FIXED ? Number(taskStore.currentTask.fixed_price ?? 0) : null;
  try {
    await taskStore.updateTask(taskStore.currentTask.id, { billing_type, fixed_price });
    taskStore.currentTask.billing_type = billing_type;
    taskStore.currentTask.fixed_price = fixed_price;
  } catch (e) {
    $toast.error(getErrorMessage(e));
    await fetchTask();
  }
};

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const taskModals = useTaskModals(deleteComment, deleteComments, fixNewTimelog, deleteTask, duplicateTask, emit);

const { currentSortType, toggleSortType, scrollToComment } = useTaskCommentUI(
  currentTaskIdRef as Ref<number | null>,
  fetchComments,
);

const commentsContainer = ref<HTMLElement | null>(null);
const sidebarRef = ref<HTMLElement | null>(null);
const commentEditorRef = ref<{ focusEditor: () => void; clearContent: () => void } | null>(null);

const minWidth = 883;
const defaultWidth = 883;
const cookieName = 'sidebar-width';

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

let taskNotificationMarkInFlight = false;
const markOpenedTaskNotificationsAsRead = async (taskId: number) => {
  if (taskNotificationMarkInFlight) return;

  taskNotificationMarkInFlight = true;
  try {
    await notificationStore.markContextAsRead({ task_id: taskId });
  } finally {
    taskNotificationMarkInFlight = false;
  }
};

const useFetchAllData = async () => {
  const openedTaskId = currentTaskIdRef.value;

  try {
    pending.value = true;
    await Promise.all([fetchTask(), fetchComments(), fetchData()]);
    responsibleId.value = taskStore.currentTask?.responsible?.id || null;
    editableDescription.value = taskStore.currentTask?.description || {};
    if (!hasError.value && openedTaskId && taskStore.currentTask?.id === openedTaskId) {
      await markOpenedTaskNotificationsAsRead(openedTaskId);
    }
  } catch (e) {
    console.error('Ошибка загрузки задачи или синхронизации уведомлений:', e);
  } finally {
    pending.value = false;
    await nextTick();
    scrollToComment(commentsContainer.value, sidebarRef.value);
  }
};

onMounted(() => {
  commentStore.sortType = commentStore.getSortType();
  if (!commentStore.sortType) {
    commentStore.setSortType();
    commentStore.sortType = TypeSort.ASC;
  }
  useFetchAllData();
});

watch(
  currentTaskIdRef,
  () => {
    if (currentTaskIdRef.value) {
      useFetchAllData();
    }
  },
  { immediate: false },
);

watch(
  () => route.query['comment-id'],
  async (newCommentId) => {
    if (newCommentId && !pending.value) {
      await nextTick();
      scrollToComment(commentsContainer.value, sidebarRef.value);
    }
  },
);

watch(
  () =>
    notificationStore.notifications
      .filter((notification) => {
        if (notification.is_read) return false;
        const params = new URL(notification.link, 'http://localhost').searchParams;
        return params.get('task-id') === String(currentTaskIdRef.value) && !params.has('comment-id');
      })
      .map((notification) => notification.id)
      .join(','),
  () => {
    if (!pending.value && currentTaskIdRef.value) {
      void markOpenedTaskNotificationsAsRead(currentTaskIdRef.value);
    }
  },
);

onUnmounted(() => {
  taskStore.currentTask = null;
  taskStore.currentTaskDate = null;
  document.removeEventListener('mousemove', handleResizeMove);
  document.removeEventListener('mouseup', handleResizeEnd);
});

const submitComment = async () => {
  const isCreated = await createComment(newComments.value.message);
  if (!isCreated) return;
  commentEditorRef.value?.clearContent();
  commentEditorRef.value?.focusEditor();
};
</script>

<template>
  <div class="task-sidebar__wrapper" @click="$emit('close')"></div>
  <aside ref="sidebarRef" class="task-sidebar" :style="sidebarStyle">
    <div class="task-sidebar__resize-handle" @mousedown="handleResizeStart" />
    <div v-if="pending" class="loader__wrapper">
      <div class="loader"></div>
    </div>
    <div v-else-if="hasError" class="error-block">
      <div class="error-block__content">
        <h2>Задача не найдена</h2>
        <p>Возможно, задача была удалена или у вас нет доступа к ней</p>
      </div>
    </div>
    <template v-else>
      <div class="task-sidebar__close" @click="$emit('close')">
        <IconLongBack />
        <span>Задача</span>
      </div>
      <div class="task-sidebar__header">
        <div class="task-sidebar__title">
          <BaseTimetrack
            v-if="currentTaskId"
            :key="currentTimelog?.id"
            :timelog="currentTimelog"
            task
            @create-timelog="createTimelog"
            @continue-timelog="continueTimelog"
            @reset-timelog="(id) => resetTimelog(id, taskModals.closeFixTimelogModal)"
          />
          <div class="task-sidebar__title-actions">
            <span
              class="task-sidebar__duplicate-button"
              :class="{ 'task-sidebar__action_disabled': taskModals.isDuplicating.value }"
              title="Дублировать задачу"
              @click="taskModals.openDuplicateTaskModal"
            >
              <IconCopy /><span class="task-sidebar__action-label">Дублировать</span>
            </span>
            <span class="task-sidebar__delete-button" title="Удалить задачу" @click="taskModals.openDeleteTaskModal">
              <IconTrash /><span class="task-sidebar__action-label">Удалить задачу</span>
            </span>
            <span class="task-sidebar__close-button" @click="$emit('close')"><IconClose /></span>
          </div>
        </div>
      </div>
      <div class="task-sidebar__name">
        <template v-if="!isEditName">
          <span @dblclick="openEditPageName">{{ taskStore.currentTask?.title }}</span>
        </template>
        <template v-else>
          <div class="task-sidebar__title-input">
            <input
              v-model="editableName"
              type="text"
              :maxlength="MAX_TASK_NAME_LENGTH"
              placeholder="Введите название"
              @keyup.enter.stop="confirmEdit()"
            />
            <div>
              <button @click.stop="confirmEdit()">Сохранить</button>
              <span @click.stop="closeEditPageName">
                <IconClose />
              </span>
            </div>
          </div>
        </template>
      </div>
      <div class="task-sidebar__info">
        <div class="task-sidebar__info-left">
          <div
            :class="[
              'task-sidebar__description-container',
              { 'task-sidebar__description-container_active': isEditableDescription },
            ]"
          >
            <div v-if="!isEditableDescription" class="task-sidebar__description-header">
              <span>Описание</span>
              <div class="task-sidebar__description-header_actions">
                <span v-if="!isEditableDescription" class="task-sidebar__description-header_edit" @click="openEditDescription">
                  <IconPen />
                </span>
              </div>
            </div>
            <div v-if="taskStore.currentTask?.description" class="task-sidebar__description">
              <EditorTiptap
                :key="`editor-${descriptionKey}-${isEditableDescription}`"
                v-model="editableDescription"
                placeholder="Опишите в чем заключается задача"
                :is-editable="isEditableDescription"
                :value="editableDescription"
                generate-button
                :is-generating-description="isGeneratingDescription"
                @generate-description="(instruction) => generateDescription(instruction)"
              />
              <div v-if="isEditableDescription" class="task-sidebar__buttons">
                <button class="button_secondary" @click="closeEditDescription">Отменить</button>
                <button @click="updateTaskDescription(editableDescription)">Сохранить</button>
              </div>
            </div>
          </div>
          <div class="related-tasks">
            <div class="related-tasks__actions" @click="isOpenLinkInput = true">
              <IconPlus />
              <span>Создать новую связь</span>
            </div>
            <div v-if="isOpenLinkInput" class="related-tasks__new-task">
              <div class="related-tasks__task-input">
                <input
                  ref="inputLinkRef"
                  v-model="newLinkTaskName"
                  :maxlength="MAX_TASK_NAME_LENGTH"
                  type="text"
                  placeholder="Создайте новую или найдите существующую"
                  @input="debounceChangeTitle"
                />
                <div v-if="existingTasks.length" class="related-tasks__task-input-dropdown">
                  <div
                    v-for="task of existingTasks"
                    :key="task.id"
                    class="related-tasks__task-input-dropdown-item"
                    @click="linkExistingTask(task.id)"
                  >
                    {{ task.title }}
                  </div>
                </div>
              </div>
              <div class="related-tasks__new-task-actions">
                <button class="button button_secondary" :disabled="createLinkTaskLoader" @click="cancelLinkTask">
                  <div v-if="createLinkTaskLoader" class="loader-small"></div>
                  <div v-else>Отменить</div>
                </button>
                <button :disabled="createLinkTaskLoader" @click="createNewLinkTask">
                  <template v-if="createLinkTaskLoader"><div class="loader-small"></div></template>
                  <template v-else> Создать</template>
                </button>
              </div>
            </div>
            <details v-if="taskStore.currentTask?.related_tasks.length" class="related-tasks__task-list">
              <summary><span>Связанные задачи</span><IconArrowDown /></summary>
              <div class="related-tasks__task-list-items">
                <TaskComponent
                  v-for="task of taskStore.currentTask?.related_tasks"
                  :key="task.id"
                  class="related-tasks__task"
                  :task="task"
                  :related-task-id="currentTaskIdRef"
                  @open-task-sidebar="openTaskSidebar(task.id)"
                />
              </div>
            </details>
          </div>
        </div>
        <div class="task-sidebar__body">
          <div class="task-sidebar__field task-sidebar__field_task-type">
            <div class="task-sidebar__label">Проект</div>
            <div v-if="taskStore.currentTask" class="task-sidebar__value">
              {{ taskStore.currentTask.project?.name }}
            </div>
            <div v-else class="task-sidebar__value">Не указан</div>
          </div>
          <div class="task-sidebar__field task-sidebar__field_task-type">
            <div class="task-sidebar__label">Тип</div>
            <div v-if="taskStore.currentTask" class="task-sidebar__value">
              <BaseDropdown
                v-model="taskStore.currentTask.taskType"
                :options="taskTypeOptions"
                placeholder="Не указан"
                @update:model-value="updateTaskType($event)"
              />
            </div>
            <div v-else class="task-sidebar__value">Не указан</div>
          </div>
          <div class="task-sidebar__field task-sidebar__field_responsible">
            <div class="task-sidebar__label">Ответственный</div>
            <div v-if="taskStore.currentTask" class="task-sidebar__value">
              <BaseDropdown
                v-model="taskStore.currentTask.responsible_id"
                :options="usersOptions"
                placeholder="Не указан"
                @update:model-value="updateTaskResponsible($event)"
              />
            </div>
            <div v-else class="task-sidebar__value">Не указан</div>
          </div>
          <div v-if="!isRecurring" class="task-sidebar__field task-sidebar__field_status">
            <div class="task-sidebar__label">Статус</div>
            <div v-if="taskStore.currentTask" class="task-sidebar__value task-sidebar__value_highlight">
              <BaseDropdown
                v-model="taskStore.currentTask.status"
                :options="statusOptions"
                placeholder="Не указан"
                @update:model-value="updateTaskStatus($event)"
              />
            </div>
          </div>
          <div v-if="isAdmin" class="task-sidebar__field task-sidebar__field_billing">
            <div class="task-sidebar__label">Формат оплаты</div>
            <div v-if="taskStore.currentTask" class="task-sidebar__value task-sidebar__billing">
              <BaseDropdown
                v-model="taskStore.currentTask.billing_type"
                :options="billingTypeOptions"
                placeholder="Не учитывать"
                @update:model-value="updateBilling($event)"
              />
              <div v-if="taskStore.currentTask.billing_type === TaskBillingType.FIXED" class="task-sidebar__billing-price">
                <input
                  v-model.number="taskStore.currentTask.fixed_price"
                  type="number"
                  min="0"
                  step="0.01"
                  aria-label="Фиксированная стоимость"
                  @change="updateBilling()"
                />
                <span>₽</span>
              </div>
            </div>
          </div>
          <div v-if="isRecurring" class="task-sidebar__field task-sidebar__field_completion">
            <div class="task-sidebar__label">{{ completionDateLabel }}</div>
            <button
              class="task-sidebar__completion-btn"
              :class="{ 'task-sidebar__completion-btn_done': todayCompleted }"
              @click="toggleTodayCompletion"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              {{ todayCompleted ? 'Выполнено' : 'Отметить выполненным' }}
            </button>
          </div>
          <template v-if="false">
            <div class="task-sidebar__field task-sidebar__field_date">
              <div class="task-sidebar__label">Дата</div>
              <div class="task-sidebar__value">Не указана</div>
            </div>
          </template>
          <template v-if="taskStore.currentTask">
            <div class="task-sidebar__field task-sidebar__field_deadline">
              <div class="task-sidebar__label">Дедлайн</div>
              <div>
                <BaseDatePicker
                  v-model="taskStore.currentTask.planned_date"
                  :clear-button="true"
                  :type="DatePickerType.taskField"
                  format-date="dd.MM.yyyy"
                  placeholder="Не указан"
                  small
                  @update:model-value="setPlannedDate($event)"
                />
              </div>
            </div>
          </template>
          <div class="task-sidebar__field task-sidebar__field_date">
            <div class="task-sidebar__label">
              Затраченное время
              <span class="task-sidebar__edit" @click="taskModals.openFixTimelogModal">
                <IconPlus />
              </span>
            </div>
            <TaskTimeTrack :task-id="taskStore.currentTask?.id as number" />
          </div>
          <div class="task-sidebar__field task-sidebar__field_sp">
            <div class="task-sidebar__label">Story Points</div>
            <div v-if="taskStore.currentTask" class="task-sidebar__sp-options">
              <button
                v-for="sp in [1, 2, 3, 5, 8, 13]"
                :key="sp"
                class="task-sidebar__sp-btn"
                :class="{ 'task-sidebar__sp-btn_active': Number(taskStore.currentTask.story_points) === sp }"
                @click="updateStoryPoints(Number(taskStore.currentTask!.story_points) === sp ? null : sp)"
              >
                {{ sp }}
              </button>
            </div>
            <div v-else class="task-sidebar__value">—</div>
          </div>
          <div class="task-sidebar__field task-sidebar__field_recurrence">
            <div class="task-sidebar__label">
              Повторение
              <span v-if="taskStore.currentTask?.recurrence_days?.length" class="task-sidebar__recurrence-badge">
                <IconRecurrence />
              </span>
            </div>
            <div v-if="taskStore.currentTask" class="task-sidebar__recurrence-days">
              <button
                v-for="day in RECURRENCE_DAY_OPTIONS"
                :key="day.value"
                class="task-sidebar__day-btn"
                :class="{ 'task-sidebar__day-btn_active': taskStore.currentTask.recurrence_days?.includes(day.value) }"
                @click="toggleRecurrenceDay(day.value)"
              >
                {{ day.label }}
              </button>
            </div>
          </div>
          <div class="task-sidebar__field task-sidebar__field_date">
            <div class="task-sidebar__label">Участники</div>
            <template v-if="taskStore.currentTask?.participants.length">
              <div v-for="participant of taskStore.currentTask?.participants" :key="participant.id" class="task-sidebar__value">
                {{ useFullName(participant) }}
              </div>
            </template>
            <div v-else class="task-sidebar__value">Участников нет</div>
          </div>
        </div>
      </div>
      <div ref="commentsContainer" class="comments__container">
        <div class="comments__header">
          <span>Действия</span>
          <div class="comments__tools">
            <div v-if="currentSortType" class="comments__sort" @click="toggleSortType">
              <span>{{ TYPE_SORT_LABELS[currentSortType] }}</span>
              <IconSortAsc v-if="currentSortType === TypeSort.ASC" />
              <IconSortDesc v-else />
            </div>
          </div>
        </div>
        <div v-if="currentSortType === TypeSort.DESC" class="comments__form">
          <div class="comments__input">
            <EditorTiptap
              ref="commentEditorRef"
              v-model="newComments.message"
              placeholder="Напишите комментарий..."
              :is-editable="true"
              :value="newComments.message"
              @enter="submitComment"
            />
            <button :disabled="!hasTiptapContent(newComments.message)" @click="submitComment">Отправить</button>
          </div>
        </div>
        <div v-if="commentsPending" class="loader__wrapper">
          <div class="loader"></div>
        </div>
        <template v-if="!commentsPending">
          <div v-if="commentStore.comments.length" class="comments__body">
            <BaseComment
              v-for="comment of commentStore.comments"
              :key="comment.id"
              :comment="comment"
              :user-id="userStore.user!.id"
              :current-task-id="currentTaskId"
              @save-comment="saveComment"
              @delete-comment="taskModals.openDeleteCommentModal"
              @create-comment="(_taskId, message, commentId) => createComment(message, commentId)"
            />
          </div>
          <div v-else class="comments__body">Комментариев пока нет</div>
        </template>
        <div v-if="currentSortType === TypeSort.ASC" class="comments__form">
          <div class="comments__input">
            <EditorTiptap
              ref="commentEditorRef"
              v-model="newComments.message"
              placeholder="Напишите комментарий..."
              :is-editable="true"
              :value="newComments.message"
              @enter="submitComment"
            />
            <button :disabled="!hasTiptapContent(newComments.message)" @click="submitComment">Отправить</button>
          </div>
        </div>
      </div>
    </template>
  </aside>
  <BaseModal :ref="taskModals.modalRefs.fixTimelog">
    <div :class="['fix-timelog-modal', { 'fix-timelog-modal_pending': pending }]">
      <div class="fix-timelog-modal__header">
        <div class="fix-timelog-modal__icon">
          <IconSendTime />
        </div>
        <div class="fix-timelog-modal__right">
          <h2>Что вы сделали за этот период?</h2>
          <span>Укажите затраченное на задачу время и опишите проделанную работу</span>
        </div>
      </div>
      <div class="fix-timelog-modal__time">
        <input v-model.number="newTimelog.time_spent" type="number" min="0" placeholder="Время в минутах (например, 30)" />
      </div>
      <div class="fix-timelog-modal__textarea">
        <textarea
          v-model="newTimelog.summary"
          rows="8"
          placeholder="Например:
- Перенёс страницу “Профиль” на Nuxt 3 с Options API на Composition API
- Добавил динамический импорт компонента Avatar через defineAsyncComponent для снижения размера бандла"
        ></textarea>
      </div>
      <button @click="taskModals.handleFixNewTimelog(newTimelog)">
        <template v-if="!pending">Зафиксировать</template>
        <template v-else>
          <IconButtonLoader class="btn__loader" />
        </template>
      </button>
    </div>
  </BaseModal>
  <BaseModal :ref="taskModals.modalRefs.deleteTask">
    <div class="delete-task-modal">
      <div class="delete-task-modal__header">
        <h2>Вы уверены что хотите удалить задачу?</h2>
        <span>
          Вы собираетесь удалить задачу ”{{ taskStore.currentTask?.title }}”. Вместе с ней будут безвозвратно удалены все файлы.
        </span>
      </div>
      <div class="delete-task-modal__buttons">
        <button class="button_secondary" @click="taskModals.closeDeleteTaskModal">Отменить</button>
        <button @click="taskModals.handleDeleteTask">Удалить</button>
      </div>
    </div>
  </BaseModal>
  <BaseModal :ref="taskModals.modalRefs.duplicateTask">
    <div class="delete-task-modal">
      <div class="delete-task-modal__header">
        <h2>Дублировать задачу?</h2>
        <span>
          Будет создана копия задачи ”{{ taskStore.currentTask?.title }}” со всеми настройками. Комментарии и таймтреки не
          копируются.
        </span>
      </div>
      <div class="delete-task-modal__buttons">
        <button class="button_secondary" :disabled="taskModals.isDuplicating.value" @click="taskModals.closeDuplicateTaskModal">
          Отменить
        </button>
        <button :disabled="taskModals.isDuplicating.value" @click="taskModals.handleDuplicateTask">
          {{ taskModals.isDuplicating.value ? 'Дублирование…' : 'Дублировать' }}
        </button>
      </div>
    </div>
  </BaseModal>
  <BaseModal :ref="taskModals.modalRefs.deleteComment">
    <div class="delete-task-modal">
      <div class="delete-task-modal__header">
        <h2>Вы уверены что хотите удалить комментарий?</h2>
      </div>
      <button @click="taskModals.handleDeleteComment">Удалить</button>
    </div>
  </BaseModal>
  <BaseModal :ref="taskModals.modalRefs.deleteComments">
    <div class="delete-task-modal">
      <div class="delete-task-modal__header">
        <h2>Вы уверены что хотите удалить все комментарии?</h2>
      </div>
      <button @click="taskModals.handleDeleteComments">Удалить</button>
    </div>
  </BaseModal>
</template>

<style lang="scss" scoped>
.loader-small {
  margin-left: 10px;
  margin-top: 0;
  width: 16px;
  height: 16px;
  --b: 2px;
  border-radius: 50%;
  background: var(--primary-100);
  -webkit-mask:
    repeating-conic-gradient(#0000 0deg, #000 1deg 70deg, #0000 71deg 90deg),
    radial-gradient(farthest-side, #0000 calc(100% - var(--b) - 1px), #000 calc(100% - var(--b)));
  -webkit-mask-composite: destination-in;
  mask-composite: intersect;
  animation: l5 1s infinite;

  &__wrapper {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
}
input {
  width: 100%;
  padding: 12px 16px;
  background: var(--light-text-backgroung-primary-5);
  color: var(--white-100);
  @extend %p14-medium;
  border-radius: 8px;

  &::placeholder {
    color: var(--white-50);
  }
}

.related-tasks {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__task-input-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 10;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-text-backgroung-primary-5);
    display: flex;
    flex-direction: column;
    backdrop-filter: blur(12px);
    max-height: 200px;
    overflow: auto;
  }

  &__task-input-dropdown-item {
    cursor: pointer;
    @extend %text-s-regular;
    padding: 6px 8px;
    color: var(--light-text-backgroung-primary-50);

    &:hover {
      background-color: var(--light-text-backgroung-primary-5);
    }
  }

  &__task-input {
    position: relative;
    width: 100%;
    z-index: 5;

    input {
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--light-text-backgroung-primary-10);
      background: unset;
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary);

      &::placeholder {
        @extend %text-s-regular;
        color: var(--light-text-backgroung-primary-50);
      }
    }
  }

  &__task {
    :deep(.task__drag) {
      display: none;
    }
  }

  &__actions {
    @include flex(rn, a-center);
    gap: 4px;
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;

    svg {
      stroke: var(--light-text-backgroung-primary-50);
    }
  }

  &__task-list {
    @include flex(cn);

    summary {
      list-style: none;
      @include flex(rn, a-center);
      gap: 4px;
      cursor: pointer;
      @extend %text-m-medium;

      svg {
        transition: transform 0.2s ease;
      }
    }

    &[open] {
      gap: 8px;

      summary {
        svg {
          transform: rotateX(180deg);
        }
      }
    }
  }

  &__task-list-items {
    @include flex(cn);
    gap: 4px;
  }

  &__new-task {
    @include flex(a-center);
    gap: 4px;
  }
  &__new-task-actions {
    display: flex;
    gap: 4px;
  }
}

:deep(.base-modal__content) {
  width: fit-content;
}

.fix-timelog-modal {
  @include flex(cn, center);
  gap: 24px;
  width: 440px;

  &__header {
    @include flex(rn, a-start);
    gap: 8px;
    padding: 0 24px;
  }

  &__icon {
    padding: 12px;
    @include flex(center);
    border-radius: 8px;
    background-color: var(--light-text-backgroung-primary-5);

    svg {
      width: 24px;
      height: 24px;
      stroke: var(--light-text-backgroung-primary-50);
    }
  }

  &__time {
    padding: 0 24px;

    input {
      width: 100%;
      padding: 16px;
      border-radius: 8px;
      background: unset;
      border: 1px solid var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
      @extend %text-s-regular;

      &::placeholder {
        @extend %text-s-regular;
        color: var(--light-text-backgroung-primary-50);
      }
    }
  }

  &__right {
    @include flex(cn, j-center);
    gap: 4px;

    h2 {
      @extend %text-l-bold;
      color: var(--light-text-backgroung-primary);
      margin: 0;
    }

    span {
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary-50);
    }
  }

  & > div {
    width: 100%;
  }

  &__textarea {
    padding: 0 24px;
  }

  textarea {
    height: 192px;
    width: 100%;
    padding: 16px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background-color: unset;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;

    &::placeholder {
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary-50);
    }
  }

  button {
    padding: 10px 12px;
    margin: 0 24px;
    width: -webkit-fill-available;
  }

  &_pending {
    & > div {
      filter: blur(2px);
    }
  }
}

.loader {
  &__wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }
}

.error-block {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 24px;

  &__content {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 400px;

    h2 {
      @extend %h1;
      color: var(--white-100);
    }

    p {
      @extend %p14-medium;
      color: var(--white-50);
    }
  }
}

.delete-task-modal {
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

.timelog {
  @include flex(rn, a-center);
  gap: 18px;

  &__play,
  &__pause {
    display: flex;
    cursor: pointer;
  }

  &__timer {
    @include flex(rn, a-center);
    gap: 4px;
    @extend %p14-medium;
    color: var(--white-50);

    svg {
      cursor: pointer;

      &:last-child {
        stroke: var(--white-50);
      }
    }

    span {
      width: 60px;
    }

    &_running {
      color: var(--white-100);

      svg {
        &:last-child {
          stroke: var(--white-100);
        }
      }
    }
  }

  &__divider {
    height: 32px;
    width: 1px;
    background-color: var(--light-text-backgroung-primary-5);
  }

  &__send {
    width: 32px;
    height: 32px;
    @include flex(center);
    border-radius: 8px;
    background-color: var(--primary-100);
    cursor: pointer;
  }
}

.comments {
  &__form {
    display: flex;
    gap: 24px;
    align-items: flex-start;
  }

  &__input {
    @include flex(cn);
    gap: 12px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    @extend %p14-medium;
    flex: 1;
    padding: 16px;

    button {
      margin-left: auto;
      width: fit-content;
    }
  }

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    & > span {
      @extend %text-xl-medium;
      color: var(--light-text-backgroung-primary-50);
    }

    span:nth-of-type(2) {
      cursor: pointer;
      @extend %p14-bold;
    }
  }

  &__tools {
    @include flex(rn, a-center);
    gap: 12px;
  }

  &__delete {
    padding: 4px 12px;
    border-radius: 12px;
    @extend %text-s-regular;
    color: var(--secondary);
    cursor: pointer;
  }

  &__sort {
    padding: 6px 12px;
    @include flex(rn, a-center);
    gap: 8px;
    border-radius: 16px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
  }

  &__container {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 24px 24px 0;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    @extend %p14-medium;
  }
}

.task-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  width: v-bind('`${sidebarWidth}px`');
  height: 100vh;
  background: var(--dark-text-background-primary);
  padding: 24px 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
  z-index: 1000;
  max-width: 100%;

  @media (max-width: $screen-mobile-l) {
    gap: 0;
  }

  &__name {
    padding: 0 24px;

    @media (max-width: $screen-mobile-l) {
      padding: 12px 16px 24px;
    }

    & > span {
      @extend %display-s-bold;
      color: var(--light-text-backgroung-primary);
      cursor: pointer;
    }
  }

  &__title-input {
    @include flex(rn, a-center);
    gap: 12px;
    width: 100%;

    input {
      width: 100%;
      padding: 3px 6px;
      @extend %display-s-bold;
      color: var(--light-text-backgroung-primary);

      &::placeholder {
        color: var(--light-text-backgroung-primary-50);
      }
    }

    & > div {
      @include flex(rn, a-center);
      gap: 4px;
      flex-shrink: 0;

      button {
        @extend %text-s-regular;
        color: var(--white-50);
        white-space: nowrap;
        cursor: pointer;
        transition: color 0.2s ease;

        &:hover {
          color: var(--white-100);
        }
      }

      span {
        @include flex(center);
        cursor: pointer;
        color: var(--light-text-backgroung-primary-50);
        padding: 4px;
        border-radius: 4px;
        transition: all 0.2s ease;

        &:hover {
          color: var(--white-100);
          background-color: var(--light-text-backgroung-primary-10);
        }

        svg {
          width: 20px;
          height: 20px;
          stroke: currentColor;
        }
      }
    }
  }

  &__wrapper {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--dark-text-background-primary-50);
    z-index: 998;
  }

  &__resize-handle {
    position: fixed;
    top: 0;
    right: v-bind('`${sidebarWidth}px`');
    width: 4px;
    height: 100vh;
    cursor: col-resize;
    background: transparent;
    z-index: 1001;
    transition: background-color 0.2s ease;

    &:hover {
      background: var(--primary);
    }

    @media (max-width: $screen-mobile-l) {
      display: none;
    }
  }

  &__body {
    display: flex;
    flex-direction: column;
    flex: 0 0 220px;
    width: 220px;
    gap: 8px;

    @media (max-width: $screen-mobile-l) {
      order: 1;
      width: 100%;
      flex: none;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    }

    :deep(.base-dropdown__placeholder) {
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 0;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);

    &:last-child {
      border-bottom: none;
    }

    &_status .task-sidebar__value {
      color: var(--status-yellow);
    }

    &_parent {
      span {
        color: var(--white-50);
        @extend %p14-medium;
      }
    }
  }

  &__sp-badge {
    @extend %text-xs-medium;
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
  }

  &__sp-options {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  &__sp-btn {
    @extend %text-xs-medium;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--light-text-backgroung-primary-20);
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    transition: all 0.15s;

    @media (hover: hover) and (pointer: fine) {
      &:hover {
        border-color: var(--primary);
        color: var(--primary);
      }
    }

    &_active {
      border-color: var(--primary);
      background: var(--primary);
      color: var(--light-text-backgroung-primary);
      font-weight: 600;

      @media (hover: hover) and (pointer: fine) {
        &:hover {
          border-color: var(--primary);
          color: var(--light-text-backgroung-primary);
        }
      }
    }
  }

  &__recurrence-days {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  &__recurrence-badge {
    display: inline-flex;
    align-items: center;
    color: var(--primary);
  }

  &__day-btn {
    @extend %text-xs-medium;
    padding: 2px 5px;
    border-radius: 4px;
    border: 1px solid var(--light-text-backgroung-primary-20);
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    transition: all 0.15s;

    @media (hover: hover) and (pointer: fine) {
      &:hover {
        border-color: var(--primary);
        color: var(--primary);
      }
    }

    &_active {
      border-color: var(--primary);
      background: var(--primary);
      color: var(--light-text-backgroung-primary);
      font-weight: 600;
    }
  }

  &__completion-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--light-text-backgroung-primary-20);
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    @extend %text-s-regular;
    transition: all 0.15s;

    svg {
      opacity: 0.4;
    }

    @media (hover: hover) and (pointer: fine) {
      &:hover {
        border-color: var(--primary);
        color: var(--primary);

        svg {
          opacity: 1;
        }
      }
    }

    &_done {
      border-color: var(--primary);
      background: var(--primary-15);
      color: var(--primary);
      font-weight: 600;

      svg {
        opacity: 1;
      }
    }
  }

  &__label {
    @extend %text-xs-medium;
    display: flex;
    white-space: nowrap;
    align-items: center;
    color: var(--light-text-backgroung-primary-50);
    gap: 4px;
  }

  &__edit {
    cursor: pointer;
    color: var(--light-text-backgroung-primary-50);
    display: flex;
    transition: color 0.15s;

    &:hover {
      color: var(--light-text-backgroung-primary);
    }
  }

  &__value {
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;

    &--highlight {
      font-weight: bold;
    }
  }

  &__footer {
    padding: 16px;
    border-top: 1px solid #333;
    display: flex;
    gap: 8px;
  }

  &__add-time,
  &__add-participant {
    background: none;
    border: 1px dashed #555;
    color: #fff;
    padding: 8px 12px;
    cursor: pointer;
    border-radius: 4px;
  }

  &__buttons {
    @include flex(rn);
    gap: 8px;
    margin-left: auto;
  }

  &__info {
    display: flex;
    gap: 16px;
    padding: 0 24px;

    @media (max-width: $screen-tablet) {
      flex-direction: column;
    }

    @media (max-width: $screen-mobile-l) {
      padding: 0 16px 24px;
    }
  }

  &__description-header {
    @extend %p18-bold;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--white-50);

    span {
      &:first-child {
        @extend %text-xl-medium;
        color: var(--light-text-backgroung-primary-50);
      }
    }

    span:nth-of-type(2),
    span:nth-of-type(3) {
      cursor: pointer;
      @extend %p14-bold;
    }

    &_edit {
      @include flex(center);

      svg {
        stroke: var(--light-text-backgroung-primary-50);
        transition: stroke 0.2s ease;

        &:hover {
          stroke: var(--light-text-backgroung-primary);
        }
      }
    }
  }

  &__info-left {
    flex: 1;
    @include flex(cn);
    gap: 16px;

    @media (max-width: $screen-mobile-l) {
      order: 2;
    }
  }

  &__description-container {
    @include flex(c);
    gap: 12px;
    padding: 16px;
    background-color: var(--light-text-backgroung-primary-5);
    border-radius: 8px;
    flex: 1;

    &_active {
      border: 1px solid var(--light-text-backgroung-primary-10);
      background-color: unset;
    }
  }

  &__description-header_actions {
    @include flex(rn, a-center, j-end);
    gap: 12px;
    width: 100%;

    span {
      cursor: pointer;
      @include flex(center);
      width: 24px;
      height: 24px;
    }
  }

  &__description {
    @include flex(cn);
    gap: 12px;
    align-self: stretch;
    flex: 1;
    justify-content: space-between;

    :deep(.tiptap[contenteditable]) {
      flex: 1;
      min-height: 80px;
    }
  }

  &__params-container {
    flex: 1;
  }

  &__title {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    align-items: flex-start;

    p {
      width: 100%;
      @extend %h1;
    }

    & > span {
      cursor: pointer;
      @include flex(rn, a-center);
      gap: 4px;
      @extend %text-s-regular;
      white-space: nowrap;
      color: var(--danger-delete);
    }
  }

  &__title-actions {
    @include flex(rn, a-center);
    gap: 12px;
    flex-shrink: 0;

    .task-sidebar__duplicate-button,
    .task-sidebar__delete-button {
      cursor: pointer;
      @include flex(rn, a-center);
      gap: 6px;
      @extend %text-s-regular;
      white-space: nowrap;
      padding: 5px 10px;
      border-radius: 8px;
      transition:
        color 0.2s ease,
        background 0.2s ease;

      svg {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }

      @media (max-width: $screen-mobile-l) {
        padding: 6px;
      }
    }

    .task-sidebar__action-label {
      @media (max-width: $screen-mobile-l) {
        display: none;
      }
    }

    .task-sidebar__duplicate-button {
      color: var(--light-text-backgroung-primary-50);

      &:hover {
        color: var(--white-100);
        background: var(--light-text-backgroung-primary-5);
      }
    }

    .task-sidebar__delete-button {
      color: var(--danger-delete);

      &:hover {
        background: var(--danger-delete-10);
      }
    }

    .task-sidebar__action_disabled {
      opacity: 0.6;
      pointer-events: none;
      cursor: default;
    }
  }

  &__close-button {
    color: var(--light-text-backgroung-primary-50) !important;
    padding: 4px;
    border-radius: 4px;
    transition: all 0.2s ease;
    display: flex;

    @media (max-width: $screen-mobile-l) {
      display: none;
    }

    &:hover {
      color: var(--white-100) !important;
      background-color: var(--light-text-backgroung-primary-10);
    }

    svg {
      width: 20px;
      height: 20px;
      stroke: currentColor;
    }

    &-input {
      @include flex(rn, a-center);
      gap: 8px;
      padding: 0 8px;
      border-radius: 8px;
      border: 1px solid var(--light-text-backgroung-primary-10);

      & > div {
        @include flex(rn, a-center);
        gap: 2px;
        cursor: pointer;
      }

      span {
        @include flex(center);
        width: 24px;
        height: 24px;
      }

      button {
        padding: 6px 10px;
      }

      svg {
        fill: var(--light-text-backgroung-primary-50);
        width: 14px;
        height: 14px;
      }

      input {
        width: 100%;
        @extend %display-s-bold;
        color: var(--light-text-backgroung-primary);
        background: unset;
        padding: 0;
      }
    }
  }

  &__close {
    display: none;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);

    @media (max-width: $screen-mobile-l) {
      @include flex(rn, a-center);
      gap: 8px;
      padding: 4px 16px 28px;
    }

    span {
      @extend %text-l-medium;
    }
  }

  &__header {
    display: flex;
    gap: 12px;
    flex-direction: column;
    align-content: center;
    justify-content: space-between;
    padding: 0 24px;

    @media (max-width: $screen-mobile-l) {
      padding: 24px 16px 0;
    }
  }

  @media (max-width: $screen-tablet) {
    width: 100%;
  }
}
</style>
