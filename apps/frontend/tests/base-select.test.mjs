import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const sfc = readFileSync(new URL('../components/BaseSelect.vue', import.meta.url), 'utf8');
const script = sfc.slice(sfc.indexOf('>', sfc.indexOf('<script')) + 1, sfc.indexOf('</script>'));
const compiled = ts.transpileModule(
  `${script}\nexport { isOpen, search, activeIndex, activeOptionId, searchInput, trigger, filteredOptions, selectedValues, handleKeydown, selectOption, triggerAction, openDropdown, closeDropdown, isFilledOption };`,
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  },
).outputText;

const setup = (overrides = {}) => {
  const props = {
    options: [
      { value: 0, label: 'Нулевой' },
      { value: 1, label: 'Первый' },
      { value: 2, label: 'Второй' },
    ],
    modelValue: 1,
    placeholder: 'Вариант',
    ...overrides,
  };
  const events = [];
  const watchers = [];
  let triggerFocus = 0;
  let searchFocus = 0;
  const exports = {};
  const vue = {
    ref: (value) => ({ value }),
    computed: (get) => ({
      get value() {
        return get();
      },
    }),
    nextTick: async () => {},
    useId: () => 'test-select',
    watch: (source, callback) => {
      const read = typeof source === 'function' ? source : () => source.value;
      watchers.push({ read, callback, previous: read() });
    },
  };
  runInNewContext(compiled, {
    exports,
    require: (name) => (name === 'vue' ? vue : {}),
    defineProps: () => props,
    withDefaults: (value, defaults) => {
      for (const [key, fallback] of Object.entries(defaults)) if (value[key] === undefined) value[key] = fallback;
      return value;
    },
    defineEmits: () => (name, value) => {
      events.push({ name, value });
      if (name === 'update:modelValue') props.modelValue = value;
    },
    onMounted: () => {},
    onBeforeUnmount: () => {},
    window: { dispatchEvent: () => {} },
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
  });
  exports.trigger.value = {
    focus: () => {
      triggerFocus++;
    },
  };
  exports.searchInput.value = {
    focus: () => {
      searchFocus++;
    },
  };
  const key = async (value, editingSearch = false) => {
    const event = {
      key: value,
      target: editingSearch ? exports.searchInput.value : exports.trigger.value,
      prevented: false,
      stopped: false,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
    };
    exports.handleKeydown(event);
    await new Promise(setImmediate);
    return event;
  };
  const flushWatchers = async () => {
    for (const watcher of watchers) {
      const value = watcher.read();
      if (value !== watcher.previous) {
        watcher.previous = value;
        watcher.callback(value);
      }
    }
    await Promise.resolve();
  };
  return { ...exports, key, events, props, flushWatchers, triggerFocus: () => triggerFocus, searchFocus: () => searchFocus };
};

test('Enter opens at the selected option and ArrowDown then Enter selects the next option', async () => {
  const select = setup();
  await select.key('Enter');
  assert.equal(select.isOpen.value, true);
  assert.equal(select.activeIndex.value, 1);
  assert.match(select.activeOptionId.value, /option-1$/);
  await select.key('ArrowDown');
  assert.equal(select.activeIndex.value, 2);
  assert.equal(select.events.length, 0);
  await select.key('Enter');
  assert.equal(select.events[0].value, 2);
  assert.equal(select.isOpen.value, false);
  assert.equal(select.activeOptionId.value, undefined);
  assert.equal(select.triggerFocus(), 1);
});

test('ArrowUp opens at the last option with no selection and Home/End navigate without selecting', async () => {
  const select = setup({ modelValue: null });
  await select.key('ArrowUp');
  assert.equal(select.activeIndex.value, 2);
  await select.key('Home');
  assert.equal(select.activeIndex.value, 0);
  await select.key('ArrowUp');
  assert.equal(select.activeIndex.value, 0);
  await select.key('End');
  assert.equal(select.activeIndex.value, 2);
  await select.key('ArrowDown');
  assert.equal(select.activeIndex.value, 2);
  assert.equal(select.events.length, 0);
});

test('Escape closes without changing the value and restores trigger focus', async () => {
  const select = setup();
  await select.key(' ');
  await select.key('ArrowDown');
  const event = await select.key('Escape');
  assert.equal(event.prevented, true);
  assert.equal(select.isOpen.value, false);
  assert.equal(select.events.length, 0);
  assert.equal(select.triggerFocus(), 1);
});

test('search keeps text editing keys while arrows and Enter select filtered options', async () => {
  const select = setup({ searchable: true });
  await select.key('Enter');
  assert.equal(select.searchFocus(), 1);
  assert.equal((await select.key(' ', true)).prevented, false);
  assert.equal((await select.key('Home', true)).prevented, false);
  assert.equal((await select.key('End', true)).prevented, false);
  select.search.value = 'Второй';
  await select.flushWatchers();
  assert.equal(select.filteredOptions.value.length, 1);
  assert.equal(select.activeIndex.value, 0);
  await select.key('Enter', true);
  assert.equal(select.events[0].value, 2);
  assert.equal(select.isOpen.value, false);
});

test('empty search results have no active descendant and Enter does not emit stale selection', async () => {
  const select = setup({ searchable: true });
  await select.key('Enter');
  select.search.value = 'Нет совпадений';
  await select.flushWatchers();
  assert.equal(select.activeIndex.value, -1);
  assert.equal(select.activeOptionId.value, undefined);
  await select.key('Enter', true);
  assert.equal(select.events.length, 0);
  assert.equal(select.isOpen.value, true);
});

test('multi-select toggles zero-valued options and stays open for further selection', async () => {
  const select = setup({ multiselect: true, modelValue: [] });
  await select.key('Enter');
  await select.key('Enter');
  assert.deepEqual(Array.from(select.events[0].value), [0]);
  assert.equal(select.isOpen.value, true);
  assert.equal(select.isFilledOption.value, true);
  await select.key('Enter');
  assert.deepEqual(Array.from(select.events[1].value), []);
  select.selectOption(select.props.options[2]);
  assert.deepEqual(Array.from(select.events[2].value), [2]);
});

test('disabled or pending controls do not open or select, and disabling an open control closes it', async () => {
  for (const state of [{ disabled: true }, { pending: true }]) {
    const select = setup(state);
    await select.key('ArrowDown');
    select.selectOption(select.props.options[2]);
    assert.equal(select.isOpen.value, false);
    assert.equal(select.events.length, 0);
  }
  const select = setup();
  await select.key('Enter');
  select.props.disabled = true;
  await select.flushWatchers();
  assert.equal(select.isOpen.value, false);
});

test('footer action remains separate from options and closes with focus restored', async () => {
  const select = setup({ options: [], modelValue: null, actionLabel: 'Создать' });
  await select.key('Enter');
  assert.equal(select.isOpen.value, true);
  assert.equal(select.activeIndex.value, -1);
  select.triggerAction();
  assert.equal(select.events[0].name, 'action');
  assert.equal(select.isOpen.value, false);
  assert.equal(select.triggerFocus(), 1);
});

test('template connects combobox to listbox/options and retains focus during pointer option selection', () => {
  assert.match(sfc, /:aria-controls="listboxId"/);
  assert.match(sfc, /role="listbox"/);
  assert.match(sfc, /role="option"/);
  assert.match(sfc, /:aria-selected=/);
  assert.match(sfc, /:aria-multiselectable=/);
  assert.match(sfc, /@mousedown\.prevent/);
  assert.match(sfc, /aria-label="Сбросить выбор"/);
});
