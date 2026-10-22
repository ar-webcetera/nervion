<script setup lang="ts">
import { Settings, Check, X } from '@lucide/vue';
import type { TaskStage, RemovedTaskStage, ApplyTaskStages } from '@tracker/contracts';

const props = defineProps<{ editing: boolean }>();
const emit = defineEmits<{ 'update:editing': [value: boolean]; changed: []; 'draft-change': [stages: TaskStage[]] }>();
const { stages, refresh } = useTaskStages();
const baseURL = useApiBaseUrl();
const { $toast } = useNuxtApp();
const draft = ref<TaskStage[]>([]);
const original = ref<TaskStage[]>([]);
const removedStages = ref<RemovedTaskStage[]>([]);
const removedCounts = ref<Record<string, number>>({});
const publishDraft = () =>
  emit(
    'draft-change',
    draft.value.map((stage, position) => ({ ...stage, position })),
  );
const resetDraft = () => {
  draft.value = [];
  original.value = [];
  removedStages.value = [];
  removedCounts.value = {};
  modalOpen.value = false;
  publishDraft();
};
const beginEditing = async () => {
  if (busy.value) return;
  busy.value = true;
  try {
    await refresh();
    original.value = stages.value.map((stage) => ({ ...stage }));
    draft.value = stages.value.map((stage) => ({ ...stage }));
    removedStages.value = [];
    removedCounts.value = {};
    publishDraft();
    emit('update:editing', true);
    menuOpen.value = false;
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    busy.value = false;
  }
};
const cancelEditing = () => {
  if (busy.value) return;
  resetDraft();
  emit('update:editing', false);
};
watch(
  () => props.editing,
  (editing) => {
    if (!editing) resetDraft();
  },
);
const finishEditing = async () => {
  if (busy.value) return;
  const compact = (items: TaskStage[]) => items.map(({ id, title }) => ({ id, title }));
  if (JSON.stringify(compact(original.value)) === JSON.stringify(compact(draft.value))) {
    cancelEditing();
    return;
  }
  busy.value = true;
  try {
    const body: ApplyTaskStages = {
      originalStages: compact(original.value),
      stages: compact(draft.value),
      removedStages: removedStages.value,
    };
    stages.value = await $fetch<TaskStage[]>('/api/tasks/stages', { baseURL, credentials: 'include', method: 'PATCH', body });
    emit('changed');
    emit('update:editing', false);
    resetDraft();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    busy.value = false;
  }
};
const menuOpen = ref(false);
const busy = ref(false);
const modalOpen = ref(false);
const selected = ref<TaskStage | null>(null);
const afterStageId = ref<string | undefined>();
const deleting = ref(false);
const title = ref('');
const target = ref<string>('');
const total = ref<number | null>(null);
const countLoading = ref(false);
const error = ref('');
const titleInput = ref<HTMLInputElement | null>(null);
const dialogContent = ref<HTMLElement | null>(null);
let trigger: HTMLElement | null = null;
const destinations = computed(() =>
  draft.value.filter((stage) => stage.id !== selected.value?.id).map((stage) => ({ value: stage.id, label: stage.title })),
);

const open = async (id?: string, remove = false, insertAfter?: string) => {
  afterStageId.value = insertAfter;
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  selected.value = draft.value.find((stage) => stage.id === id) ?? null;
  if (id && (!selected.value || selected.value.protected)) return;
  deleting.value = remove;
  title.value = selected.value?.title ?? '';
  target.value = '';
  total.value = null;
  error.value = '';
  modalOpen.value = true;
  await nextTick();
  (titleInput.value ?? dialogContent.value)?.focus();
  if (remove && id) {
    countLoading.value = true;
    try {
      const result = original.value.some((stage) => stage.id === id)
        ? await $fetch<{ total: number }>(`/api/tasks/stages/${encodeURIComponent(id)}/count`, {
            baseURL,
            credentials: 'include',
          })
        : { total: 0 };
      total.value =
        result.total +
        removedStages.value
          .filter((stage) => stage.targetStatus === id)
          .reduce((sum, stage) => sum + (removedCounts.value[stage.id] ?? 0), 0);
    } catch (e) {
      error.value = getErrorMessage(e);
    } finally {
      countLoading.value = false;
    }
  }
};
const close = () => {
  if (busy.value) return;
  modalOpen.value = false;
  trigger?.focus();
};
const trapFocus = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.stopPropagation();
    close();
  }
  if (event.key !== 'Tab') return;
  const controls = dialogContent.value?.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
  );
  if (!controls?.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogContent.value)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};
const save = () => {
  if (busy.value || countLoading.value) return;
  error.value = '';
  const name = title.value.trim();
  const id = selected.value?.id;
  if (!deleting.value && !name) {
    error.value = 'Введите название этапа';
    return;
  }
  if (!deleting.value && draft.value.some((stage) => stage.id !== id && stage.title.toLowerCase() === name.toLowerCase())) {
    error.value = 'Этап с таким названием уже существует';
    return;
  }
  if (deleting.value) {
    if (!id || total.value === null) return;
    if (total.value > 0 && !target.value) {
      error.value = 'Выберите этап для переноса задач';
      return;
    }
    const destination = target.value || undefined;
    const incoming = removedStages.value
      .filter((stage) => stage.targetStatus === id)
      .reduce((sum, stage) => sum + (removedCounts.value[stage.id] ?? 0), 0);
    if (original.value.some((stage) => stage.id === id)) {
      removedStages.value.push({ id, targetStatus: destination });
      removedCounts.value[id] = total.value - incoming;
    }
    removedStages.value = removedStages.value.map((stage) =>
      stage.targetStatus === id ? { ...stage, targetStatus: destination } : stage,
    );
    draft.value = draft.value.filter((stage) => stage.id !== id);
  } else if (id) {
    draft.value = draft.value.map((stage) => (stage.id === id ? { ...stage, title: name } : stage));
  } else {
    if (draft.value.length >= 100) {
      error.value = 'Можно создать не более 100 этапов';
      return;
    }
    const after = draft.value.findIndex((stage) => stage.id === afterStageId.value);
    const position = after < 0 ? draft.value.length : after + 1;
    draft.value.splice(position, 0, { id: `draft_${crypto.randomUUID()}`, title: name, position, protected: false });
  }
  publishDraft();
  close();
};
const reorder = (ids: string[]) => {
  if (busy.value || ids.length !== draft.value.length || new Set(ids).size !== ids.length) return;
  if (ids.some((id) => !draft.value.some((stage) => stage.id === id))) return;
  draft.value = ids.map((id, position) => ({ ...draft.value.find((stage) => stage.id === id)!, position }));
  publishDraft();
};
const openAfter = (id: string) => open(undefined, false, id);
defineExpose({ open, openAfter, reorder, busy });
</script>

<template>
  <div v-click-outside="() => (menuOpen = false)" class="stage-settings" @keydown.esc="menuOpen = false">
    <template v-if="editing">
      <button class="stage-settings__cancel" type="button" :disabled="busy" @click="cancelEditing">
        <X :size="16" :stroke-width="1.75" aria-hidden="true" /> Отменить
      </button>
      <button class="stage-settings__done" type="button" :disabled="busy" @click="finishEditing">
        <Check :size="16" :stroke-width="1.75" aria-hidden="true" /> {{ busy ? 'Сохранение…' : 'Готово' }}
      </button>
    </template>
    <button
      v-else
      class="stage-settings__trigger"
      type="button"
      title="Настройки доски"
      aria-label="Настройки доски"
      :aria-expanded="menuOpen"
      @click="menuOpen = !menuOpen"
    >
      <Settings :size="20" :stroke-width="1.75" />
    </button>
    <div v-if="menuOpen" class="stage-settings__menu">
      <button type="button" :disabled="busy" @click="beginEditing">Настроить воронку</button>
    </div>
  </div>
  <BaseModal v-model="modalOpen" :dismissible="false" :show-close="false" padded>
    <form
      ref="dialogContent"
      class="stage-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stage-dialog-title"
      tabindex="-1"
      @submit.prevent="save"
      @keydown="trapFocus"
    >
      <h2 id="stage-dialog-title">{{ deleting ? 'Удалить этап?' : selected ? 'Название этапа' : 'Новый этап' }}</h2>
      <template v-if="deleting">
        <p>Этап "{{ selected?.title }}" будет удалён после нажатия "Готово".</p>
        <p v-if="countLoading" role="status">Считаем задачи…</p>
        <p v-else-if="total === 0">В этом этапе нет задач.</p>
        <template v-else-if="total !== null">
          <p>Задач для переноса: {{ total }}. Учитываются все производственные задачи, включая скрытые фильтрами.</p>
          <label>Куда переместить задачи</label>
          <BaseSelect
            :model-value="target"
            :options="destinations"
            placeholder="Выберите этап"
            :disabled="busy"
            @update:model-value="target = typeof $event === 'string' ? $event : ''"
          />
        </template>
      </template>
      <template v-else>
        <label for="stage-title">Название</label>
        <input
          id="stage-title"
          ref="titleInput"
          v-model="title"
          maxlength="80"
          autocomplete="off"
          :disabled="busy"
          :aria-invalid="!!error"
          aria-describedby="stage-error"
        />
      </template>
      <p v-if="error" id="stage-error" class="stage-dialog__error" role="alert">{{ error }}</p>
      <div class="stage-dialog__actions">
        <button type="button" :disabled="busy" @click="close">Отмена</button>
        <button
          type="submit"
          :class="{ 'stage-dialog__danger': deleting }"
          :disabled="busy || countLoading || (deleting && (total === null || (total > 0 && !target)))"
        >
          {{ deleting ? 'Удалить этап' : selected ? 'Применить' : 'Добавить' }}
        </button>
      </div>
    </form>
  </BaseModal>
</template>

<style scoped lang="scss">
.stage-settings {
  position: relative;
  @include flex(rn, a-center);
  gap: 8px;
  &__menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 30;
    min-width: 210px;
    padding: 4px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--dark-text-background-primary);
    button {
      width: 100%;
    }
  }
}
.stage-settings button,
.stage-dialog button {
  @include flex(rn, center);
  gap: 8px;
  min-height: 44px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--light-text-backgroung-primary-10);
  background: var(--light-text-backgroung-primary-5);
  color: var(--light-text-backgroung-primary);
  cursor: pointer;
  @extend %text-s-medium;
  &:hover:not(:disabled) {
    background: var(--light-text-backgroung-primary-10);
  }
  &:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.stage-settings {
  button {
    border: 0;
    min-height: 32px;
    background: transparent;
  }
  button.stage-settings__trigger {
    width: 32px;
    padding: 4px;
    border: none;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    color: var(--light-text-backgroung-primary-50);
    &:hover:not(:disabled),
    &[aria-expanded='true'] {
      background: transparent;
      color: var(--light-text-backgroung-primary);
    }
  }
  button.stage-settings__cancel {
    padding: 6px 12px;
    color: var(--light-text-backgroung-primary-50);
    &:hover:not(:disabled) {
      color: var(--light-text-backgroung-primary);
    }
  }
  button.stage-settings__done {
    padding: 6px 12px;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
    &:hover:not(:disabled) {
      background: var(--primary-hover);
    }
  }
  &__menu button {
    justify-content: flex-start;
    min-height: 40px;
  }
  @media (max-width: $screen-tablet) {
    button {
      min-height: 44px;
    }
    button.stage-settings__trigger {
      width: 44px;
    }
  }
}

.stage-dialog {
  @include flex(cn);
  gap: 16px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  color: var(--light-text-backgroung-primary);
  h2 {
    @extend %h1;
    margin: 0;
  }
  p,
  label {
    @extend %text-s-regular;
    margin: 0;
    overflow-wrap: anywhere;
  }
  input {
    min-width: 0;
    width: 100%;
    padding: 12px;
    border-radius: 8px;
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary);
    background: var(--light-text-backgroung-primary-5);
    border: 1px solid var(--light-text-backgroung-primary-25);
    &:focus-visible {
      outline: 2px solid var(--primary);
    }
  }
  &__error {
    color: var(--danger-delete);
  }
  &__actions {
    @include flex(rw, j-end);
    gap: 8px;
  }
  button[type='submit'] {
    background: var(--primary);
  }
  button.stage-dialog__danger {
    background: var(--danger-delete);
  }
}
</style>
