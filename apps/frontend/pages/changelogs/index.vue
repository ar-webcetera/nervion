<script setup lang="ts">
import { ROLES } from '~/types/user';
import type { JSONContent } from '@tiptap/core';
import type { Changelog } from '~/stores/changelogStore';
import EditorTiptap from '~/components/TipTap/EditorTiptap.vue';

definePageMeta({
  middleware: ['auth', 'role'],
  roles: [ROLES.admin],
});

const changelogStore = useChangelogStore();
const { $toast } = useNuxtApp();

const isCreating = ref(false);
const editingId = ref<number | null>(null);

const form = ref({
  title: '',
  body: null as JSONContent | null,
  is_published: false,
});

const resetForm = () => {
  form.value = { title: '', body: null, is_published: false };
  isCreating.value = false;
  editingId.value = null;
};

const openCreate = () => {
  resetForm();
  isCreating.value = true;
};

const openEdit = (changelog: Changelog) => {
  editingId.value = changelog.id;
  form.value = {
    title: changelog.title,
    body: changelog.body,
    is_published: changelog.is_published,
  };
  isCreating.value = true;
};

const save = async () => {
  if (!form.value.title.trim()) {
    $toast.error('Введите заголовок');
    return;
  }
  try {
    if (editingId.value) {
      await changelogStore.update(editingId.value, form.value);
      $toast.success('Обновление сохранено');
    } else {
      await changelogStore.create(form.value);
      $toast.success('Обновление создано');
    }
    resetForm();
  } catch {
    $toast.error('Ошибка при сохранении');
  }
};

const togglePublish = async (changelog: Changelog) => {
  try {
    await changelogStore.update(changelog.id, { is_published: !changelog.is_published });
  } catch {
    $toast.error('Ошибка');
  }
};

const remove = async (id: number) => {
  try {
    await changelogStore.remove(id);
    $toast.trash('Удалено');
  } catch {
    $toast.error('Ошибка при удалении');
  }
};

const filePrefix = computed(() =>
  editingId.value ? `tracker-changelogs/${editingId.value}/` : 'tracker-changelogs/draft/',
);

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

await useAsyncData('changelogs', async () => { await changelogStore.fetchAll(); return true; });
</script>

<template>
  <div class="changelogs-page">
    <header class="changelogs-page__header">
      <h1>Changelog</h1>
      <button v-if="!isCreating" class="button" @click="openCreate">+ Новое обновление</button>
    </header>
    <hr />

    <div v-if="isCreating" class="changelogs-form">
      <div class="changelogs-form__header">
        <h2>{{ editingId ? 'Редактировать' : 'Новое обновление' }}</h2>
      </div>

      <div class="changelogs-form__field">
        <label class="changelogs-form__label">Заголовок</label>
        <input
          v-model="form.title"
          class="changelogs-form__input"
          placeholder="Версия 2.5 — Story Points и новые фичи"
          type="text"
        />
      </div>

      <div class="changelogs-form__field">
        <label class="changelogs-form__label">Содержимое</label>
        <div class="changelogs-form__editor">
          <EditorTiptap
            :key="editingId ?? 'new'"
            v-model="form.body as JSONContent"
            :value="(form.body as JSONContent) ?? {}"
            :is-editable="true"
            :file-prefix="filePrefix"
            placeholder="Опишите что нового в этом обновлении..."
          />
        </div>
      </div>

      <div class="changelogs-form__footer">
        <label class="changelogs-form__checkbox">
          <input v-model="form.is_published" type="checkbox" />
          <span>Опубликовать (показать пользователям)</span>
        </label>
        <div class="changelogs-form__actions">
          <button class="button_secondary" @click="resetForm">Отмена</button>
          <button class="button" @click="save">{{ editingId ? 'Сохранить' : 'Создать' }}</button>
        </div>
      </div>
    </div>

    <div class="changelogs-list">
      <div v-if="!changelogStore.all.length" class="changelogs-list__empty">
        Нет ни одного changelog-а. Создайте первый!
      </div>
      <div v-for="cl in changelogStore.all" :key="cl.id" class="changelogs-item">
        <div class="changelogs-item__left">
          <div class="changelogs-item__title">{{ cl.title }}</div>
          <div class="changelogs-item__date">{{ formatDate(cl.created_at) }}</div>
        </div>
        <div class="changelogs-item__right">
          <span class="changelogs-item__views">👁 {{ cl.views_count ?? 0 }}</span>
          <span
            class="changelogs-item__status"
            :class="cl.is_published ? 'changelogs-item__status_published' : 'changelogs-item__status_draft'"
          >
            {{ cl.is_published ? 'Опубликован' : 'Черновик' }}
          </span>
          <button class="button_secondary changelogs-item__btn" @click="togglePublish(cl)">
            {{ cl.is_published ? 'Скрыть' : 'Опубликовать' }}
          </button>
          <button class="button_secondary changelogs-item__btn" @click="openEdit(cl)">Редактировать</button>
          <button class="button_danger changelogs-item__btn" @click="remove(cl.id)">Удалить</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.changelogs-page {
  width: 100%;
  height: 100dvh;
  padding: 16px;
  min-width: 0;
  flex: 1;
  @include flex(cn);
  gap: 16px;

  h1 {
    margin: 0;
    @extend %display-xs-medium;
  }

  &__header {
    @include flex(rn, between, a-center);
    width: 100%;
  }
}

.changelogs-form {
  background: var(--light-text-backgroung-primary-5);
  border: 1px solid var(--light-text-backgroung-primary-10);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;

  &__header h2 {
    @extend %text-l-medium;
    color: var(--light-text-backgroung-primary);
    margin: 0 0 20px;
  }

  &__field {
    margin-bottom: 16px;
  }

  &__label {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary-50);
    display: block;
    margin-bottom: 6px;
  }

  &__input {
    width: 100%;
    box-sizing: border-box;
    background: var(--light-text-backgroung-primary-5);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    padding: 10px 12px;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;

    &:focus {
      outline: none;
      border-color: var(--primary);
    }
  }

  &__editor {
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    min-height: 200px;
    overflow: hidden;
  }

  &__footer {
    @include flex(rn, a-center, between);
    margin-top: 20px;
    gap: 12px;
  }

  &__checkbox {
    @include flex(a-center);
    gap: 8px;
    cursor: pointer;
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary);
  }

  &__actions {
    @include flex(r);
    gap: 8px;
  }
}

.changelogs-list {
  @include flex(cn);
  gap: 8px;

  &__empty {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-50);
    padding: 32px;
    text-align: center;
  }
}

.changelogs-item {
  @include flex(rn, a-center, between);
  gap: 16px;
  background: var(--light-text-backgroung-primary-5);
  border: 1px solid var(--light-text-backgroung-primary-10);
  border-radius: 12px;
  padding: 16px 20px;

  &__left {
    flex: 1;
    min-width: 0;
  }

  &__title {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__date {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
    margin-top: 2px;
  }

  &__right {
    @include flex(a-center);
    gap: 8px;
    flex-shrink: 0;
  }

  &__views {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
    white-space: nowrap;
  }

  &__status {
    @extend %text-xs-medium;
    padding: 2px 8px;
    border-radius: 20px;

    &_published {
      background: var(--green-25);
      color: var(--green);
    }

    &_draft {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__btn {
    white-space: nowrap;
  }
}

.button_danger {
  background: var(--danger-delete-10);
  color: var(--danger-delete);
  border: 1px solid var(--danger-delete-25);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  @extend %text-xs-medium;

  &:hover {
    background: var(--danger-delete-25);
  }
}
</style>
