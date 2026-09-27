<!--
const selectedOption = ref<string | number | null>(null);

const selectOptions = [
  { value: 1, label: 'Опция 1' },
  { value: 2, label: 'Опция 2' },
  { value: 3, label: 'Опция 3' },
];

<BaseSelect
  :options="selectOptions"
  v-model="selectedOption"
  placeholder="Выберите..."
/>
-->

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { Plus } from '@lucide/vue';
import IconArrowDown from '~/components/Icons/IconArrowDown.vue';
import type { SelectOption } from '~/types/select';

const props = withDefaults(
  defineProps<{
    pending?: boolean;
    resetButton?: boolean;
    error?: boolean;
    options: SelectOption[];
    modelValue: string | number | string[] | number[] | null;
    placeholder: string | null;
    disabled?: boolean;
    multiselect?: boolean;
    large?: boolean;
    small?: boolean;
    arrow?: boolean;
    searchable?: boolean;
    searchPlaceholder?: string;
    actionLabel?: string;
  }>(),
  {
    disabled: false,
    resetButton: false,
    multiselect: false,
    small: false,
    searchable: false,
    searchPlaceholder: 'Поиск',
    actionLabel: '',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number | (string | number)[] | null): void;
  (e: 'reset' | 'action'): void;
}>();

const isOpen = ref(false);
const search = ref('');
const searchInput = ref<HTMLInputElement>();
const selectedValues = computed(() =>
  Array.isArray(props.modelValue) ? props.modelValue : props.modelValue ? [props.modelValue] : [],
);

const tempValue = ref<string | number | null>(null);

const selectedLabel = computed(() => {
  if (props.multiselect) {
    return selectedValues.value.length ? `${props.placeholder} (${selectedValues.value.length})` : props.placeholder;
  } else {
    const selectedOption = props.options.find((option) => option.value === selectedValues.value[0]);
    return selectedOption ? selectedOption.label : props.placeholder;
  }
});

const isFilledOption = computed(() => {
  return Array.isArray(props.modelValue) ? props.modelValue.length : Boolean(props.modelValue);
});

const filteredOptions = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  if (!query) return props.options;
  return props.options.filter((option) => String(option.label ?? '').toLocaleLowerCase().includes(query));
});

const toggleDropdown = async () => {
  if (!props.options.length && !props.actionLabel) return;
  if (!props.disabled) {
    isOpen.value = !isOpen.value;
    search.value = '';
    if (isOpen.value && props.searchable) {
      await nextTick();
      searchInput.value?.focus();
    }
  }
};

const closeDropdown = () => {
  isOpen.value = false;
  search.value = '';
};

const handleClickOutside = () => {
  if (isOpen.value) {
    closeDropdown();
  }
};

const selectOption = (option: SelectOption) => {
  tempValue.value = option.value;

  if (props.multiselect && tempValue.value) {
    const set = new Set(selectedValues.value);
    if (set.has(tempValue.value)) {
      set.delete(tempValue.value);
    } else {
      set.add(tempValue.value);
    }
    emit('update:modelValue', Array.from(set));
  }

  if (!props.multiselect) {
    emit('update:modelValue', option.value);
    closeDropdown();
  }
};

const triggerAction = () => {
  closeDropdown();
  emit('action');
};
</script>

<template>
  <div v-click-outside="handleClickOutside" class="home-select" :class="{ 'home-select_disabled': disabled }">
    <div v-if="pending" class="home-select__input home-select_disabled">
      <span class="home-select__placeholder">
        {{ props.placeholder }}
      </span>
      <div class="loader"></div>
    </div>
    <div
      v-else
      class="home-select__input"
      :class="{ 'home-select__input_error': error, 'home-select__input_large': large, 'home-select__input_small': small }"
      role="combobox"
      :aria-expanded="isOpen"
      :aria-disabled="disabled"
      :tabindex="disabled ? -1 : 0"
      @click.stop="toggleDropdown"
      @keydown.enter.prevent="toggleDropdown"
      @keydown.space.prevent="toggleDropdown"
      @keydown.escape.stop="closeDropdown"
    >
      <span :class="['home-select__placeholder', { 'home-select__placeholder_show': !selectedLabel }]">
        {{ selectedLabel || props.placeholder }}
      </span>
      <div v-if="props.resetButton && isFilledOption" class="home-select__reset" @click.stop="emit('reset')">
        <IconsIconClose />
      </div>
      <div
        v-if="(props.options.length || props.actionLabel) && arrow"
        :class="['home-select__arrow', { 'home-select__arrow_small': small || large, 'home-select__arrow_flip': isOpen }]"
      >
        <IconArrowDown />
      </div>
    </div>
    <div
      v-if="isOpen"
      v-click-outside="closeDropdown"
      :class="['home-select__dropdown', { 'home-select__dropdown_large': large, 'home-select__dropdown_small': small }]"
    >
      <input
        v-if="searchable"
        ref="searchInput"
        v-model="search"
        class="home-select__search"
        type="search"
        :placeholder="searchPlaceholder"
        aria-label="Поиск по вариантам"
        @click.stop
        @keydown.stop
        @keydown.escape.stop="closeDropdown"
      />
      <span
        v-for="(option, index) in filteredOptions"
        :key="option.value ?? index"
        :class="{ selected: selectedValues.includes(option.value!) }"
        @click.stop="selectOption(option)"
      >
        {{ option.label }}
      </span>
      <p v-if="!filteredOptions.length" class="home-select__empty">Ничего не найдено</p>
      <button v-if="actionLabel" type="button" class="home-select__action" @click.stop="triggerAction">
        <Plus :size="16" :stroke-width="1.75" aria-hidden="true" />
        {{ actionLabel }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.loader {
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
.home-select {
  position: relative;
  @extend %text-s-regular;
  color: var(--light-text-backgroung-primary-50);

  &_disabled {
    opacity: 0.5;
    cursor: default;
  }

  &__input {
    @include flex(rn, a-center);
    width: fit-content;
    gap: 8px;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s ease;
    user-select: none;

    &_error {
      border: 1px solid var(--secondary);
    }

    &_large {
      width: 100%;
      justify-content: flex-start;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid var(--light-text-backgroung-primary-10);
    }

    &_small {
      padding: 0;
      border: none;
    }
  }

  &__placeholder {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    &_show {
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__arrow {
    @include flex();
    transition: transform 0.2s ease;

    &_small {
      svg {
        fill: var(--light-text-backgroung-primary-50);
      }
    }

    &_flip {
      transform: rotateX(180deg);
    }
  }

  &__reset {
    @include flex(a-center);
    width: 18px;
    height: 18px;
    svg {
      fill: var(--light-text-backgroung-primary);
    }
  }

  &__dropdown {
    position: absolute;
    top: 36px;
    left: 0;
    @include flex(cn, a-start);
    border-radius: 8px;
    background-color: var(--dark-text-background-primary-50);
    z-index: 1000;
    border: 1px solid var(--light-text-backgroung-primary-5);
    backdrop-filter: blur(12px);
    max-height: 600px;
    overflow: auto;

    .home-select__search {
      position: sticky;
      top: 0;
      z-index: 1;
      width: calc(100% - 16px);
      min-height: 36px;
      margin: 8px;
      padding: 8px 10px;
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 8px;
      background: var(--dark-text-background-primary);
      color: var(--light-text-backgroung-primary);
      text-align: left;
      @extend %text-s-regular;

      &:focus-visible {
        border-color: var(--primary);
        outline: none;
      }
    }

    span {
      @include flex(rn, a-center);
      width: 100%;
      cursor: pointer;
      padding: 6px 8px;
      text-align: left;
      transition: all 0.2s ease;
      white-space: nowrap;

      &:hover {
        background: var(--light-text-backgroung-primary-5);
      }

      &.selected {
        background: var(--light-text-backgroung-primary-5);
      }
    }

    &_large {
      width: 100%;
      top: calc(100% + 4px);
      border: 1px solid var(--light-text-backgroung-primary-10);
      background: var(--light-text-backgroung-primary-5);

      span {
        &.selected {
          background: var(--primary-25);
          color: var(--primary);
        }
      }
    }

    &_small {
      left: unset;
      right: 0;
    }
  }

  &__empty {
    width: 100%;
    margin: 0;
    padding: 10px 12px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__action {
    position: sticky;
    bottom: 0;
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border: none;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 0;
    background: var(--dark-text-background-primary);
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    justify-content: flex-start;
    @include flex(rn, a-center);
    gap: 8px;
    @extend %text-s-medium;
    transition: background-color 0.16s ease;

    svg {
      flex: 0 0 16px;
      color: var(--primary);
    }

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }

    &:focus-visible {
      outline: 2px solid var(--primary-50);
      outline-offset: -2px;
    }
  }
}

.warning-modal {
  @include flex(cn, center);
  gap: 24px;

  &__header {
    padding: 0 24px;
    @extend %p16-bold;
    width: 100%;
  }

  &__body {
    @include flex(cn);
    gap: 24px;
    padding: 24px 24px 0;
    width: 100%;
    border-top: 1px solid var(--light-text-backgroung-primary-5);
  }

  &__text {
  }

  &__button {
    padding: 18px 40px;
    @include flex(center);
    border-radius: 1000px;
    background: var(--primary-100);
    @extend %p14-bold;
    color: var(--light-text-backgroung-primary);
    width: 100%;
    cursor: pointer;
  }
}
</style>
