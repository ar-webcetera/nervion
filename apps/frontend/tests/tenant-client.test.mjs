import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const load = (relative, globals = {}, client = false) => {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8').replaceAll('import.meta.client', String(client));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, URL, console, ...globals });
  return exports;
};

test('SaaS browser API stays on the current origin even when legacy API_URL is configured', () => {
  const { usePublicApiBaseUrl } = load('../composables/usePublicApiBaseUrl.ts', {
    useRuntimeConfig: () => ({ public: { tenancyEnabled: true, API_URL: 'https://legacy.example.com' } }),
  });
  assert.equal(usePublicApiBaseUrl(), '');
});

test('SSR forwards only the cookie and server-signed tenant headers', () => {
  const signed = { 'x-nervion-host': 'a.example.com', 'x-nervion-timestamp': '123', 'x-nervion-signature': 'hmac' };
  const { useApiRequestHeaders } = load('../composables/useApiRequestHeaders.ts', {
    useRequestHeaders: () => ({ cookie: 'session=test', 'x-forwarded-host': 'attacker.example.com' }),
    useRequestEvent: () => ({ context: { nervionTenantHeaders: signed } }),
    useRuntimeConfig: () => ({ public: { tenancyEnabled: true } }),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(useApiRequestHeaders())), { cookie: 'session=test', ...signed });
});

test('SSR does not fall back to a default tenant if signed context is absent', () => {
  const { useApiRequestHeaders } = load('../composables/useApiRequestHeaders.ts', {
    useRequestHeaders: () => ({ cookie: 'session=test' }), useRequestEvent: () => ({ context: {} }),
    useRuntimeConfig: () => ({ public: { tenancyEnabled: true } }),
    createError: ({ statusMessage }) => new Error(statusMessage),
  });
  assert.throws(useApiRequestHeaders, /Контекст пространства отсутствует/);
});

test('browser request headers never expose server signatures or cookies to JavaScript', () => {
  const { useApiRequestHeaders } = load('../composables/useApiRequestHeaders.ts', {}, true);
  assert.deepEqual(JSON.parse(JSON.stringify(useApiRequestHeaders())), {});
});

test('tenant file links and old S3 links resolve through authenticated same-origin API', () => {
  const { buildAwsObjectUrl } = load('../utils/resolveUrl.ts');
  assert.equal(buildAwsObjectUrl('tracker-tasks/1/report.pdf', 'https://files.example.com', true), '/api/files/raw?key=tracker-tasks%2F1%2Freport.pdf');
  assert.equal(buildAwsObjectUrl('https://files.example.com/tracker-tasks/1/report.pdf', 'https://files.example.com', true), '/api/files/raw?key=tracker-tasks%2F1%2Freport.pdf');
  assert.equal(buildAwsObjectUrl('/api/files/raw?key=a', 'https://files.example.com', true), '/api/files/raw?key=a');
  assert.equal(buildAwsObjectUrl('https://external.example.com/a', 'https://files.example.com', true), 'https://external.example.com/a');
  assert.equal(buildAwsObjectUrl('blob:preview', 'https://files.example.com', true), 'blob:preview');
  assert.equal(buildAwsObjectUrl('https://', 'https://files.example.com', true), undefined);
  assert.equal(buildAwsObjectUrl('https://files.example.com/a', 'invalid endpoint', true), undefined);
});
