<script setup lang="ts">
import type { MailDeliveryStatus } from '@tracker/contracts';
import { resolveMailDeliveryLabel } from '~/composables/useMailDeliveryLabel';

const props = defineProps<{
  status?: 'received' | 'sent' | 'failed' | 'draft' | null;
  deliveryStatus?: MailDeliveryStatus | null;
  openCount?: number | null;
  clickCount?: number | null;
  compact?: boolean;
}>();

const label = computed(() =>
  resolveMailDeliveryLabel({
    status: props.status,
    delivery_status: props.deliveryStatus,
    open_count: props.openCount,
    click_count: props.clickCount,
  }),
);
</script>

<template>
  <span
    v-if="label"
    :class="[
      'mail-delivery-badge',
      `mail-delivery-badge_tone-${label.tone}`,
      { 'mail-delivery-badge_compact': compact },
    ]"
    :title="label.title"
  >
    {{ label.text }}
  </span>
</template>

<style scoped lang="scss">
.mail-delivery-badge {
  @include flex(rn, a-center);
  flex: 0 0 auto;
  max-width: 100%;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
  @extend %text-xs-medium;

  &_compact {
    padding: 1px 6px;
  }

  &_tone-neutral {
    color: var(--light-text-backgroung-primary-50);
    background: var(--light-text-backgroung-primary-5);
  }

  &_tone-ok {
    color: var(--green);
    background: var(--green-10);
  }

  &_tone-accent {
    color: var(--primary-75);
    background: var(--primary-10);
  }

  &_tone-warn {
    color: var(--status-in-progress);
    background: var(--status-in-progress-15);
  }

  &_tone-danger {
    color: var(--danger-delete);
    background: var(--danger-delete-25);
  }
}
</style>
