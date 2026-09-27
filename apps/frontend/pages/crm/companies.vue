<script setup lang="ts">
import { CrmSection } from '~/enums/crm.enums';
definePageMeta({ middleware: ['auth', 'role'], roles: ['admin'] });
</script>
<template><CrmWorkspace :section="CrmSection.COMPANIES" /></template>
