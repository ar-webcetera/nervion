<script setup lang="ts">
const { resolveAwsUrl } = useResolveUrl();
import { CalendarParticipationStatus, type CalendarEvent, type CalendarParticipant, type CalendarUser } from '@tracker/contracts';
import { Bell, CalendarDays, Check, CircleCheck, Clock3, ExternalLink, Link2, LoaderCircle } from '@lucide/vue';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    event: CalendarEvent | null;
    currentUserId: number;
    accepting?: boolean;
  }>(),
  { accepting: false },
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'close' | 'accept'): void;
}>();

const formatDate = (event: CalendarEvent) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: event.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(event.start_at));

const formatTime = (event: CalendarEvent) => {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: event.timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formatter.format(new Date(event.start_at))} - ${formatter.format(new Date(event.end_at))}`;
};

const reminderLabel = (minutes: number) => {
  if (minutes === 0) return 'В момент начала';
  if (minutes < 60) return `За ${minutes} ${minutes === 1 ? 'минуту' : minutes < 5 ? 'минуты' : 'минут'}`;
  if (minutes === 60) return 'За 1 час';
  if (minutes % 1440 === 0) return `За ${minutes / 1440} дн.`;
  return `За ${minutes / 60} ч.`;
};

const userName = (user: CalendarUser) => [user.first_name, user.patronymic, user.last_name].filter(Boolean).join(' ');
const userInitials = (user: CalendarUser) => `${user.first_name[0] ?? ''}${user.last_name[0] ?? ''}`;
const attendees = computed(() => {
  if (!props.event) return [];
  const users: (CalendarParticipant | CalendarUser)[] = props.event.participants.some(
    (participant) => participant.id === props.event?.creator.id,
  )
    ? props.event.participants
    : [props.event.creator, ...props.event.participants];
  return users.map((user) => {
    const isOrganizer = user.id === props.event?.creator.id;
    return {
      user,
      isOrganizer,
      status:
        'participation_status' in user
          ? user.participation_status
          : isOrganizer
            ? CalendarParticipationStatus.accepted
            : CalendarParticipationStatus.invited,
    };
  });
});
const currentParticipation = computed(() => attendees.value.find((attendee) => attendee.user.id === props.currentUserId));
const participantCountLabel = computed(() => {
  const count = attendees.value.length;
  return `${count} ${count === 1 ? 'участник' : count < 5 ? 'участника' : 'участников'}`;
});
const canAccept = computed(
  () =>
    currentParticipation.value &&
    !currentParticipation.value.isOrganizer &&
    currentParticipation.value.status === CalendarParticipationStatus.invited,
);
</script>

<template>
  <BaseBottomSheet
    :model-value="modelValue"
    :title="event?.title || 'Встреча'"
    :subtitle="participantCountLabel"
    size="compact"
    @update:model-value="emit('update:modelValue', $event)"
    @close="emit('close')"
  >
    <article v-if="event" class="event-details">
      <div class="event-details__schedule">
        <div class="event-details__schedule-row">
          <CalendarDays :size="19" :stroke-width="1.75" aria-hidden="true" />
          <div>
            <strong class="event-details__date">{{ formatDate(event) }}</strong>
            <span>Дата встречи</span>
          </div>
        </div>
        <div class="event-details__schedule-row">
          <Clock3 :size="19" :stroke-width="1.75" aria-hidden="true" />
          <div>
            <strong>{{ formatTime(event) }}</strong>
            <span>Время встречи</span>
          </div>
        </div>
        <div v-if="event.meeting_url" class="event-details__schedule-row">
          <Link2 :size="19" :stroke-width="1.75" aria-hidden="true" />
          <div>
            <a class="event-details__meeting-link" :href="event.meeting_url" target="_blank" rel="noopener noreferrer">
              Открыть встречу
              <ExternalLink :size="15" :stroke-width="1.75" aria-hidden="true" />
            </a>
            <span>Ссылка на встречу</span>
          </div>
        </div>
      </div>

      <section class="event-details__section">
        <div class="event-details__section-title">
          <h3>Участники</h3>
          <span>{{ attendees.length }}</span>
        </div>
        <div class="event-details__participants">
          <div v-for="attendee in attendees" :key="attendee.user.id" class="event-details__person">
            <span class="event-details__avatar" aria-hidden="true">
              <img v-if="attendee.user.photo_url" :src="resolveAwsUrl(attendee.user.photo_url)" alt="" />
              <span v-else>{{ userInitials(attendee.user) }}</span>
            </span>
            <span class="event-details__person-copy">
              <strong>{{ userName(attendee.user) }}</strong>
              <small>
                {{ attendee.user.email || 'Email не указан' }}
                <span class="event-details__role-mobile">
                  ·
                  {{
                    attendee.isOrganizer
                      ? 'Организатор'
                      : attendee.status === CalendarParticipationStatus.accepted
                        ? 'Участие подтверждено'
                        : 'Ожидает подтверждения'
                  }}
                </span>
              </small>
            </span>
            <small v-if="attendee.isOrganizer" class="event-details__role">Организатор</small>
            <small
              v-else-if="attendee.status === CalendarParticipationStatus.accepted"
              class="event-details__role event-details__role_accepted"
            >
              <CircleCheck :size="15" :stroke-width="1.75" aria-hidden="true" />
              Подтвердил
            </small>
            <small v-else class="event-details__role">Ожидает ответа</small>
          </div>
        </div>
      </section>

      <section class="event-details__section">
        <h3>Заметки</h3>
        <p class="event-details__notes">{{ event.notes || 'Заметок нет' }}</p>
      </section>

      <footer class="event-details__footer">
        <div class="event-details__reminder">
          <Bell :size="18" :stroke-width="1.75" aria-hidden="true" />
          <div>
            <strong>{{ reminderLabel(event.reminder_minutes) }}</strong>
            <span>Push и письмо для всех участников</span>
          </div>
        </div>
        <button v-if="canAccept" type="button" class="event-details__accept" :disabled="accepting" @click="emit('accept')">
          <LoaderCircle v-if="accepting" class="event-details__loader" :size="17" aria-hidden="true" />
          <Check v-else :size="17" :stroke-width="2" aria-hidden="true" />
          {{ accepting ? 'Подтверждаем' : 'Подтвердить участие' }}
        </button>
      </footer>
    </article>
  </BaseBottomSheet>
</template>

<style scoped lang="scss">
.event-details {
  width: 100%;
  padding: 0 28px;
  color: var(--light-text-backgroung-primary);
  @include flex(cn);

  &__schedule {
    padding: 0 0 24px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    @include flex(cn);
    gap: 16px;
  }

  &__schedule-row {
    min-width: 0;
    display: grid;
    grid-template-columns: 24px 1fr;
    align-items: start;
    gap: 12px;

    svg {
      margin-top: 2px;
      color: var(--light-text-backgroung-primary-50);
    }

    div {
      min-width: 0;
      @include flex(cn);
      gap: 2px;
    }

    strong {
      min-width: 0;
      overflow-wrap: anywhere;
      font-variant-numeric: tabular-nums;
      @extend %text-m-medium;
    }

    span {
      color: var(--light-text-backgroung-primary-50);
      @extend %text-xs-regular;
    }
  }

  &__date::first-letter {
    text-transform: uppercase;
  }

  &__meeting-link {
    width: fit-content;
    color: color-mix(in srgb, var(--primary) 72%, white);
    text-decoration: none;
    @include flex(rn, a-center);
    gap: 6px;
    @extend %text-m-medium;

    &:hover {
      text-decoration: underline;
    }

    &:focus-visible {
      border-radius: 4px;
      outline: 2px solid var(--primary);
      outline-offset: 3px;
    }
  }

  &__section {
    padding: 24px 0;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    @include flex(cn);
    gap: 12px;

    > h3 {
      margin: 0;
      @extend %text-m-medium;
    }
  }

  &__section-title {
    @include flex(rn, a-center);
    gap: 8px;

    h3 {
      margin: 0;
      @extend %text-m-medium;
    }

    > span {
      color: var(--light-text-backgroung-primary-50);
      @extend %text-s-regular;
    }
  }

  &__participants {
    max-height: 168px;
    overflow-y: auto;

    .event-details__person:not(:last-child) {
      border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    }
  }

  &__person {
    min-width: 0;
    min-height: 48px;
    padding: 8px 0;
    @include flex(rn, a-center);
    gap: 12px;

    strong,
    small {
      overflow-wrap: anywhere;
    }

    strong {
      @extend %text-s-medium;
    }

    small {
      color: var(--light-text-backgroung-primary-50);
      @extend %text-xs-regular;
    }
  }

  &__person-copy {
    min-width: 0;
    flex: 1;
    @include flex(cn);
  }

  &__role {
    flex-shrink: 0;
    @include flex(rn, a-center);
    gap: 5px;

    &_accepted {
      color: color-mix(in srgb, var(--primary) 68%, white) !important;
    }
  }

  &__role-mobile {
    display: none;
  }

  &__avatar {
    width: 32px;
    height: 32px;
    overflow: hidden;
    flex: 0 0 32px;
    border-radius: 999px;
    background: var(--light-text-backgroung-primary-10);
    @include flex(center);
    @extend %text-xs-medium;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &__notes {
    margin: 0;
    color: var(--light-text-backgroung-primary-75);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    @extend %text-s-regular;
  }

  &__footer {
    padding: 20px 0;
    @include flex(rn, a-center, j-between);
    gap: 24px;

    button {
      min-height: 44px;
      padding: 10px 16px;
      border: 0;
      border-radius: 8px;
      cursor: pointer;
      @extend %text-s-medium;

      &:disabled {
        cursor: wait;
        opacity: 0.65;
      }

      &:hover {
        background: var(--light-text-backgroung-primary-10);
      }

      &:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
    }
  }

  &__accept {
    flex-shrink: 0;
    background: var(--primary);
    color: white;
    @include flex(rn, center);
    gap: 7px;

    &:hover:not(:disabled) {
      filter: brightness(1.08);
    }
  }

  &__loader {
    animation: event-details-spin 0.8s linear infinite;
  }

  &__reminder {
    min-width: 0;
    display: grid;
    grid-template-columns: 24px 1fr;
    align-items: start;
    gap: 12px;

    svg {
      margin-top: 2px;
      color: var(--primary);
    }

    div {
      min-width: 0;
      @include flex(cn);
      gap: 2px;
    }

    strong,
    span {
      overflow-wrap: anywhere;
    }

    strong {
      @extend %text-s-medium;
    }

    span {
      color: var(--light-text-backgroung-primary-50);
      @extend %text-xs-regular;
    }
  }

  @media (max-width: $screen-mobile-l) {
    padding: 0 16px;

    &__footer {
      align-items: stretch;
      flex-direction: column;
      gap: 20px;
    }

    &__accept {
      width: 100%;
    }

    &__role {
      display: none;
    }

    &__role-mobile {
      display: inline;
    }
  }
}

@keyframes event-details-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .event-details__loader {
    animation: none;
  }
}
</style>
