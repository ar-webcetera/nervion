<script setup lang="ts">
import { definePageMeta } from '#imports';
import BaseModal from '~/components/BaseModal.vue';
import UserEditModal from '~/components/UserEditModal.vue';
import ResetPasswordModal from '~/components/ResetPasswordModal.vue';
import { ROLES, type User } from '~/types/user';
const userStore = useUserStore();
const { $toast } = useNuxtApp();

const userAddModal = ref<InstanceType<typeof BaseModal> | null>(null);
const userEditModal = ref<InstanceType<typeof BaseModal> | null>(null);
const resetPasswordModal = ref<InstanceType<typeof BaseModal> | null>(null);
const editUser = ref<User | null>(null);
const selectedUserId = ref<number | null>(null);

const openUserEditModal = (userId: number) => {
  editUser.value = userStore.users.find((user) => user.id === userId) || null;
  if (!editUser.value) return;
  userEditModal.value?.open();
};

const openResetPasswordModal = (userId: number) => {
  selectedUserId.value = userId;
  resetPasswordModal.value?.open();
};

const handleArchiveUser = async (user: User) => {
  if (!confirm(`Архивировать пользователя ${user.first_name} ${user.last_name}?`)) return;
  try {
    await userStore.archiveUser(user.id);
    $toast.success('Пользователь архивирован');
  } catch {
    $toast.error('Не удалось архивировать пользователя');
  }
};

const handleRestoreUser = async (user: User) => {
  try {
    await userStore.restoreUser(user.id);
    $toast.success('Пользователь восстановлен');
  } catch {
    $toast.error('Не удалось восстановить пользователя');
  }
};

await useAsyncData('archived-users', () => userStore.fetchArchivedUsers());

definePageMeta({
  middleware: ['auth', 'role'],
  roles: [ROLES.admin],
});
</script>

<template>
  <div class="users-management">
    <header class="users-management__header">
      <h1>Пользователи</h1>

      <button class="users-management__add-btn" @click="userAddModal?.open()">
        <IconsIconPlus />
        Добавить пользователя
      </button>
    </header>
    <hr />
    <main class="users-management__main">
      <section class="users-section">
        <div class="users-section__grid users-section__grid_header">
          <span>ФИО</span>
          <span>Роль</span>
          <span>e-mail</span>
          <span>Пароль</span>
          <span></span>
        </div>
        <div v-for="user in userStore.users" :key="user.id" class="users-section__grid users-section__grid_row">
          <div class="user-cell user-cell_name">
            <button class="user-cell__edit-btn" @click="openUserEditModal(user.id)">
              <IconsIconEditSimple />
            </button>
            <span>{{ user.first_name }} {{ user.last_name }} {{ user.patronymic }}</span>
          </div>
          <span class="user-cell">{{ user.role }}</span>
          <span class="user-cell">{{ user.email }}</span>
          <a href="#" class="user-cell user-cell_link" @click.prevent="openResetPasswordModal(user.id)">Сбросить пароль</a>
          <button class="user-cell__archive-btn" title="Архивировать" @click="handleArchiveUser(user)">
            <IconsIconArchive />
          </button>
        </div>
      </section>

      <section v-if="userStore.archivedUsers.length" class="users-section users-section_archived">
        <h2>Архивные пользователи</h2>
        <div class="users-section__grid users-section__grid_header">
          <span>ФИО</span>
          <span>Роль</span>
          <span>e-mail</span>
          <span></span>
          <span></span>
        </div>
        <div v-for="user in userStore.archivedUsers" :key="user.id" class="users-section__grid users-section__grid_row users-section__grid_row_archived">
          <div class="user-cell user-cell_name">
            <span>{{ user.first_name }} {{ user.last_name }} {{ user.patronymic }}</span>
          </div>
          <span class="user-cell">{{ user.role }}</span>
          <span class="user-cell">{{ user.email }}</span>
          <span></span>
          <button class="user-cell user-cell_link user-cell__restore-btn" @click="handleRestoreUser(user)">Восстановить</button>
        </div>
      </section>
    </main>
  </div>
  <teleport to="body">
    <BaseModal ref="userAddModal">
      <UserEditModal type="add" @close="userAddModal?.close()" />
    </BaseModal>
    <BaseModal ref="userEditModal">
      <UserEditModal v-if="editUser" type="edit" :user="editUser" @close="userEditModal?.close()" />
    </BaseModal>
    <BaseModal ref="resetPasswordModal">
      <ResetPasswordModal v-if="selectedUserId" :user-id="selectedUserId" @close="resetPasswordModal?.close()" />
    </BaseModal>
  </teleport>
</template>

<style scoped lang="scss">
.users-management {
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
  h2 {
    margin: 0;
  }
  &__header {
    @include flex(rn, between, a-center);
    gap: 16px;
  }

  &__main {
    overflow-y: auto;
  }

  &__add-btn {
    svg {
      stroke: var(--light-text-backgroung-primary);
    }
  }
}

.users-section {
  @extend %ds-card;
  padding: 16px;
  margin-bottom: 16px;

  &_archived {
    opacity: 0.7;

    h2 {
      @extend %text-m-medium;
      color: var(--light-text-backgroung-primary-50);
      margin-bottom: 12px;
    }
  }

  &__title {
    @extend %h1;
    margin-bottom: 24px;
  }

  &__grid {
    display: grid;
    grid-template-columns: 2fr 1fr 2fr 1fr 0.5fr;
    gap: 16px;
    align-items: center;

    &_header {
      @extend %text-xs-regular;
      color: var(--light-text-backgroung-primary-50);
      padding: 0 0px 8px 0px;
      border-bottom: 1px solid var(--light-text-backgroung-primary-5);
      margin-bottom: 8px;
    }

    &_row {
      padding: 8px 0px;
      border-radius: 8px;
      transition: background-color 0.2s ease;

      &:hover {
        background-color: var(--light-text-backgroung-primary-10);
      }
    }
  }
}

.user-cell {
  @extend %text-s-regular;
  color: var(--light-text-backgroung-primary);

  &_name {
    @include flex(rn, a-center);
    gap: 12px;
  }

  &__edit-btn {
  }

  &_link {
    color: var(--primary);
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }

  &__archive-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--light-text-backgroung-primary);
    @include flex(center);
    width: 36px;
    height: 36px;
    border-radius: 6px;
    transition: color 0.2s ease, background-color 0.2s ease;

    :deep(svg) {
      width: 24px;
      height: 24px;
    }

    &:hover {
      color: var(--danger-delete);
      background-color: var(--light-text-backgroung-primary-10);
    }
  }

  &__restore-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  &__access-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    padding: 2px;
    @include flex(center);

    &_active {
      background-color: var(--green);
    }

    &_inactive {
      background-color: var(--danger-delete);
    }
  }
}
</style>
