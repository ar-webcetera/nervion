<script setup lang="ts">
const wikiStore = useWikiStore();

onUnmounted(() => {
  wikiStore.reset();
});
</script>

<template>
  <div class="wiki-layout">
    <WikiSidebar />
    <div class="wiki-layout__content">
      <NuxtPage />
    </div>
  </div>
</template>

<style scoped lang="scss">
.wiki-layout {
  height: 100%;
  width: 100%;
  @include flex(rn);
  gap: 4px;
  overflow: hidden;

  &__content {
    width: 100%;
    height: 100dvh;
    @include flex(cn);
    overflow: auto;
    gap: 4px;
    padding: 16px;
  }
}
</style>
