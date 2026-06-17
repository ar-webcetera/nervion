<script setup lang="ts">
import type { ProjectMember } from '~/types/project';

defineProps<{
  member: ProjectMember;
}>();

const getInitials = (member: ProjectMember): string => {
  const firstInitial = member.first_name.charAt(0).toUpperCase();
  const lastInitial = member.last_name.charAt(0).toUpperCase();
  return firstInitial + lastInitial;
};

const getBackgroundColor = (id: number): string => {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];

  return colors[id % colors.length];
};

const imgError = ref(false);
</script>

<template>
  <div v-if="member.photo_url && !imgError" :title="`${member.first_name} ${member.last_name}`" class="avatar avatar_image">
    <img :src="member.photo_url" :alt="`${member.first_name} ${member.last_name}`" @error="imgError = true" />
  </div>
  <div
    v-else
    :title="`${member.first_name} ${member.last_name}`"
    class="avatar avatar_initials"
    :style="{ backgroundColor: getBackgroundColor(member.id) }"
  >
    {{ getInitials(member) }}
  </div>
</template>

<style scoped lang="scss">
.avatar {
  width: 28px;
  height: 28px;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  @include flex(center);
  flex-shrink: 0;

  &:first-child {
    margin-left: 0;
  }

  &_image {
    overflow: hidden;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &_initials {
    @extend %text-xs-medium;
    color: var(--light-text-backgroung-primary);
    background-color: var(--primary);
  }
}
</style>
