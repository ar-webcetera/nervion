<template>
  <main>
    <section class="error-page container">
      <div class="error-page__content">
        <div class="error-page__text">Страница не найдена :(</div>
        <NuxtLink :to="{ name: PAGE_NAMES.home }" class="error-page__button">Вернуться на главную</NuxtLink>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { PAGE_NAMES } from '~/constants/pages.constants';
</script>

<style scoped lang="scss">
.error-page {
  &__content {
    margin: 120px 0 140px;
    @include flex(cn, a-center);
    gap: 24px;

    @media (max-width: $screen-mobile-l) {
      gap: 32px;
      margin: 48px auto 120px;
    }
  }

  &__text {
    color: var(--light-text-backgroung-primary);
    text-align: center;
    @extend %display-s-medium;
  }

  &__button {
    @include flex(center);
    border-radius: 8px;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
    padding: 10px 16px;
    width: fit-content;
    white-space: nowrap;
    @extend %text-s-medium;

    &:hover {
      background: var(--primary-hover);
    }

    @media (max-width: $screen-mobile-l) {
      width: 100%;
    }
  }
}
</style>
