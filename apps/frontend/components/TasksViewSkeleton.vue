<script setup lang="ts">
type TasksView = 'list' | 'kanban' | 'weekly';

defineProps<{ view: TasksView }>();

const listRows = 7;
const kanbanColumns = [3, 2, 4, 2, 3];
const weeklyColumns = [2, 3, 1, 2, 3, 1, 2];
</script>

<template>
  <div class="tasks-skeleton" role="status" aria-live="polite" aria-label="Загрузка задач">
    <span class="tasks-skeleton__status">Загрузка задач</span>

    <div v-if="view === 'list'" class="tasks-skeleton__list" aria-hidden="true">
      <div v-for="row in listRows" :key="row" class="tasks-skeleton__list-row">
        <div class="tasks-skeleton__drag-mark" />
        <div class="tasks-skeleton__list-content">
          <div class="tasks-skeleton__line tasks-skeleton__line_title" />
          <div class="tasks-skeleton__tags">
            <div class="tasks-skeleton__line tasks-skeleton__line_tag" />
            <div class="tasks-skeleton__line tasks-skeleton__line_tag-wide" />
            <div class="tasks-skeleton__line tasks-skeleton__line_tag-short" />
          </div>
        </div>
        <div class="tasks-skeleton__line tasks-skeleton__line_code" />
      </div>
    </div>

    <div v-else-if="view === 'kanban'" class="tasks-skeleton__board" aria-hidden="true">
      <div v-for="(cards, column) in kanbanColumns" :key="column" class="tasks-skeleton__column">
        <div class="tasks-skeleton__column-header">
          <div class="tasks-skeleton__dot" />
          <div class="tasks-skeleton__line tasks-skeleton__line_column-title" />
          <div class="tasks-skeleton__line tasks-skeleton__line_count" />
        </div>
        <div class="tasks-skeleton__cards">
          <div v-for="card in cards" :key="card" class="tasks-skeleton__card">
            <div class="tasks-skeleton__card-meta">
              <div class="tasks-skeleton__line tasks-skeleton__line_project" />
              <div class="tasks-skeleton__avatar" />
            </div>
            <div class="tasks-skeleton__line tasks-skeleton__line_card-title" />
            <div class="tasks-skeleton__line tasks-skeleton__line_card-title-short" />
            <div class="tasks-skeleton__line tasks-skeleton__line_description" />
          </div>
        </div>
      </div>
    </div>

    <div v-else class="tasks-skeleton__weekly" aria-hidden="true">
      <div class="tasks-skeleton__weekly-nav">
        <div class="tasks-skeleton__nav-button" />
        <div class="tasks-skeleton__line tasks-skeleton__line_week" />
        <div class="tasks-skeleton__nav-button" />
        <div class="tasks-skeleton__line tasks-skeleton__line_today" />
      </div>
      <div class="tasks-skeleton__board tasks-skeleton__board_weekly">
        <div v-for="(cards, column) in weeklyColumns" :key="column" class="tasks-skeleton__column tasks-skeleton__column_weekly">
          <div class="tasks-skeleton__column-header">
            <div class="tasks-skeleton__dot" />
            <div class="tasks-skeleton__line tasks-skeleton__line_day" />
          </div>
          <div class="tasks-skeleton__cards">
            <div v-for="card in cards" :key="card" class="tasks-skeleton__card tasks-skeleton__card_weekly">
              <div class="tasks-skeleton__card-meta">
                <div class="tasks-skeleton__line tasks-skeleton__line_project" />
                <div class="tasks-skeleton__avatar" />
              </div>
              <div class="tasks-skeleton__line tasks-skeleton__line_card-title" />
              <div class="tasks-skeleton__line tasks-skeleton__line_description" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.tasks-skeleton {
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;

  &__status {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  &__list,
  &__cards,
  &__weekly {
    @include flex(cn);
  }

  &__list {
    gap: 4px;
  }

  &__list-row {
    @include flex(rn, a-center);
    min-height: 56px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--light-text-backgroung-primary-5);
  }

  &__drag-mark {
    align-self: stretch;
    width: 34px;
    flex-shrink: 0;
    border-right: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__list-content {
    min-width: 0;
    flex: 1;
    padding: 8px;
    @include flex(cn);
    gap: 8px;
  }

  &__tags,
  &__card-meta,
  &__column-header,
  &__weekly-nav {
    @include flex(rn, a-center);
  }

  &__tags {
    gap: 12px;
  }

  &__board {
    @include flex(rn, stretch);
    width: 100%;
    height: 100%;
    overflow: hidden;

    &_weekly {
      flex: 1;
    }
  }

  &__column {
    flex: 0 0 280px;
    min-width: 0;
    height: 100%;
    padding: 0 8px;
    border-right: 1px solid var(--light-text-backgroung-primary-10);

    &:first-child {
      padding-left: 0;
    }

    &_weekly {
      flex-basis: 260px;
    }
  }

  &__column-header {
    gap: 6px;
    height: 32px;
    margin-bottom: 8px;
  }

  &__cards {
    gap: 8px;
  }

  &__card {
    min-height: 112px;
    padding: 10px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    @include flex(cn);
    gap: 8px;

    &_weekly {
      min-height: 88px;
    }
  }

  &__card-meta {
    width: 100%;
    justify-content: space-between;
  }

  &__weekly {
    height: 100%;
    gap: 16px;
  }

  &__weekly-nav {
    gap: 8px;
    height: 32px;
  }

  &__nav-button {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
  }

  &__dot,
  &__avatar,
  &__line,
  &__drag-mark::after {
    background: linear-gradient(
      100deg,
      var(--light-text-backgroung-primary-5) 20%,
      var(--light-text-backgroung-primary-10) 42%,
      var(--light-text-backgroung-primary-5) 64%
    );
    background-size: 220% 100%;
    animation: tasks-skeleton-shimmer 1.4s ease-in-out infinite;
  }

  &__drag-mark {
    position: relative;

    &::after {
      content: '';
      position: absolute;
      top: 18px;
      left: 12px;
      width: 10px;
      height: 20px;
      border-radius: 4px;
    }
  }

  &__dot,
  &__avatar {
    width: 8px;
    height: 8px;
    flex-shrink: 0;
    border-radius: 999px;
  }

  &__avatar {
    width: 20px;
    height: 20px;
  }

  &__line {
    height: 8px;
    border-radius: 4px;

    &_title {
      width: min(42%, 360px);
      height: 10px;
    }

    &_tag {
      width: 72px;
    }

    &_tag-wide {
      width: 112px;
    }

    &_tag-short {
      width: 88px;
    }

    &_code {
      width: 56px;
      margin-right: 12px;
    }

    &_column-title {
      width: 112px;
    }

    &_count {
      width: 20px;
      height: 16px;
      border-radius: 999px;
    }

    &_project {
      width: 96px;
    }

    &_card-title {
      width: 88%;
      height: 10px;
    }

    &_card-title-short {
      width: 58%;
      height: 10px;
    }

    &_description {
      width: 72%;
    }

    &_week {
      width: 152px;
      height: 10px;
    }

    &_today {
      width: 112px;
      height: 24px;
      margin-left: 8px;
      border-radius: 6px;
    }

    &_day {
      width: 88px;
      height: 10px;
    }
  }

  @media (max-width: $screen-mobile-l) {
    &__weekly-nav {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) 44px;
      height: auto;
      gap: 8px;
    }

    &__nav-button {
      width: 44px;
      height: 44px;
    }

    &__line {
      &_week {
        width: 100%;
      }

      &_today {
        grid-column: 1 / -1;
        width: 100%;
        height: 44px;
        margin-left: 0;
      }
    }

    &__list-row:nth-child(n + 6) {
      display: none;
    }

    &__tags {
      gap: 8px;
    }

    &__line {
      &_title {
        width: 72%;
      }

      &_tag-wide {
        width: 88px;
      }

      &_tag-short,
      &_code {
        display: none;
      }
    }
  }

  @media (prefers-reduced-motion: reduce) {
    &__dot,
    &__avatar,
    &__line,
    &__drag-mark::after {
      animation: none;
      background-position: 50% 0;
    }
  }
}

@keyframes tasks-skeleton-shimmer {
  from {
    background-position: 120% 0;
  }

  to {
    background-position: -120% 0;
  }
}
</style>
