<script setup lang="ts">
import { ref, computed } from 'vue';
import { format } from 'date-fns';
import type { SelectOption } from '~/types/select';
import { FilterType } from '~/types/filter';

interface Props {
  statusOptions: SelectOption[];
  projectOptions: SelectOption[];
  userOptions: SelectOption[];
  taskTypeOptions: SelectOption[];
  selectedFilters?: Array<{ type: FilterType; value: string | number | string[] }>;
}

const props = defineProps<Props>();
const emit = defineEmits(['close', 'add-filter']);

const dropdownRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);

const open = () => {
  isOpen.value = true;
};

const close = () => {
  isOpen.value = false;
  selectedType.value = null;
  selectedValue.value = null;
  selectedDate.value = null;
  emit('close');
};

defineExpose({
  open,
  close,
});

const selectedType = ref<FilterType | null>(null);
const selectedValue = ref<string | number | null>(null);
const selectedDate = ref<Date[] | string | null>(null);
const valuesTop = ref(0);

const filterTypes = [
  { type: FilterType.STATUS, label: 'Статус' },
  { type: FilterType.PROJECT, label: 'Проект' },
  { type: FilterType.RESPONSIBLE, label: 'Ответственный' },
  { type: FilterType.TASK_TYPE, label: 'Тип' },
  { type: FilterType.DATE, label: 'Дата дедлайна' },
  { type: FilterType.CLOSED_DATE, label: 'Дата закрытия' },
];

const currentOptions = computed(() => {
  if (!selectedType.value) return [];

  let options: SelectOption[] = [];

  switch (selectedType.value) {
    case FilterType.STATUS:
      options = props.statusOptions;
      break;
    case FilterType.PROJECT:
      options = props.projectOptions;
      break;
    case FilterType.RESPONSIBLE:
      options = props.userOptions;
      break;
    case FilterType.TASK_TYPE:
      options = props.taskTypeOptions;
      break;
    default:
      return [];
  }

  if (props.selectedFilters && props.selectedFilters.length > 0) {
    const selectedValues = props.selectedFilters.filter((f) => f.type === selectedType.value).map((f) => f.value);

    return options.filter((opt) => opt.value !== null && !selectedValues.includes(opt.value));
  }

  return options;
});

const selectType = (type: FilterType, event?: MouseEvent) => {
  selectedType.value = type;
  selectedValue.value = null;
  selectedDate.value = '';

  if (event?.currentTarget && dropdownRef.value) {
    const targetRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const dropdownRect = dropdownRef.value.getBoundingClientRect();
    valuesTop.value = targetRect.top - dropdownRect.top - 6;
  }
};

const selectValue = (value: string | number) => {
  if (!selectedType.value) return;

  emit('add-filter', {
    type: selectedType.value,
    value,
    isNegative: false,
  });

  close();
};

const selectDate = (isNegative: boolean = false) => {
  if (!selectedType.value) return;

  let formattedDates: string[] = [];
  if (Array.isArray(selectedDate.value)) {
    formattedDates = (selectedDate.value as (Date | null)[])
      .filter((d): d is Date => d != null)
      .map((d) => format(d, 'yyyy-MM-dd'));
  } else {
    formattedDates = [format(new Date(selectedDate.value as any), 'yyyy-MM-dd')];
  }

  emit('add-filter', {
    type: selectedType.value,
    value: formattedDates,
    isNegative,
  });

  close();
};

const handleDateChange = (value: Date[] | string | null) => {
  // В range-режиме это событие срабатывает при нажатии "Select"
  if (value && Array.isArray(value) && value.length >= 1) {
    selectDate(false);
  }
};
</script>

<template>
  <div v-if="isOpen" ref="dropdownRef" class="add-filter-dropdown">
    <div class="add-filter-dropdown__types">
      <div class="add-filter-dropdown__list">
        <button
          v-for="filterType in filterTypes"
          :key="filterType.type"
          class="add-filter-dropdown__item"
          :class="{ 'add-filter-dropdown__item_active': selectedType === filterType.type }"
          @mouseenter="selectType(filterType.type, $event)"
        >
          <span class="add-filter-dropdown__item-label">{{ filterType.label }}</span>
          <IconsIconArrowRightSmall />
        </button>
      </div>

      <div v-if="selectedType" class="add-filter-dropdown__values" :style="{ top: `${valuesTop}px` }">
        <div v-if="selectedType === FilterType.DATE || selectedType === FilterType.CLOSED_DATE" class="add-filter-dropdown__date">
          <BaseDatePicker
            v-model="selectedDate"
            :range="true"
            format-date="dd.MM.yyyy"
            placeholder="Выберите дату"
            @update:model-value="handleDateChange"
          />
        </div>

        <div v-else class="add-filter-dropdown__list">
          <button
            v-for="option in currentOptions"
            :key="String(option.value)"
            class="add-filter-dropdown__value"
            @click.stop="option.value !== null && selectValue(option.value as string | number)"
          >
            <span>{{ option.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.add-filter-dropdown {
  position: relative;
  z-index: 1000;

  &__types {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 163px;
    border-radius: 8px;
  }

  &__values {
    position: absolute;
    left: calc(100% + 2px);
    width: fit-content;
    z-index: 1001;
  }

  &__list {
    overflow-y: auto;

    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--dark-text-background-primary-50);
    backdrop-filter: blur(12px);
    border-radius: 8px;
  }

  &__item {
    width: 100%;
    @include flex(a-center);
    gap: 12px;
    padding: 6px 8px;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.2s;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
    text-align: left;
    border-radius: 0;

    &:hover,
    &_active {
      background: var(--light-text-backgroung-primary-5);
    }

    &:not(:last-child) {
      border-bottom: 1px solid var(--light-text-backgroung-primary-5);
    }
  }

  &__item-icon {
    font-size: 18px;
  }

  &__item-label {
    flex: 1;
    text-align: left;
    @extend %text-s-regular;
  }

  &__value {
    border-radius: 0;
    width: 100%;
    @include flex(a-center);
    padding: 6px 8px;
    background: transparent;
    backdrop-filter: blur(12px);
    border: none;
    cursor: pointer;
    transition: background 0.2s;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
    text-align: left;
    justify-content: start;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    &:not(:last-child) {
      border-bottom: 1px solid var(--light-text-backgroung-primary-5);
    }
  }

  &__date {
    padding: 16px;
    @include flex(cn);
    gap: 12px;

    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--dark-text-background-primary-50);
    backdrop-filter: blur(12px);
    border-radius: 8px;
    min-width: 250px;
  }

  &__actions {
    @include flex(r);
    gap: 8px;
  }

  &__action {
    flex: 1;
    @include flex(center);
    gap: 6px;
    padding: 8px 12px;
    background: var(--primary-50);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.2s;
    color: var(--light-text-backgroung-primary);
    @extend %text-xs-medium;

    &:hover:not(:disabled) {
      background: var(--primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    svg {
      width: 16px;
      height: 16px;
    }
  }
}
</style>
