<script setup lang="ts">
import { ErrorMessage, Field, Form } from 'vee-validate';
import IconError from '~/components/Icons/IconError.vue';
import { useAuthStore } from '~/stores/authStore';
import IconLogo from '~/components/Icons/IconLogo.vue';

const { $toast } = useNuxtApp();
const config = useRuntimeConfig();
const route = useRoute();
const pending = ref(false);
const authError = ref('');

const authStore = useAuthStore();

const yandexLoginUrl = computed(() => `${config.public.API_URL}/api/auth/yandex`);

onMounted(() => {
  const oauthError = typeof route.query.oauth_error === 'string' ? route.query.oauth_error : '';
  if (oauthError) {
    authError.value = oauthError;
    $toast.error(oauthError);
  }
});

const submitAuth = async (values: Record<string, string>) => {
  try {
    pending.value = true;
    authError.value = '';
    await authStore.loginByEmail(values);
    location.href = '/';
  } catch (e) {
    authError.value = getErrorMessage(e) || 'Не удалось войти. Проверьте логин и пароль.';
    $toast.error(authError.value);
    pending.value = false;
  }
};

definePageMeta({
  middleware: 'auth',
  layout: 'empty-layout',
  name: 'login',
});
</script>

<template>
  <div class="login__container">
    <div class="login">
      <div class="login__header">
        <div class="login__icon">
          <IconLogo />
        </div>
        <div class="login__text">Авторизуйтесь <span>Чтобы начать использовать трекер</span></div>
      </div>

      <Form class="login__form" @submit="submitAuth">
        <a class="login__yandex" :href="yandexLoginUrl">
          <span class="login__yandex-icon" aria-hidden="true">Я</span>
          Войти через Яндекс
        </a>
        <div class="login__divider"><span>или</span></div>
        <div class="login__field">
          <div class="login__label">
            <label for="email">Логин</label>
            <div class="login__error">
              <ErrorMessage v-slot="{ message }" name="email">
                <IconError />
                <span>{{ message }}</span>
              </ErrorMessage>
            </div>
          </div>
          <Field v-slot="{ field, errorMessage }" name="email" rules="required|email|min:7|max:100">
            <input
              :class="['login__input', { login__input_error: errorMessage }]"
              placeholder="Введите E-mail"
              v-bind="field"
              type="text"
              autocomplete="username"
              :disabled="pending"
            />
          </Field>
        </div>
        <div class="login__field">
          <div class="login__label">
            <label for="password">Пароль</label>
            <div class="login__error">
              <ErrorMessage v-slot="{ message }" name="password" class="login__error">
                <IconError />
                <span>{{ message }}</span>
              </ErrorMessage>
            </div>
          </div>
          <Field v-slot="{ field, errorMessage }" name="password" rules="required|min:6">
            <input
              :class="['login__input', { login__input_error: errorMessage }]"
              placeholder="Введите пароль"
              autocomplete="current-password"
              type="password"
              v-bind="field"
              :disabled="pending"
            />
          </Field>
        </div>
        <div v-if="authError" class="login__auth-error">{{ authError }}</div>
        <button :disabled="pending">
          <div v-if="pending" class="loader"></div>
          <span v-else>Войти</span>
        </button>
        <button v-if="false" class="login__forgot">Забыли пароль?</button>
      </Form>
    </div>
  </div>
</template>

<style scoped lang="scss">
.loader {
  margin-left: 10px;
  margin-top: 0;
  width: 20px;
  height: 20px;
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
.login {
  width: 460px;

  @media (max-width: $screen-mobile-l) {
    width: 100%;
  }

  &__container {
    @include flex(cn, center);
    gap: 20px;
    height: 100%;
    width: 100%;
    height: 100dvh;
    padding: 16px;
    min-width: 0;
    flex: 1;
    @include flex(cn);
  }

  &__header {
    @include flex(rn, a-center);
    gap: 20px;
    padding: 24px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-5);
  }

  &__icon {
    width: 56px;
    height: 56px;
    @include flex(center);
    border-radius: 12px;
    background: var(--light-text-backgroung-primary-5);

    svg {
      width: 24px;
      height: 24px;
      fill: var(--light-text-backgroung-primary);
    }
  }

  &__text {
    @extend %p16-bold;
    @include flex(cn);
    gap: 4px;

    span {
      @extend %p14-medium;
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__form {
    width: 100%;
    padding: 24px;
    @include flex(cn);
    gap: 24px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-5);
  }

  &__yandex {
    @include flex(rn, a-center, j-center);
    gap: 10px;
    width: 100%;
    height: 56px;
    border-radius: 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-text-backgroung-primary);
    color: var(--dark-text-background-primary);
    text-decoration: none;
    @extend %text-s-medium;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }
  }

  &__yandex-icon {
    @include flex(center);
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: #fc3f1d;
    color: #fff;
    font-weight: 800;
    font-size: 14px;
    line-height: 1;
  }

  &__divider {
    @include flex(rn, a-center);
    gap: 12px;
    color: var(--light-text-backgroung-primary-50);
    @extend %p12-regular;

    &::before,
    &::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--light-text-backgroung-primary-10);
    }
  }

  &__field {
    @include flex(cn);
    gap: 8px;
  }

  &__label {
    @include flex(rn, between, a-center);

    label {
      @extend %p14-bold;
    }
  }

  &__error {
    @include flex(rn, a-center);
    gap: 4px;

    span {
      @extend %p14-medium;
      color: var(--secondary);
    }
  }

  &__input {
    height: 56px;
    padding: 18px 20px;
    border-radius: 12px;
    background: var(--light-text-backgroung-primary-5);
    transition: all 0.2s ease;
    border: 1px solid transparent;
    @extend %text-m-medium;

    &::placeholder {
      color: var(--light-text-backgroung-primary-50);
    }

    &_error {
      border-color: var(--secondary);
    }
  }

  &__auth-error {
    color: var(--danger-delete);
    text-align: center;
    @extend %text-s-regular;
  }

  &__submit {
    padding: 18px 40px;
    border-radius: 1000px;
    background: var(--primary-100);
    @extend %p14-bold;
  }

  &__forgot {
    @extend %p14-bold;
    color: var(--primary-100);
    cursor: pointer;
    text-align: left;
  }

  &__tg {
    display: flex;
    justify-content: center;
    margin-top: 16px;
    width: 100%;
  }
}
</style>
