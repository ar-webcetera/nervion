# Дизайн-система Нервион (frontend)

Эталон для построения интерфейса. Извлечён из страниц «Задачи» (`pages/index.vue`), «Чат» (`pages/chat.vue`), «Проекты» (`pages/projects/index.vue`) и журнала действий (`pages/audit-logs.vue`). Любой новый раздел верстаем по этим правилам, а не на глаз.

Тема тёмная. Базовый текст светлый (`--light-text-backgroung-primary`), фон тёмный (`--dark-text-background-primary`).

## Главные правила

1. **Не хардкодить размеры шрифта.** Только типографические плейсхолдеры (`@extend %display-xs-medium`), никогда `font-size: 24px; font-weight: 600`.
2. **Цвета только через CSS-переменные** из `_colors.scss` (`var(--primary)`, `var(--light-text-backgroung-primary-50)`). Никаких `#fff`, `rgba(...)` в компонентах.
3. **Флексы через миксин** `@include flex(...)`, а не `display:flex; flex-direction:...`.
4. **Адаптив через переменные брейкпоинтов** `$screen-*`, не магические `901px`.
5. **БЭМ** с вложенным `&__element`, `&_modifier`. Стиль всегда `<style scoped lang="scss">`.
6. **Сначала ищем готовый `Base*`-компонент** (`BaseSelect`, `BaseModal`, `BaseDatePicker`, `BaseSwitcherContent`...), потом пишем своё.

## Подключение стилей

`_shared.scss` инжектится глобально в каждый компонент (`nuxt.config.ts`, `vite.css.preprocessorOptions.additionalData`). Он форвардит `variables`, `colors`, `mixins`, `typography`. Поэтому в любом `<style scoped>` сразу доступны все плейсхолдеры, миксины и `$screen-*` без импортов.

## Цвета (`assets/styles/_colors.scss`)

| Переменная | Назначение |
|---|---|
| `--light-text-backgroung-primary` | основной светлый текст (#fefefe) |
| `--light-text-backgroung-primary-50` | вторичный текст, подписи, плейсхолдеры |
| `--light-text-backgroung-primary-25` | приглушённые элементы |
| `--light-text-backgroung-primary-10` | бордеры панелей и карточек |
| `--light-text-backgroung-primary-5` | фон панелей, карточек, инпутов, hover |
| `--dark-text-background-primary` | тёмный фон (#131313): левые колонки, опции селекта |
| `--dark-text-background-primary-50` | полупрозрачный тёмный |
| `--black-50` | фон всплывающих модалок (с `backdrop-filter: blur`) |
| `--primary` | фирменный фиолетовый (#6f57f3): первичные кнопки, акценты, бейджи |
| `--primary-hover` | ховер первичной кнопки |
| `--primary-50` / `--primary-25` | бордер фокуса инпутов, полупрозрачные акценты |
| `--primary-75` | акцентные подписи |
| `--green` | успех |
| `--secondary` / `--accent` | оранжевые акценты |
| `--status-in-progress` | статус «в работе» (амбер) |
| `--danger-delete` (`-50`,`-25`) | удаление, ошибки |
| `--white-100/50/10/5` | белый и его прозрачности (легаси, предпочитать light-text-*) |

## Типографика (`assets/styles/_typography.scss`)

Два семейства: `Inter Tight` для крупных заголовков (`%display-*`), `Inter` для текста (`%text-*`, `%p*`). Каждый плейсхолдер несёт `font-size`, `font-weight`, `line-height`.

Шкала: `display-xxl/xl/l/m/s/xs` (72...24px), `text-xl/l/m/s/xs` (20...12px), легаси `p12/p14/p16/p18`. Суффикс веса: `light/regular/medium/bold`.

**Где что применять (устоявшаяся практика):**

| Элемент | Плейсхолдер |
|---|---|
| Заголовок страницы (h1) | `%display-xs-medium` (24px) |
| Заголовок панели/треда/модалки | `%h1` (20px/700) |
| Подзаголовок, подпись под заголовком | `%text-s-regular` + цвет `-50` |
| Основной текст списков, инпутов, кнопок | `%text-s-regular` / `%text-s-medium` (14px) |
| Мелкие подписи, мета, даты, бейджи | `%p12-regular` / `%p12-medium` / `%text-xs-*` (12px) |

## Миксин `flex` (`assets/styles/_mixins.scss`)

`@include flex(...)` ставит `display:flex` и применяет коды через пробел:

- направление: `r` / `c`, или сразу с wrap: `rn` (row nowrap), `cn` (column nowrap), `rw`, `cw`
- align-items: `a-start` / `a-center` / `a-end`, `baseline`, `stretch`
- justify-content: `j-start` / `j-center` / `j-end`, `between`, `around`, `evenly`
- сокращения обоих осей: `center` (всё по центру), `start`, `end`

Примеры: `@include flex(cn)` колонка; `@include flex(rn between a-center)` строка с разносом по краям и выравниванием по центру; `@include flex(center)` центрирование иконки в кнопке.

## Брейкпоинты (`assets/styles/_variables.scss`)

`$screen-desktop-xl: 1280px`, `$screen-desktop-l: 1024px`, `$screen-desktop-s: 901px`, `$screen-tablet: 768px`, `$screen-mobile-l: 480px`, `$screen-mobile-s: 320px`.

Десктоп-first: `@media (max-width: $screen-tablet) { ... }`.

## Каркасы страниц (три эталона)

Контент страницы живёт правее `BaseMenuLeft` (см. `layouts/default.vue`). Корень страницы тянется на всю высоту: `width: 100%; height: 100dvh; min-width: 0; flex: 1`.

### A. Простая страница с заголовком и контентом (по «Задачам» / журналу действий)

```scss
.page {
  width: 100%;
  height: 100dvh;
  min-width: 0;
  flex: 1;
  padding: 16px;
  @include flex(cn);
  gap: 16px;

  h1 { margin: 0; @extend %display-xs-medium; }

  &__header {
    @include flex(rn between a-start);
    gap: 16px;
    @media (max-width: $screen-tablet) { flex-direction: column; }
  }

  &__subtitle {
    margin: 6px 0 0;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }
}
```

Шаблон: `header` с `<h1>` и действиями справа, затем `<hr />`, затем `&__container` (`@include flex(cn); gap:16px; height:100%; overflow:hidden`).

### B. Раздел «список + деталь» (по «Чату» и «Почте»)

```scss
.section {
  width: 100%;
  height: 100dvh;
  display: grid;
  grid-template-columns: 380px 1fr;       /* у чата 480px */
  overflow: hidden;
  @media (max-width: $screen-tablet) { grid-template-columns: 1fr; }

  &__list {                                /* левая колонка */
    @include flex(cn);
    height: 100%;
    overflow: hidden;
    background-color: var(--dark-text-background-primary);
    border-right: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__detail {                              /* правая колонка */
    @include flex(cn);
    min-width: 0;
    height: 100%;
    overflow: hidden;
    background-color: var(--light-text-backgroung-primary-5);
  }
}
```

### C. Сетка карточек (по «Проектам»)

Заголовок `&__title` (`%display-xs-medium`) + кнопка «Новый …», ниже грид карточек `repeat(auto-fill, minmax(...))` с gap 12-16px.

## Компоненты-паттерны

### Панель / карточка

```scss
.card {
  border: 1px solid var(--light-text-backgroung-primary-10);
  background: var(--light-text-backgroung-primary-5);
  border-radius: 12px;
}
```

### Первичная кнопка

```scss
.btn-primary {
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: var(--light-text-backgroung-primary);
  cursor: pointer;
  @extend %text-s-medium;

  &:hover:not(:disabled) { background: var(--primary-hover); }
  &:disabled { opacity: 0.5; cursor: default; }
}
```

Кнопка с иконкой: `@include flex(center)`, `svg { stroke: var(--light-text-backgroung-primary); }`.

### Инпут / селект / textarea

```scss
.field {
  width: 100%;
  padding: 10px 12px;                  /* в крупных формах встречается 18px 20px, radius 12px */
  border: 1px solid var(--light-text-backgroung-primary-10);
  border-radius: 8px;
  background: var(--light-text-backgroung-primary-5);
  color: var(--light-text-backgroung-primary);
  outline: none;
  @extend %text-s-regular;

  &::placeholder { color: var(--light-text-backgroung-primary-50); }
  &:focus { border-color: var(--primary-50); }
}
/* нативный <select>: option { background: var(--dark-text-background-primary); } */
```

Готовый дропдаун с поиском и сбросом - `BaseSelect` (`v-model`, `:options`, `placeholder`, `large`, `arrow`, `reset-button`). Предпочитать его нативному `<select>` в формах.

### Бейдж / счётчик

- счётчик-«пилюля» в шапке: `padding:10px 14px; border-radius:999px; border:1px solid var(--light-text-backgroung-primary-10); background:var(--light-text-backgroung-primary-5);` + `%text-s-medium`
- бейдж непрочитанного: `min-width:20px; height:20px; border-radius:10px; background:var(--primary);` + `%p12-medium`, текст по центру

### Модалка

`BaseModal` (`ref` + `.open()`/`.close()`, слот для контента). Всплывающие формы поверх: `position:absolute; background:var(--black-50); backdrop-filter:blur(12px); border-radius:16px; padding:24px`.

### Элемент списка (строка треда/чата)

`@include flex(cn); gap:4px; padding:12px 16px; border-bottom:1px solid var(--light-text-backgroung-primary-5); cursor:pointer;` ховер `background:var(--light-text-backgroung-primary-5)`, активный `-10`. Длинный текст обрезать: `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`.

## Чек-лист перед версткой нового раздела

- [ ] выбран каркас A/B/C под задачу
- [ ] заголовок страницы `%display-xs-medium`, остальной текст плейсхолдерами
- [ ] цвета только переменными, фоны панелей `dark-*` / `light-*-5`, бордеры `light-*-10`
- [ ] флексы через `@include flex()`, адаптив через `$screen-*`
- [ ] переиспользованы `Base*`-компоненты
- [ ] `lint` + `typecheck` чистые
