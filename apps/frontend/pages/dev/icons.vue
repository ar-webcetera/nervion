<script setup>
import { ref, computed } from 'vue';

const { $toast } = useNuxtApp();

const modules = import.meta.glob('~/components/Icons/*.vue', { eager: true });

const icons = Object.entries(modules).map(([path, mod]) => {
  const name = path.split('/').pop().replace('.vue', '');

  return {
    name,
    component: mod.default,
  };
});

const search = ref('');
const filteredIcons = computed(() => {
  if (!search.value) return icons;
  return icons.filter((icon) => icon.name.toLowerCase().includes(search.value.toLowerCase()));
});

const copyToClipboard = (name) => {
  const code = `<Icons${name} />`;

  navigator.clipboard.writeText(code);

  $toast(`Скопировано: ${code}`);
};
definePageMeta({
  layout: 'empty-layout',
  middleware: 'auth',
});
</script>

<template>
  <div class="main__content">
    <div class="gallery-container">
      <header class="header">
        <h1>Библиотека иконок ({{ icons.length }})</h1>
        <p>Нажмите на иконку, чтобы скопировать код</p>

        <input v-model="search" placeholder="Поиск иконки..." class="search-input" />
      </header>

      <div class="grid">
        <div v-for="icon in filteredIcons" :key="icon.name" class="card" @click="copyToClipboard(icon.name)">
          <component :is="icon.component" class="icon-preview" />

          <div class="meta">
            <span class="name">{{ icon.name }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gallery-container {
  padding: 40px;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  min-height: 100vh;
}

.header {
  margin-bottom: 30px;
  text-align: center;
}

.search-input {
  margin-top: 15px;
  padding: 10px 15px;
  width: 100%;
  max-width: 400px;
  border: 1px solid var(--light-text-backgroung-primary-10);
  border-radius: 8px;
  font-size: 16px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 16px;
}

.card {
  background: var(--dark-text-background-primary-5);
  border: 1px solid var(--dark-text-background-primary-5);
  border-radius: 12px;
  padding: 24px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px var(--black-10);
  border-color: var(--primary);
}

.icon-preview {
  font-size: 32px;
  width: 32px;
  height: 32px;
  margin-bottom: 16px;
  color: var(--light-text-backgroung-primary);
}

.meta {
  text-align: center;
}

.name {
  display: block;
  font-size: 12px;
  color: var(--light-text-backgroung-primary-50);
  word-break: break-all;
  font-family: monospace;
}
</style>
