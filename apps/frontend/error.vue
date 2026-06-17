<script setup lang="ts">
import type { NuxtError } from 'nuxt/app';
const route = useRoute();
const statusCode = ref(500);

const header = ref('Упс! Произошла ошибка');

const description = ref('Не удалось загрузить контент. Пожалуйста, попробуйте позже');

const buttonText = ref('На главную');

const rawCode = route;

const props = defineProps({
  error: {
    type: Object as PropType<NuxtError>,
    required: true,
  },
});

if (props.error.statusCode === 401) {
  statusCode.value = 401;
  header.value = 'Не можем вас пустить';
  description.value = 'К сожалению, у вас нет доступа к данной странице';
} else if (props.error.statusCode === 403 || Number(rawCode) === 403) {
  statusCode.value = 403;
  header.value = 'Не можем вас пустить';
  description.value = 'К сожалению, у вас нет доступа к данной странице';
} else if (props.error.statusCode === 404) {
  statusCode.value = 404;
  header.value = 'Страница не найдена';
  description.value = 'Возможно, она была удалена или вы перешли по неправильной ссылке';
}
</script>

<template>
  <div class="error__wrapper">
    <div class="error">
      <h1 class="error__header">
        {{ header }}
      </h1>
      <p class="error__description">
        {{ description }}
      </p>
      <NuxtLink to="/">
        <button class="button">
          {{ buttonText }}
        </button>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped lang="scss">
.error {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  max-width: 480px;
  width: 100%;

  &__wrapper {
    width: 100%;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
  }

  &__header {
    font-size: clamp(28px, 6vw, 48px);
    font-weight: 700;
    line-height: 1.2;
    margin: 0;
    color: var(--white-100);
  }

  &__description {
    font-size: 14px;
    line-height: 1.5;
    margin: 0;
    color: var(--light-text-backgroung-primary-50);
  }
}
</style>
