<script setup lang="ts">
import { format, eachDayOfInterval, isSameDay, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { Allocation } from '~/types/allocation';
import type { User } from '~/types/user';

interface Props {
  allocations: Allocation[];
  users: User[];
  startDate: Date;
  endDate: Date;
  readonly?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  readonly: false,
});
const emit = defineEmits(['allocation-click', 'cell-click', 'allocation-resize']);

const days = computed(() => {
  return eachDayOfInterval({ start: props.startDate, end: props.endDate });
});

const allocationsByUser = computed(() => {
  const grouped = new Map<number, Allocation[]>();

  props.users.forEach((user) => {
    grouped.set(user.id, []);
  });

  props.allocations.forEach((allocation) => {
    const userAllocations = grouped.get(allocation.user_id);
    if (userAllocations) {
      userAllocations.push(allocation);
    }
  });

  return grouped;
});

const userWeeklyHours = computed(() => {
  const hours = new Map<number, number>();

  props.users.forEach((user) => {
    const userAllocations = allocationsByUser.value.get(user.id) || [];
    const totalHours = userAllocations.reduce((sum, allocation) => sum + (allocation.hours || 0), 0);
    hours.set(user.id, Math.round(totalHours * 100) / 100);
  });

  return hours;
});

const getAllocationStyle = (allocation: Allocation, userId: number) => {
  const startDate = parseISO(allocation.start_date);
  const endDate = parseISO(allocation.end_date);

  const startIndex = days.value.findIndex((day) => isSameDay(day, startDate));
  if (startIndex === -1) return null;

  const daysCount = days.value.filter((day) => {
    return day >= startDate && day <= endDate;
  }).length;

  if (daysCount === 0) return null;

  const cellWidth = 120;
  const gap = 4;
  const maxDayHeight = 80;
  const allocationGap = 2;
  const maxAllocationHeight = 160;

  const hours = allocation.hours || 8;
  const heightRatio = hours / 8;
  const allocationHeight = Math.min(Math.max(maxDayHeight * heightRatio, 24), maxAllocationHeight);
  const userAllocations = allocationsByUser.value.get(userId) || [];

  let topOffset = 0;

  const sortedAllocations = [...userAllocations].sort((a, b) => a.id - b.id);

  for (const otherAllocation of sortedAllocations) {
    if (otherAllocation.id === allocation.id) break;

    const otherStart = parseISO(otherAllocation.start_date);
    const otherEnd = parseISO(otherAllocation.end_date);

    if (!(endDate < otherStart || startDate > otherEnd)) {
      const otherHours = otherAllocation.hours || 8;
      const otherHeightRatio = otherHours / 8;
      const otherHeight = Math.min(Math.max(maxDayHeight * otherHeightRatio, 24), maxAllocationHeight);
      topOffset += otherHeight + allocationGap;
    }
  }

  return {
    left: `${startIndex * (cellWidth + gap)}px`,
    width: `${daysCount * cellWidth + (daysCount - 1) * gap}px`,
    top: `${topOffset}px`,
    height: `${allocationHeight}px`,
  };
};

const handleAllocationClick = (allocation: Allocation) => {
  emit('allocation-click', allocation);
};

const handleCellClick = (user: User, day: Date) => {
  emit('cell-click', { user, day });
};

const getRowHeight = (userId: number) => {
  const userAllocations = allocationsByUser.value.get(userId) || [];
  if (userAllocations.length === 0) return '96px';

  const maxDayHeight = 80;
  const allocationGap = 2;
  const padding = 16;
  const maxAllocationHeight = 160;

  let maxTotalHeight = 0;

  days.value.forEach((day) => {
    let dayTotalHeight = 0;

    const dayAllocations = userAllocations.filter((allocation) => {
      const start = parseISO(allocation.start_date);
      const end = parseISO(allocation.end_date);
      return day >= start && day <= end;
    });

    dayAllocations.sort((a, b) => a.id - b.id);

    dayAllocations.forEach((allocation) => {
      const hours = allocation.hours || 8;
      const heightRatio = hours / 8;
      const allocationHeight = Math.min(Math.max(maxDayHeight * heightRatio, 24), maxAllocationHeight);
      dayTotalHeight += allocationHeight + allocationGap;
    });

    if (dayTotalHeight > 0) {
      dayTotalHeight -= allocationGap;
    }

    maxTotalHeight = Math.max(maxTotalHeight, dayTotalHeight);
  });

  return `${Math.max(maxTotalHeight + padding, 96)}px`;
};
</script>

<template>
  <div class="resource-timeline">
    <div class="resource-timeline__header">
      <div class="resource-timeline__header-corner">Специалист</div>
      <div class="resource-timeline__days">
        <div v-for="day in days" :key="day.toISOString()" class="resource-timeline__day-header">
          <div class="resource-timeline__day-name">{{ format(day, 'EEE', { locale: ru }) }}</div>
          <div class="resource-timeline__day-date">{{ format(day, 'd MMM', { locale: ru }) }}</div>
        </div>
      </div>
    </div>

    <div class="resource-timeline__body">
      <div v-for="user in users" :key="user.id" class="resource-timeline__row" :style="{ minHeight: getRowHeight(user.id) }">
        <div class="resource-timeline__user">
          <div class="resource-timeline__user-avatar">
            <img v-if="user.photo_url" :src="user.photo_url" :alt="user.first_name" @error="($event.target as HTMLImageElement).style.display='none'" />
            <span v-else>{{ user.first_name[0] }}{{ user.last_name[0] }}</span>
          </div>
          <div class="resource-timeline__user-info">
            <div class="resource-timeline__user-name">{{ user.first_name }} {{ user.last_name }}</div>
            <div class="resource-timeline__user-hours">{{ userWeeklyHours.get(user.id) || 0 }}ч</div>
          </div>
        </div>

        <div class="resource-timeline__cells">
          <div
            v-for="day in days"
            :key="day.toISOString()"
            :class="['resource-timeline__cell', { 'resource-timeline__cell_readonly': readonly }]"
            @click="!readonly && handleCellClick(user, day)"
          ></div>

          <div class="resource-timeline__allocations">
            <div
              v-for="allocation in allocationsByUser.get(user.id)"
              :key="allocation.id"
              :class="['resource-timeline__allocation', { 'resource-timeline__allocation_readonly': readonly }]"
              :style="getAllocationStyle(allocation, user.id)"
              @click.stop="!readonly && handleAllocationClick(allocation)"
            >
              <div class="resource-timeline__allocation-content">
                <span class="resource-timeline__allocation-project">{{ allocation.project.name }}</span>
                <span v-if="allocation.hours" class="resource-timeline__allocation-hours">{{ allocation.hours }}ч</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.resource-timeline {
  @include flex(cn);
  width: 100%;
  height: 100%;
  background: var(--dark-text-background-primary);
  border-radius: 8px;
  overflow: hidden;

  &__header {
    display: flex;
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--dark-text-background-primary);
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    flex-shrink: 0;
  }

  &__header-corner {
    width: 200px;
    min-width: 200px;
    padding: 12px 16px;
    color: var(--light-text-backgroung-primary-50);
    border-right: 1px solid var(--light-text-backgroung-primary-10);
    @include flex(rn, a-center);
    position: sticky;
    left: 0;
    z-index: 101;
    background: var(--dark-text-background-primary);
    @extend %text-xs-medium;
  }

  &__days {
    display: flex;
    gap: 4px;
    padding: 8px;
  }

  &__day-header {
    width: 120px;
    min-width: 120px;
    text-align: center;
    padding: 4px;
  }

  &__day-name {
    color: var(--light-text-backgroung-primary-50);
    text-transform: uppercase;
    @extend %text-xs-medium;
  }

  &__day-date {
    color: var(--light-text-backgroung-primary);
    margin-top: 2px;
    @extend %text-s-medium;
  }

  &__body {
    @include flex(cn);
    flex: 1;
    overflow-x: auto;
    overflow-y: auto;
    min-height: 0;
  }

  &__row {
    display: flex;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }
  }

  &__user {
    width: 200px;
    min-width: 200px;
    padding: 12px 16px;
    @include flex(rn, a-center);
    gap: 12px;
    border-right: 1px solid var(--light-text-backgroung-primary-10);
    position: sticky;
    left: 0;
    z-index: 10;
    background: var(--dark-text-background-primary);
  }

  &__user-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--primary);
    @include flex(center);
    color: var(--light-text-backgroung-primary);
    overflow: hidden;
    flex-shrink: 0;
    @extend %text-s-medium;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &__user-info {
    @include flex(cn);
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  &__user-name {
    color: var(--light-text-backgroung-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    @extend %text-s-medium;
  }

  &__user-hours {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-medium;
  }

  &__cells {
    position: relative;
    display: flex;
    gap: 4px;
    padding: 8px;
    flex: 1;
  }

  &__cell {
    width: 120px;
    min-width: 120px;
    height: 100%;
    border: 1px dashed var(--light-text-backgroung-primary-10);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
      border-color: var(--primary-50);
    }

    &_readonly {
      cursor: default;

      &:hover {
        background: transparent;
        border-color: var(--light-text-backgroung-primary-10);
      }
    }
  }

  &__allocations {
    position: absolute;
    top: 8px;
    left: 8px;
    right: 8px;
    bottom: 8px;
    pointer-events: none;
  }

  &__allocation {
    position: absolute;
    background: var(--primary-25);
    border: 1px solid var(--primary-50);
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
    pointer-events: all;
    transition: border-color 0.2s;
    @include flex(rn, a-center);
    overflow: hidden;

    &:hover {
      border-color: var(--primary);
      z-index: 10;
    }

    &_readonly {
      cursor: default;

      &:hover {
        border-color: var(--primary-50);
      }
    }
  }

  &__allocation-content {
    @include flex(rn, between, a-center);
    width: 100%;
    gap: 8px;
  }

  &__allocation-project {
    color: var(--light-text-backgroung-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    @extend %text-s-medium;
  }

  &__allocation-hours {
    color: var(--light-text-backgroung-primary-50);
    white-space: nowrap;
    @extend %text-xs-regular;
  }
}
</style>
