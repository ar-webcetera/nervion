<script setup lang="ts">
defineProps<{
  name: 'move' | 'delete' | 'spam-sender' | 'spam-domain' | 'not-spam' | 'restore';
}>();
</script>

<template>
  <svg class="mail-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <template v-if="name === 'move'">
      <path d="M3.5 7.25h6l2 2h9v9.25h-17V7.25Z" />
      <path d="M9.25 13.75h6.5" />
      <path d="m13.25 11.25 2.5 2.5-2.5 2.5" />
    </template>

    <template v-else-if="name === 'delete'">
      <path d="M4.5 7.25h15" />
      <path d="M9 3.75h6l.75 3.5h-7.5L9 3.75Z" />
      <path d="m7 7.25.75 13h8.5l.75-13" />
      <path d="M10 11v5.5M14 11v5.5" />
    </template>

    <template v-else-if="name === 'spam-sender'">
      <path d="M12 3.25 4.75 6.1v5.35c0 4.25 2.9 7.8 7.25 9.3 4.35-1.5 7.25-5.05 7.25-9.3V6.1L12 3.25Z" />
      <path d="M12 7.75v5.5" />
      <path d="M12 16.75h.01" />
    </template>

    <template v-else-if="name === 'spam-domain'">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M4.4 9h15.2M4.4 15h15.2" />
      <path d="M12 3.5c2.1 2.3 3.1 5.15 3.1 8.5S14.1 18.2 12 20.5C9.9 18.2 8.9 15.35 8.9 12S9.9 5.8 12 3.5Z" />
      <path d="m5.85 18.15 12.3-12.3" />
    </template>

    <template v-else-if="name === 'not-spam'">
      <path d="M12 3.25 4.75 6.1v5.35c0 4.25 2.9 7.8 7.25 9.3 4.35-1.5 7.25-5.05 7.25-9.3V6.1L12 3.25Z" />
      <path d="m8.5 12 2.25 2.25 4.75-5" />
    </template>

    <template v-else>
      <path d="M5 8.25V4.5M5 4.5h3.75M5 4.5l3.1 3.1" />
      <path d="M5.25 12a7.25 7.25 0 1 0 2.12-5.13" />
      <path d="M9 12h6M12 9l3 3-3 3" />
    </template>
  </svg>
</template>

<style scoped lang="scss">
.mail-action-icon {
  display: block;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;

  path,
  circle {
    vector-effect: non-scaling-stroke;
  }
}
</style>
