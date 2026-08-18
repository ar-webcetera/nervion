<script setup lang="ts">
import { MailDeliveryStatus } from '@tracker/contracts';
import { MAIL_DIRECTIONS, type MailMessage } from '~/types/mail';
import { sanitizeMailHtml } from '~/utils/sanitizeMailHtml';

const props = withDefaults(
  defineProps<{
    message: MailMessage;
    retrying?: boolean;
    linksDisabled?: boolean;
  }>(),
  {
    retrying: false,
    linksDisabled: false,
  },
);

const emit = defineEmits<{
  forward: [message: MailMessage];
  delete: [message: MailMessage];
  retry: [message: MailMessage];
}>();

const config = useRuntimeConfig();
const avatarFailed = ref(false);

const isInbound = computed(() => props.message.direction === MAIL_DIRECTIONS.inbound);
const canRetry = computed(
  () => !isInbound.value && (props.message.status === 'failed' || props.message.delivery_status === MailDeliveryStatus.BOUNCED),
);
const senderInitials = computed(() => {
  const name = props.message.from_name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return parts
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  }
  return props.message.from_address.split('@')[0].slice(0, 2).toUpperCase();
});

const senderLabel = computed(() => {
  if (props.message.from_name) {
    return `${props.message.from_name} <${props.message.from_address}>`;
  }
  return props.message.from_address;
});

const recipientsLabel = computed(() =>
  props.message.to_addresses.map((item) => (item.name ? `${item.name} <${item.address}>` : item.address)).join(', '),
);

const formattedDate = computed(() =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(props.message.createdAt))
    .replace(',', ''),
);

const sanitizedHtml = computed(() =>
  props.message.html_body ? sanitizeMailHtml(props.message.html_body, { disableLinks: props.linksDisabled }) : '',
);
const hasLinks = computed(() => sanitizedHtml.value.includes('<a'));

const attachmentUrl = (attachmentId: number) => `${config.public.API_URL}/api/mailbox/attachments/${attachmentId}`;

const formatSize = (size: number) => {
  if (size < 1024) return `${size} Б`;
  if (size < 1048576) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / 1048576).toFixed(1)} МБ`;
};

const visibleAttachments = computed(() => (props.message.attachments ?? []).filter((item) => !item.is_inline));
</script>

<template>
  <div :class="['mail-message', { 'mail-message_outbound': !isInbound }]">
    <div class="mail-message__header">
      <div class="mail-message__identity">
        <span class="mail-message__avatar">
          <img
            v-if="message.sender_avatar_url && !avatarFailed"
            :src="message.sender_avatar_url"
            class="mail-message__avatar-image"
            alt=""
            @error="avatarFailed = true"
          />
          <template v-else>{{ senderInitials }}</template>
        </span>
        <div class="mail-message__meta">
          <span class="mail-message__sender">{{ senderLabel }}</span>
          <span class="mail-message__recipients">кому: {{ recipientsLabel }}</span>
        </div>
      </div>
      <div class="mail-message__info">
        <MailDeliveryBadge
          v-if="!isInbound"
          :status="message.status"
          :delivery-status="message.delivery_status"
          :open-count="message.open_count"
          :click-count="message.click_count"
        />
        <span class="mail-message__date">{{ formattedDate }}</span>
        <button
          v-if="canRetry"
          class="mail-message__action mail-message__action_retry"
          :disabled="retrying"
          @click="emit('retry', message)"
        >
          {{ retrying ? 'Отправляем…' : 'Отправить ещё раз' }}
        </button>
        <button class="mail-message__action" title="Переслать" @click="emit('forward', message)">Переслать</button>
        <button class="mail-message__action mail-message__action_danger" title="Удалить письмо" @click="emit('delete', message)">
          Удалить
        </button>
      </div>
    </div>

    <p v-if="linksDisabled && hasLinks" class="mail-message__links-notice">
      Ссылки отключены, потому что письмо находится в спаме.
    </p>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-if="message.html_body" class="mail-message__html" v-html="sanitizedHtml" />
    <div v-else class="mail-message__text">{{ message.text_body }}</div>

    <div v-if="visibleAttachments.length" class="mail-message__attachments">
      <a
        v-for="attachment in visibleAttachments"
        :key="attachment.id"
        class="mail-message__attachment"
        :href="attachmentUrl(attachment.id)"
        target="_blank"
        rel="noopener"
      >
        <span class="mail-message__attachment-name">{{ attachment.filename }}</span>
        <span class="mail-message__attachment-size">{{ formatSize(attachment.size) }}</span>
      </a>
    </div>
  </div>
</template>

<style scoped lang="scss">
.mail-message {
  @include flex(cn);
  gap: 8px;
  padding: 16px;
  border-radius: 12px;
  background: var(--light-text-backgroung-primary-5);
  border: 1px solid var(--light-text-backgroung-primary-10);

  &_outbound {
    border-color: var(--primary-25);
    background: var(--primary-10);
  }

  &__header {
    @include flex(rn, between, a-start);
    gap: 12px;

    @media (max-width: $screen-tablet) {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }
  }

  &__meta {
    @include flex(cn);
    gap: 2px;
    min-width: 0;
  }

  &__identity {
    @include flex(rn, a-center);
    gap: 8px;
    min-width: 0;
  }

  &__avatar {
    @include flex(rn, center, center);
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    overflow: hidden;
    border-radius: 50%;
    background: var(--primary-25);
    color: var(--light-text-backgroung-primary);
    @extend %text-xs-medium;
  }

  &__avatar-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &__sender {
    @extend %text-m-medium;
    color: var(--light-text-backgroung-primary);
    overflow-wrap: anywhere;
  }

  &__recipients {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
    overflow-wrap: anywhere;
  }

  &__info {
    @include flex(rn, a-center);
    gap: 8px;
    flex-shrink: 0;

    @media (max-width: $screen-tablet) {
      flex-wrap: wrap;
    }
  }

  &__date {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
    white-space: nowrap;
  }

  &__failed {
    @extend %text-xs-regular;
    color: var(--danger-delete);
  }

  &__action {
    padding: 4px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
    cursor: pointer;
    white-space: nowrap;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }

    &_danger:hover {
      color: var(--danger-delete);
    }

    &_retry {
      color: var(--primary);
    }

    &:disabled {
      cursor: wait;
      opacity: 0.55;
    }
  }

  &__html {
    width: 100%;
    min-width: 0;
    padding: 16px;
    overflow-x: auto;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary);
    color: var(--dark-text-background-primary);
    line-height: 1.5;
    overflow-wrap: anywhere;
    @extend %text-m-regular;

    :deep(*) {
      max-width: 100% !important;
      box-sizing: border-box;
    }

    :deep(div),
    :deep(article),
    :deep(section),
    :deep(header),
    :deep(footer),
    :deep(main),
    :deep(p) {
      min-width: 0 !important;
    }

    :deep(h1) {
      margin: 0 0 16px;
      @extend %display-xs-bold;
    }

    :deep(h2) {
      margin: 0 0 12px;
      @extend %text-xl-bold;
    }

    :deep(h3) {
      margin: 0 0 12px;
      @extend %text-l-bold;
    }

    :deep(h4),
    :deep(h5),
    :deep(h6) {
      margin: 0 0 8px;
      @extend %text-m-bold;
    }

    :deep(p) {
      margin: 0 0 12px;
    }

    :deep(ul),
    :deep(ol) {
      margin: 0 0 12px;
      padding-left: 24px;
      list-style-position: outside;
    }

    :deep(ul) {
      list-style-type: disc;
    }

    :deep(ol) {
      list-style-type: decimal;
    }

    :deep(li + li) {
      margin-top: 4px;
    }

    :deep(img) {
      max-width: 100% !important;
      height: auto !important;
    }

    :deep(table) {
      min-width: 0 !important;
      width: 100% !important;
      max-width: 100% !important;
      border-collapse: collapse;
    }

    :deep(td),
    :deep(th) {
      min-width: 96px !important;
      overflow-wrap: break-word;
      word-break: normal;
    }

    :deep(pre) {
      max-width: 100%;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    :deep(a) {
      color: var(--primary);
      text-decoration: underline;
      text-underline-offset: 2px;
      overflow-wrap: anywhere;
    }

    :deep(a:hover) {
      color: var(--primary-hover);
    }

    :deep(a:focus-visible) {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
      border-radius: 2px;
    }

    :deep(a[data-link-disabled='true']) {
      color: var(--dark-text-background-primary);
      cursor: not-allowed;
      text-decoration-style: dotted;
    }

    @media (max-width: $screen-mobile-l) {
      padding: 12px;
    }
  }

  &__links-notice {
    margin: 0;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--status-in-progress);
    color: var(--dark-text-background-primary);
    @extend %text-xs-medium;
  }

  &__text {
    white-space: pre-wrap;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  &__attachments {
    @include flex(rw);
    gap: 8px;
  }

  &__attachment {
    @include flex(rn, a-center);
    gap: 6px;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-10);
    color: var(--light-text-backgroung-primary);
    @extend %text-xs-regular;
    text-decoration: none;

    &:hover {
      background: var(--light-text-backgroung-primary-25);
    }
  }

  &__attachment-size {
    color: var(--light-text-backgroung-primary-50);
  }
}
</style>
