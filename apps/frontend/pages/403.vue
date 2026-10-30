<script setup lang="ts">
definePageMeta({ middleware: 'auth' });
const tenantStore = useTenantStore();
const userStore = useUserStore();
const landingPath = computed(() => tenantStore.getLandingPath(userStore.user?.role));
</script>

<template>
  <div class="error__wrapper">
    <div class="error">
      <h1 class="error__header">Не можем вас пустить</h1>
      <p class="error__description">К сожалению, у вас нет доступа к данной странице</p>
      <NuxtLink v-if="landingPath !== '/403'" :to="landingPath" class="button">
        В доступный раздел
      </NuxtLink>
      <p v-else class="error__description">Обратитесь к администратору пространства.</p>
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
