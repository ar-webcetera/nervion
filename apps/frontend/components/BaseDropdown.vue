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
import { ref, computed } from 'vue';
import type { SelectOption } from '~/types/select';

const props = withDefaults(
  defineProps<{
    pending?: boolean;
    resetButton?: boolean;
    error?: boolean;
    options: SelectOption[];
    modelValue: string | number | string[] | number[] | null;
    placeholder?: string | null;
    disabled?: boolean;
    multiselect?: boolean;
  }>(),
  {
    disabled: false,
    resetButton: false,
    multiselect: false,
    placeholder: null,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number | (string | number)[] | null): void;
  (e: 'reset'): void;
}>();

const isOpen = ref(false);
const selectedValues = computed(() =>
  Array.isArray(props.modelValue) ? props.modelValue : props.modelValue ? [props.modelValue] : [],
);

const tempValue = ref<string | number | null>(null);

const selectedLabel = computed(() => {
  const selectedOption = props.options.find((option) => option.value === selectedValues.value[0]);
  return selectedOption ? selectedOption.label : props.placeholder;
});

const selectedColor = computed(() => {
  const selectedOption = props.options.find((option) => option.value === selectedValues.value[0]);
  return selectedOption ? selectedOption.color : 'FFFFFF80';
});

const toggleDropdown = () => {
  if (!props.disabled) {
    isOpen.value = !isOpen.value;
  }
};
defineExpose({
  toggleDropdown,
});
const closeDropdown = () => {
  isOpen.value = false;
};

const selectOption = (option: SelectOption) => {
  tempValue.value = option.value;

  if (props.multiselect && tempValue.value) {
    const set = new Set(selectedValues.value);
    set.has(tempValue.value) ? set.delete(tempValue.value) : set.add(tempValue.value);
    emit('update:modelValue', Array.from(set));
  }

  if (!props.multiselect) {
    emit('update:modelValue', option.value);
    isOpen.value = false;
  }
};
</script>

<template>
  <div class="base-dropdown" :class="{ 'base-dropdown_disabled': disabled }">
    <div v-if="pending" class="base-dropdown__input base-dropdown_disabled">
      <span class="base-dropdown__placeholder">
        {{ props.placeholder }}
      </span>
      <div class="loader"></div>
    </div>
    <div v-else class="base-dropdown__input" :class="{ 'base-dropdown__input_error': error }" @click.stop="toggleDropdown">
      <span
        :class="['base-dropdown__placeholder', { 'base-dropdown__placeholder_show': !selectedLabel }]"
        :style="{ color: selectedColor }"
      >
        {{ selectedLabel }}
      </span>
    </div>
    <div v-if="isOpen" v-click-outside="closeDropdown" class="base-dropdown__dropdown">
      <span
        v-for="(option, index) in options"
        :key="option.value ?? index"
        :class="{ selected: selectedValues.includes(option.value!) }"
        :style="{ color: option.color || 'FFFFFF80' }"
        @click.stop="selectOption(option)"
      >
        {{ option.label }}
      </span>
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
.base-dropdown {
  position: relative;
  color: var(--light-text-backgroung-primary-50);
  @extend %text-xs-regular;

  &_disabled {
    opacity: 0.5;
    cursor: default;
  }

  &__input {
    @include flex(rn, a-center);
    width: fit-content;
    gap: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
    user-select: none;
    &:hover {
      color: var(--light-text-backgroung-primary);
    }
    &_error {
      border: 1px solid var(--secondary);
    }
  }

  &__placeholder {
    white-space: nowrap;
    &_show {
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__arrow {
    @include flex();
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
    top: 28px;
    left: 0;
    @include flex(cn, a-start);
    border-radius: 8px;
    z-index: 100;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--dark-text-background-primary-50);
    backdrop-filter: blur(12px);
    max-height: 600px;
    overflow: auto;

    span {
      @include flex(rn, a-center);
      padding: 6px 8px;
      width: 100%;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
      @extend %text-s-regular;

      &:hover {
        background: var(--light-text-backgroung-primary-5);
      }

      &.selected {
        background: var(--light-text-backgroung-primary-5);
      }
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
