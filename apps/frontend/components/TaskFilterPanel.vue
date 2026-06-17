<script setup lang="ts">
import { ref } from 'vue';
import type { FilterChip, FilterType } from '~/types/filter';
import type { SelectOption } from '~/types/select';
import AddFilterDropdown from './AddFilterDropdown.vue';
import IconButtonLoader from '~/components/Icons/IconButtonLoader.vue';

interface Props {
  filters?: FilterChip[];
  statusOptions?: SelectOption[];
  projectOptions?: SelectOption[];
  userOptions?: SelectOption[];
  taskTypeOptions?: SelectOption[];
  isExporting?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits(['search', 'add-filter', 'remove-filter', 'toggle-filter-mode', 'export']);

const dropdownRef = ref<InstanceType<typeof AddFilterDropdown> | null>(null);
const searchInput = ref('');

const selectedFilters = computed(() => {
  if (!props.filters) return [];
  return props.filters.map((f) => ({ type: f.type, value: f.value }));
});

const openDropdown = () => {
  if (dropdownRef.value) {
    dropdownRef.value.open();
  }
};

const closeDropdown = () => {
  if (dropdownRef.value) {
    dropdownRef.value.close();
  }
};

const handleAddFilter = (filter: { type: FilterType; value: string | number; isNegative: boolean }) => {
  emit('add-filter', filter);
};

const clearSearch = () => {
  searchInput.value = '';
};

defineExpose({ clearSearch });
</script>

<template>
  <div class="task-filter-panel">
    <div class="task-filter-panel__left">
      <div v-click-outside="closeDropdown" class="task-filter-panel__add-filter-wrapper">
        <button class="task-filter-panel__add-filter-button" @click.stop="openDropdown">
          <IconsIconPlus />
        </button>
        <AddFilterDropdown
          ref="dropdownRef"
          :status-options="statusOptions || []"
          :project-options="projectOptions || []"
          :user-options="userOptions || []"
          :task-type-options="taskTypeOptions || []"
          :selected-filters="selectedFilters"
          @add-filter="handleAddFilter"
        />
      </div>
    </div>
    <div class="task-filter-panel__right">
      <input
        v-model="searchInput"
        type="text"
        placeholder="Поиск по тексту или добавление фильтра"
        @input="$emit('search', $event)"
      />
      <button class="task-filter-panel__search-button">
        <IconsIconSearch />
      </button>
      <button class="task-filter-panel__export-button" title="Экспорт в Excel" :disabled="isExporting" @click="$emit('export')">
        <IconButtonLoader v-if="isExporting" />
        <IconsIconDownload v-else />
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.task-filter-panel {
  display: flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid var(--primary-50);
  justify-content: space-between;
  min-height: 40px;
  width: 760px;

  @media (max-width: $screen-mobile-l) {
    width: 100%;
  }

  &__left {
    display: flex;
    align-items: center;
    overflow: visible;
    min-height: 40px;
    padding-left: 8px;
  }

  &__right {
    display: flex;
    align-items: center;
    flex: 1;
    min-height: 40px;

    input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      padding: 8px 8px 8px 4px;
      color: var(--light-text-backgroung-primary);
      @extend %text-s-regular;

      &::placeholder {
        color: var(--light-text-backgroung-primary-50);
        @extend %text-s-regular;
      }

      &:focus {
        background: var(--primary-5);
      }
    }
  }

  &__search-button {
    background: none;
    border-radius: 0;
    min-height: 40px;
    padding: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
    border-left: 1px solid var(--primary-50);

    &:hover {
      background: var(--primary-10);
    }
  }

  &__add-filter-wrapper {
    position: relative;
  }

  &__add-filter-button {
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: 6px;
    background-color: var(--primary-50);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;

    &:hover {
      background-color: var(--primary);
    }

    svg {
      width: 24px;
      height: 24px;
    }
  }

  &__export-button {
    cursor: pointer;
    border: none;
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: 6px;
    background-color: var(--primary-50);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
    margin-left: 8px;
    margin-right: 12px;

    @media (max-width: $screen-mobile-l) {
      display: none;
    }

    &:hover:not(:disabled) {
      background-color: var(--primary);

      svg {
        stroke-opacity: 1;
      }
    }

    &:disabled {
      opacity: 1;
      cursor: not-allowed;
    }

    svg {
      width: 16px;
      height: 16px;
      fill: var(--primary-100);
    }

    :deep(svg.icon-button-loader) {
      width: 14px;
      height: 14px;
    }
  }

  &__chips {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding: 0;
  }

  &__chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 2px;
    border-radius: 4px;
    background: var(--primary-25);
    height: 24px;
  }

  &__chip-toggle {
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border-radius: 2px;
    transition: background 0.2s;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }

    &_negative {
      svg rect {
        fill: var(--danger-delete-25);
      }
    }

    svg {
      width: 16px;
      height: 16px;
    }
  }

  &__chip-label {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary);
    white-space: nowrap;
  }

  &__chip-remove {
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border-radius: 2px;
    transition: background 0.2s;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }

    svg {
      width: 12px;
      height: 12px;
    }
  }
}
</style>
