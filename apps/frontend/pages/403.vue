<script setup lang="ts">
import { PAGE_NAMES } from '~/constants/pages.constants';
</script>

<template>
  <div class="error__wrapper">
    <div class="error">
      <h1 class="error__header">Не можем вас пустить</h1>
      <p class="error__description">К сожалению, у вас нет доступа к данной странице</p>
      <NuxtLink :to="{ name: PAGE_NAMES.home }">
        <button class="button">На главную</button>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped lang="scss">
.error {
  display: flex;
  flex-direction: column;
  gap: 24px;
  align-items: center;
  justify-content: center;
  &__wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
</style>
