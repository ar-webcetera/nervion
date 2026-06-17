<script setup lang="ts">
import type { PropType } from 'vue';
import { Form, Field, ErrorMessage } from 'vee-validate';
import type { User } from '~/types/user';
import { roleNames, ROLES } from '~/types/user';
import { getErrorMessage } from '~/utils/error';
const { $toast } = useNuxtApp();
const userStore = useUserStore();
const pending = ref(false);
const emit = defineEmits(['close']);

enum TypeModal {
  EDIT = 'edit',
  ADD = 'add',
}

const props = defineProps({
  type: {
    type: String as PropType<'edit' | 'add'>,
    required: true,
  },
  user: {
    type: Object as PropType<User | null>,
    required: false,
    default: null,
  },
  profileEdit: {
    type: Boolean,
    required: false,
    default: false,
  },
});

type UserForm = Partial<User> & { password?: string };

const userData = ref<UserForm>({
  first_name: '',
  last_name: '',
  patronymic: '',
  email: '',
  role: ROLES.employee,
  password: '',
});

if (props.user) {
  userData.value = { ...props.user };
}

const roles = Object.values(ROLES).map((role) => ({
  value: role,
  label: roleNames[role],
}));

const onSubmit = async (values: UserForm) => {
  try {
    pending.value = true;
    if (props.type === TypeModal.EDIT) {
      if (!props.user?.id) return;
      if (props) {
        await userStore.updateUser(values as User, props.user.id);
        await userStore.fetchMe();
      }
    } else {
      await userStore.createUser(values as User);
    }
    if (props.profileEdit) {
      $toast.user('Данные профиля успешно изменены');
    } else {
      $toast.success(props.type === TypeModal.EDIT ? 'Пользователь успешно обновлен' : 'Пользователь успешно добавлен');
    }
    emit('close');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    pending.value = false;
  }
};
</script>

<template>
  <div class="user-edit-modal">
    <header class="user-edit-modal__header">
      <div class="user-edit-modal__title-group">
        <div class="user-edit-modal__icon-wrapper">
          <IconsIconUser />
        </div>
        <div>
          <h2 v-if="profileEdit" class="user-edit-modal__title">Настройка профиля</h2>
          <h2 v-else class="user-edit-modal__title">
            {{ props.type === TypeModal.EDIT ? 'Редактирование' : 'Добавление' }} пользователя
          </h2>
          <p class="user-edit-modal__subtitle">Заполните данные</p>
        </div>
      </div>
    </header>

    <Form id="user-edit-form" class="user-edit-modal__form" :initial-values="{ role: userData.role }" @submit="onSubmit">
      <div v-if="pending" class="loader"></div>
      <div class="form-group">
        <label for="lastName">Фамилия</label>
        <Field
          id="lastName"
          v-model="userData.last_name"
          :disabled="pending"
          name="last_name"
          type="text"
          rules="required|min:3"
          placeholder="Введите фамилию"
        />
        <ErrorMessage name="last_name" class="form-group__error" />
      </div>
      <div class="form-group">
        <label for="firstName">Имя</label>
        <Field
          id="firstName"
          v-model="userData.first_name"
          :disabled="pending"
          name="first_name"
          type="text"
          rules="required|min:3"
          placeholder="Введите имя"
        />
        <ErrorMessage name="first_name" class="form-group__error" />
      </div>
      <div class="form-group">
        <label for="middleName">Отчество</label>
        <Field
          id="middleName"
          v-model="userData.patronymic"
          :disabled="pending"
          name="patronymic"
          type="text"
          rules="min:3"
          placeholder="Введите отчество"
        />
        <ErrorMessage name="patronymic" class="form-group__error" />
      </div>
      <div v-if="!profileEdit" class="form-group">
        <label for="role">Роль</label>
        <Field id="role" v-slot="{ field }" :disabled="pending" name="role" rules="required">
          <BaseSelect
            :options="roles"
            :model-value="field.value"
            placeholder="Выберите роль"
            arrow
            large
            @update:model-value="field.onChange"
          />
        </Field>
        <ErrorMessage name="role" class="form-group__error" />
      </div>
      <div class="form-group">
        <label for="email">E-mail</label>
        <Field
          id="email"
          v-model="userData.email"
          :disabled="pending"
          name="email"
          type="email"
          rules="required|email"
          placeholder="Введите e-mail"
        />
        <ErrorMessage name="email" class="form-group__error" />
      </div>
      <div v-if="type === TypeModal.ADD" class="form-group">
        <label for="password">Пароль</label>
        <Field
          id="password"
          v-model="userData.password"
          :disabled="pending"
          name="password"
          type="password"
          rules="required|min:6"
        />
        <ErrorMessage name="password" class="form-group__error" />
      </div>
    </Form>

    <footer class="user-edit-modal__footer">
      <button :disabled="pending" class="button_secondary" @click="emit('close')">Отменить</button>
      <button :disabled="pending" type="submit" form="user-edit-form">
        {{ type === TypeModal.EDIT ? 'Сохранить' : 'Добавить' }}
      </button>
    </footer>
  </div>
</template>

<style scoped lang="scss">
h1,
h2 {
  margin: 0;
}
.user-edit-modal {
  background-color: var(--dark-text-background-primary);
  border-radius: 12px;
  padding: 0 24px;
  width: 100%;
  max-width: 480px;
  position: relative;

  .loader {
    position: absolute;
    top: 50%;
    left: 50%;
    margin-left: -24px;
    margin-top: -24px;
  }

  &__header {
    @include flex(a-start, between);
    margin-bottom: 30px;
  }

  &__title-group {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__icon-wrapper {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    background-color: var(--light-text-backgroung-primary-5);
    @include flex(center);

    svg {
      stroke: var(--light-text-backgroung-primary-50);
    }
  }

  &__title {
    @extend %text-l-bold;
    color: var(--light-text-backgroung-primary);
  }

  &__subtitle {
    margin-top: 4px;
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__form {
    @include flex(cn);
    gap: 16px;
    margin-bottom: 30px;
  }

  &__footer {
    @include flex(rn, j-end);
    gap: 12px;

    button {
      padding: 10px 32px;
    }
  }
}

.form-group {
  @include flex(cn);
  gap: 12px;

  label {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &:deep(.home-select__placeholder) {
    color: var(--light-text-backgroung-primary);
  }

  input,
  select {
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: unset;
    border-radius: 8px;
    padding: 12px;
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);

    &:focus {
      outline: none;
      border-color: var(--primary-50);
    }
  }

  select {
    appearance: none;
    color: var(--light-text-backgroung-primary);
    background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8"><path fill="%23FFFFFF" d="M1 1l5 5 5-5"/></svg>');
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 36px;

    option {
      background-color: var(--dark-text-background-primary-5);
      color: var(--light-text-backgroung-primary);
    }

    option:checked {
      background-color: var(--primary);
      color: var(--light-text-backgroung-primary);
    }
  }

  &__error {
    @extend %text-xs-regular;
    color: var(--danger-delete);
  }
}
</style>
