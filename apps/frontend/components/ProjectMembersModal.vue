<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Project, ProjectMember } from '~/types/project';
import { useUserStore } from '~/stores/userStore';
import { PROJECT_MEMBER_ROLES, ROLE_OPTIONS } from '~/constants/roles.constants';
import IconUnlink from './Icons/IconUnlink.vue';
import { ROLES } from '~/types/user';

const userStore = useUserStore();
const { $toast } = useNuxtApp();

const props = defineProps<{
  project: Project;
}>();

const emit = defineEmits<{
  (e: 'save', members: Array<{ id: number; role: string }>): void;
}>();

const members = ref<ProjectMember[]>([...props.project.members]);
const selectedUserToAdd = ref<string | null>(null);
const { deleteMemberModal, openDeleteMemberModal, closeDeleteMemberModal, memberId } = useProject();

const allUsers = computed(() => {
  return (userStore.users || []).map((user) => ({
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    photo_url: user.photo_url,
    email: user.email,
  }));
});

const availableUsers = computed(() => {
  const memberIds = new Set(members.value.map((m) => m.id));
  return allUsers.value.filter((user) => !memberIds.has(user.id));
});

const addMember = (user: ProjectMember) => {
  members.value.push(user);
  handleSave();
  $toast.user(`Участник “${user.first_name} ${user.last_name}” успешно добавлен в проект`);
};

const handleAddUserFromDropdown = (value: string | number | (string | number)[] | null) => {
  if (value) {
    const userId = parseInt(value.toString());
    const user = allUsers.value.find((u) => u.id === userId);
    if (user) {
      addMember(user);
      selectedUserToAdd.value = null;
    }
  }
};

const removeMember = () => {
  if (!memberId.value) return;
  const member = members.value.find((m) => m.id === memberId.value);
  members.value = members.value.filter((m) => m.id !== memberId.value);
  handleSave();
  if (member) {
    $toast.trash(`Участник “${member?.first_name} ${member?.last_name}” успешно удален из проекта`);
  }
  closeDeleteMemberModal();
};

const handleSave = () => {
  const membersData = members.value.map((member) => ({
    id: member.id,
    role: member.role || PROJECT_MEMBER_ROLES.DEVELOPER,
  }));

  emit('save', membersData);
};

const saveMemberData = (id: number, value: PROJECT_MEMBER_ROLES) => {
  const member = members.value.find((m) => m.id === id);
  if (!member) return;
  member.role = value;
  handleSave();
};

const memberName = computed(() => {
  const member = members.value.find((m) => m.id === memberId.value);
  if (!member) return '';
  return `”${member.first_name} ${member.last_name}”`;
});
</script>

<template>
  <div class="members-modal">
    <div class="members-modal__header">
      <h2>Участники</h2>
      <BaseDropdown
        v-if="userStore.user?.role === ROLES.admin"
        :model-value="selectedUserToAdd"
        :options="availableUsers.map((user) => ({ label: `${user.first_name} ${user.last_name}`, value: user.id.toString() }))"
        placeholder="+ Добавить участника"
        @update:model-value="handleAddUserFromDropdown"
      />
    </div>

    <div class="members-modal__list">
      <div v-if="members.length === 0" class="members-modal__empty">
        <img src="@/assets/empty_members.webp" alt="" />
        <p>В данном проекте нет участников</p>
      </div>
      <div v-for="member in members" v-else :key="member.id" class="members-modal__member">
        <div class="members-modal__member-info">
          <img
            v-if="member.photo_url"
            :src="member.photo_url"
            :alt="`${member.first_name} ${member.last_name}`"
            class="members-modal__avatar"
          />
          <div v-else class="members-modal__avatar members-modal__avatar_initials">
            {{ member.first_name.charAt(0) }}{{ member.last_name.charAt(0) }}
          </div>
          <div class="members-modal__member-details">
            <div class="members-modal__member-name">{{ member.first_name }} {{ member.last_name }}</div>
            <div class="members-modal__member-email">{{ member.email || 'email@example.com' }}</div>
          </div>
        </div>

        <div v-if="userStore.user?.role === ROLES.admin" class="members-modal__member-controls">
          <BaseSelect
            :model-value="member.role || PROJECT_MEMBER_ROLES.DEVELOPER"
            :options="ROLE_OPTIONS"
            placeholder="Выберите роль"
            arrow
            large
            @update:model-value="(value) => saveMemberData(member.id, value as PROJECT_MEMBER_ROLES)"
          />

          <button class="members-modal__delete-button" @click="openDeleteMemberModal(member.id)">
            <IconUnlink />
          </button>
        </div>
      </div>
    </div>
  </div>
  <teleport to="#teleports">
    <BaseModal ref="deleteMemberModal">
      <div class="delete-member-modal">
        <div class="delete-member-modal__header">
          <h2>Вы уверены что хотите удалить участника?</h2>
          <span> Вы собираетесь удалить участника {{ memberName }} из проекта ”{{ project.name }}” </span>
        </div>
        <div class="delete-member-modal__buttons">
          <button class="button_secondary" @click="closeDeleteMemberModal">Отменить</button>
          <button @click="removeMember">Удалить</button>
        </div>
      </div></BaseModal
    >
  </teleport>
</template>

<style scoped lang="scss">
:deep(.base-modal__content) {
  width: auto;
}

.delete-member-modal {
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

.members-modal {
  padding: 0 24px;
  width: 688px;

  &__header {
    @include flex(rn, a-center, between);
    margin-bottom: 12px;

    h2 {
      @extend %text-l-bold;
      color: var(--light-text-backgroung-primary);
      margin: 0;
    }

    &:deep(.base-dropdown__placeholder) {
      @extend %text-s-regular;
      color: var(--primary);
    }
  }

  &__add-button {
    @include flex(rn, a-center);
    gap: 8px;
    padding: 8px 16px;
    border-radius: 8px;
    background: transparent;
    color: var(--primary);
    @extend %text-s-medium;
    cursor: pointer;
    border: none;
    transition: background 0.2s ease;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    span:first-child {
      @extend %text-xl-light;
    }
  }

  &__list {
    @include flex(cn);
    gap: 8px;
    max-height: 90vh;
    overflow-y: auto;
  }

  &__empty {
    @include flex(cn, center);
    height: 100%;
    gap: 8px;
    text-align: center;

    img {
      width: 163px;
      height: auto;
    }

    p {
      @extend %text-s-medium;
      color: var(--light-text-backgroung-primary);
      margin: 0;
      width: 130px;
    }
  }

  &__member {
    @include flex(rn, a-center, between);
    padding: 8px;
    background-color: var(--light-text-backgroung-primary-5);
    border-radius: 8px;
    gap: 8px;
  }

  &__member-info {
    @include flex(rn, a-center);
    gap: 8px;
    flex: 1;
  }

  &__avatar {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    object-fit: cover;
    flex-shrink: 0;

    &_initials {
      @include flex(center);
      background-color: var(--primary);
      color: var(--light-text-backgroung-primary);
      @extend %text-s-regular;
    }
  }

  &__member-details {
    @include flex(cn);
    gap: 4px;
  }

  &__member-name {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__member-email {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__member-controls {
    @include flex(rn, a-center);
    gap: 12px;
    flex-shrink: 0;

    &:deep(.home-select__input) {
      padding: 8px 12px;
    }

    &:deep(.home-select__placeholder) {
      color: var(--light-text-backgroung-primary);
    }
  }

  &__select {
    padding: 8px 12px;
    border-radius: 8px;
    background-color: var(--light-text-backgroung-primary-10);
    color: var(--light-text-backgroung-primary);
    border: 1px solid var(--light-text-backgroung-primary-25);
    @extend %text-s-regular;
    cursor: pointer;
    min-width: 120px;

    &:focus {
      outline: none;
      border-color: var(--primary);
    }
  }

  &__cost-input {
    @include flex(rn, a-center);
    gap: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    background-color: var(--light-text-backgroung-primary-10);
    border: 1px solid var(--light-text-backgroung-primary-25);

    input {
      width: 80px;
      background: transparent;
      border: none;
      color: var(--light-text-backgroung-primary);
      @extend %text-s-regular;

      &:focus {
        outline: none;
      }

      &::placeholder {
        color: var(--light-text-backgroung-primary-50);
      }
    }

    span {
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary-50);
      white-space: nowrap;
    }
  }

  &__delete-button {
    @include flex(center);
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background-color: var(--light-text-backgroung-primary-5);
    border: none;
    cursor: pointer;
    transition: background 0.2s ease;
    padding: 0;

    &:hover {
      background-color: var(--light-text-backgroung-primary-10);
    }

    svg {
      width: 20px;
      height: 20px;
      stroke: var(--danger-delete-50);
      stroke-opacity: 1;
    }
  }
}
</style>
