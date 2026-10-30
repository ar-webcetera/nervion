import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { HEALTHCHECK_MAX_TIMEOUT_SECONDS } = require('@tracker/contracts');
const page = readFileSync(new URL('../pages/healthchecks.vue', import.meta.url), 'utf8');
const script = page.slice(page.indexOf('>', page.indexOf('<script')) + 1, page.indexOf('</script>'));
const sourceFile = ts.createSourceFile('healthchecks.ts', script, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const selected = new Set(['timeoutMax', 'defaultForm', 'openEdit', 'save']);
const declarations = sourceFile.statements.filter((statement) =>
  ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) =>
    ts.isIdentifier(declaration.name) && selected.has(declaration.name.text),
  ),
);
assert.equal(declarations.length, selected.size);
const compiled = ts.transpileModule(`${declarations.map((statement) => statement.getText(sourceFile)).join('\n')}\nexport { defaultForm, openEdit, save };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const setup = (timeout = 30) => {
  const errors = [];
  const writes = [];
  const globals = {
    exports: {},
    HEALTHCHECK_MAX_TIMEOUT_SECONDS,
    form: { value: { name: 'API', url: 'https://example.com/health', interval_seconds: 60, timeout_seconds: timeout, expected_status: 200, chat_id: 'chat', sender_user_id: 1 } },
    formError: { value: '' },
    editingId: { value: null },
    modalOpen: { value: false },
    saving: { value: false },
    canWrite: { value: true },
    actionPending: { value: false },
    loadError: { value: null },
    showFormError: async (message) => errors.push(message),
    healthcheckStore: { create: async (dto) => writes.push({ ...dto }), update: async (_id, dto) => writes.push({ ...dto }) },
    $toast: { success: () => {} },
    getErrorMessage: (error) => error.message,
  };
  runInNewContext(compiled, globals);
  return { ...globals, ...globals.exports, errors, writes };
};

test('monitor input and validation use the shared thirty-second maximum', () => {
  assert.equal(HEALTHCHECK_MAX_TIMEOUT_SECONDS, 30);
  assert.match(script, /import\s*\{\s*HEALTHCHECK_MAX_TIMEOUT_SECONDS\s*\}\s*from '@tracker\/contracts'/);
  assert.match(page, /v-model\.number="form\.timeout_seconds"[\s\S]*?:max="timeoutMax"/);
});

test('new monitors retain the ten-second default and accept thirty seconds', async () => {
  const view = setup();
  assert.equal(view.defaultForm().timeout_seconds, 10);
  await view.save();
  assert.deepEqual(view.errors, []);
  assert.equal(view.writes[0].timeout_seconds, 30);
});

test('editing an existing thirty-second monitor preserves its configured value', async () => {
  const view = setup();
  view.openEdit({ ...view.form.value, id: 1 });
  assert.equal(view.form.value.timeout_seconds, 30);
  await view.save();
  assert.deepEqual(view.errors, []);
  assert.equal(view.writes[0].timeout_seconds, 30);
});

test('thirty-one seconds is rejected before any API write', async () => {
  const view = setup(31);
  await view.save();
  assert.equal(view.writes.length, 0);
  assert.match(view.errors[0], /от 1 до 30 секунд/);
});
