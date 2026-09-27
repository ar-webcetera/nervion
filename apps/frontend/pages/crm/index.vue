<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'role'], roles: ['admin'] });
await navigateTo('/crm/deals', { replace: true });
</script>
<template><div /></template>
