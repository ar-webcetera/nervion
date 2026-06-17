<!--
<BaseDatePicker
  v-model="startDate"
  v-bind="startDateAttrs"
  :format-date="'dd.MM.yyyy'"
  :placeholder="t('Выберите дату начала')"
  :error="Boolean(errors.startDate)"
  :clear-button="true"
  @update:model-value="changeSubscribeStartDate"
/>
-->

<script setup lang="ts">
import ru from 'date-fns/locale/ru';
import VueDatePicker from '@vuepic/vue-datepicker';
import { capitalize, computed, ref } from 'vue';
import { format, addDays } from 'date-fns';
import IconCalendar from '~/components/Icons/IconCalendar.vue';
import IconArrowDown from '~/components/Icons/IconArrowDown.vue';
import DatePickerType from '~/enums/datepicker.enums';

const props = defineProps({
  type: {
    type: String as PropType<DatePickerType>,
    required: false,
    default: null,
  },
  modelValue: {
    type: [Number, Date, null, String, Array] as PropType<number | Date | null | string | Date[]>,
    required: true,
    default: 0,
  },
  range: {
    type: Boolean,
    required: false,
    default: false,
  },
  error: {
    type: Boolean,
    required: false,
    default: false,
  },
  formatDate: {
    type: String,
    required: false,
    default: 'dd MMMM yyyy',
  },
  placeholder: {
    type: String,
    required: false,
    default: 'Выберите дату',
  },
  clearButton: {
    type: Boolean,
    required: false,
    default: false,
  },
  disabled: {
    type: Boolean,
    required: false,
    default: false,
  },
  firstDay: {
    type: Boolean,
    required: false,
    default: false,
  },
  disabledDates: {
    type: Function,
    required: false,
    default: () => {},
  },
  small: {
    type: Boolean,
    required: false,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue']);

const valueDate = computed({
  get() {
    return props.modelValue;
  },
  set(newValue) {
    emit('update:modelValue', newValue);
  },
});

const markers = ref([
  {
    date: addDays(new Date(), 0),
    type: 'dot' as const,
    color: '#FC0D54',
  },
]);

const disabledDates = (date: Date) => {
  if (props.disabledDates) {
    return props.disabledDates(date);
  }
  return false;
};

const toStringMonth = (month: number) => {
  const date = new Date();
  date.setMonth(month);
  return capitalize(format(date, 'LLLL', { locale: ru }));
};

const checkArrowActivity = (month: number, year: number) => {
  const targetDate = new Date(year, month);

  if (props.disabledDates) {
    return !props.disabledDates(targetDate);
  }
  return true;
};
</script>

<template>
  <div class="calendar__wrapper">
    <IconsIconClose v-if="valueDate && type === DatePickerType.filter" @click="valueDate = null" />
    <VueDatePicker
      v-model="valueDate"
      :auto-apply="!range"
      :clearable="clearButton"
      :enable-time-picker="false"
      :range="range"
      :markers="markers"
      :format="formatDate"
      :format-locale="ru"
      month-name-format="long"
      :placeholder="placeholder"
      :class="[
        'calendar',
        {
          calendar_disabled: disabled,
          calendar_error: error,
          'calendar__task-field-type': type === DatePickerType.taskField,
          'calendar__filter-type': type === DatePickerType.filter,
          calendar__small: small,
        },
      ]"
      type="date"
      :disabled-dates="disabledDates"
      :disabled="disabled"
      :action-row="{ showSelect: true, showCancel: true, showNow: false, showPreview: false }"
      select-text="Выбрать"
      cancel-text="Отмена"
      dark
      :hide-input-icon="small"
    >
      <template #month-year="{ month, year, handleMonthYearChange }">
        <div class="calendar__header">
          <div class="calendar__header-date">
            {{ `${toStringMonth(month as number)}, ${year}` }}
          </div>
          <div class="calendar__icons">
            <div
              class="calendar__icons-icon calendar__icons-icon_left"
              :class="{ 'calendar__icons-icon_disabled': !checkArrowActivity(month as number, year) }"
              @click="handleMonthYearChange?.(false)"
            >
              <IconArrowDown />
            </div>
            <div class="calendar__icons-icon calendar__icons-icon_right" @click="handleMonthYearChange?.(true)">
              <IconArrowDown />
            </div>
          </div>
        </div>
      </template>
      <template #input-icon>
        <IconCalendar />
      </template>
    </VueDatePicker>
  </div>
</template>

<style lang="scss" scoped>
:deep(.dp__marker_dot) {
  bottom: 4px;
}

:deep(.dp__input_icon_pad) {
  color: var(--light-text-backgroung-primary);
  flex-grow: 1;
  height: 56px;
  padding: 18px 20px;
  width: 100%;
  border: 1px solid transparent;
  box-sizing: border-box;
  background-color: var(--light-text-backgroung-primary-5);
  border-radius: 12px;
  @extend %p14-medium;

  &::placeholder {
    color: var(--light-text-backgroung-primary-50);
  }
}

:deep(.dp__menu) {
  background-color: var(--dark-text-background-secondary);
  border: none;

  box-shadow:
    0 0 1px 0 var(--black-25),
    0 16px 32px 0 var(--black-10);
}

:deep(.dp__arrow_bottom) {
  display: none;
}

:deep(.dp__arrow_top) {
  display: none;
}

:deep(.dp__calendar_header) {
  padding: 0 16px;
}

:deep(.dp__calendar_header_separator) {
  padding-bottom: 4px;
  box-shadow: 0 4px 8px 0 var(--black-10);
  background: none;
}

:deep(.dp__calendar_header_item) {
  width: 40px;
  height: 40px;
  padding: 8px 11px;
}

:deep(.dp__calendar .dp__calendar) {
  padding: 16px 16px 0;
}

:deep(.dp__input_focus) {
  border: 1px solid var(--light-text-backgroung-primary-5);
}

:deep(.dp__input:hover) {
  border-color: var(--light-text-backgroung-primary-5);
}

:deep(.dp__input_icon) {
  top: 18px;
  right: 20px;
  inset-inline-start: unset;
  transform: unset;
  @include flex();
}

:deep(.dp__calendar_item) {
  padding: 2px;
}

:deep(.dp__today) {
  border: none;
}

:deep(.dp__theme_light) {
  --dp-text-color: var(--dark-text-background-primary);
  --dp-font-family: 'Inter', sans-serif;
  --dp-font-size: 14px;
}

:deep(.dp__action_buttons) {
  padding: 12px 16px;
}

:deep(.dp__action_button) {
  @extend %text-s-medium;
  font-family: 'Inter', sans-serif;
  padding: 8px 16px;
  border-radius: 6px;
  transition: all 0.2s ease;
}

:deep(.dp__action_select) {
  background: var(--primary-50);
  color: var(--light-text-backgroung-primary);

  &:hover {
    background: var(--primary);
  }
}

:deep(.dp__action_cancel) {
  background: var(--light-text-backgroung-primary-10);
  color: var(--light-text-backgroung-primary-50);

  &:hover {
    background: var(--light-text-backgroung-primary-25);
  }
}

.calendar {
  --dp-font-family: 'Inter', sans-serif;

  &__wrapper {
    @include flex(rn, a-center);
  }
  &__task-field-type {
    :deep(.dp__input_icon_pad) {
      border: none;
      background: none;
      color: var(--light-text-backgroung-primary-50);
      padding: 0;
      height: auto;
      @extend %p14-medium;
    }

    :deep(.dp__input_icon) {
      display: none;
    }
  }
  &__filter-type {
    :deep(.dp__input_icon_pad) {
      width: fit-content;
      height: auto;
      padding: 6px 12px;
      border-radius: 8px;
      border: 1px solid var(--light-text-backgroung-primary-5);
      background-color: transparent;
      cursor: pointer;
      transition: all 0.2s ease;
      @extend %p14-medium;
    }
    :deep(.dp__input_icon) {
      top: 50%;
      transform: translateY(-50%);
    }
  }

  &__small {
    :deep(.dp__input) {
      padding: 0;
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary-50);
      width: 75px;
      background: none;
      border: none;

      &::placeholder {
        @extend %text-s-regular;
        color: var(--light-text-backgroung-primary-50);
        opacity: 1;
      }
    }
  }

  &__header {
    @include flex(rn, a-center, between);
    padding: 0 12px;
    width: 100%;
  }

  &__header-date {
    padding: 12px;
  }

  &__icons {
    @include flex();
  }

  &__icons-icon {
    padding: 12px;
    cursor: pointer;

    &_left {
      transform: rotate(90deg);
    }

    &_right {
      transform: rotate(-90deg);
    }

    &_disabled {
      opacity: 0.5;
      pointer-events: none;
    }
  }

  &_disabled {
    :deep(.dp__input_icon_pad) {
      cursor: not-allowed;
    }
  }

  &_error {
    :deep(.dp__input_icon_pad) {
      border: 1px solid var(--secondary);
    }
  }
}

.input-slot-image {
  height: 20px;
  width: auto;
  margin-right: 5px;
}
</style>
