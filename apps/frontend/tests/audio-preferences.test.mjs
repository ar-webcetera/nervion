import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { ref, computed, watch } = require('vue');
const compile = (path, client = true) =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('import.meta.client', String(client)), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const enums = {};
runInNewContext(compile('../enums/audio.enums.ts'), { exports: enums });
const setup = (storage = new Map(), { blocked = false, client = true } = {}) => {
  const exports = {};
  runInNewContext(compile('../stores/audioPreferencesStore.ts', client), {
    exports,
    ref,
    computed,
    localStorage: {
      getItem: (key) => {
        if (blocked) throw new Error('denied');
        return storage.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (blocked) throw new Error('denied');
        storage.set(key, value);
      },
    },
    require: (name) => (name === 'pinia' ? { defineStore: (_id, factory) => factory } : enums),
  });
  return exports.useAudioPreferencesStore();
};

test('rate cycles, persists and restores after application restart', () => {
  const storage = new Map();
  const store = setup(storage);
  store.initialize();
  assert.equal(store.playbackRate.value, 1);
  for (const rate of [1.5, 2, 1]) {
    store.cyclePlaybackRate();
    assert.equal(store.playbackRate.value, rate);
    const restarted = setup(storage);
    restarted.initialize();
    assert.equal(restarted.playbackRate.value, rate);
  }
});

test('all mounted players react to the shared rate; new players do not reset it', () => {
  const store = setup();
  store.initialize();
  const players = [{ playbackRate: 1 }, { playbackRate: 1 }];
  const stops = players.map((player) =>
    watch(
      store.playbackRate,
      (value) => {
        player.playbackRate = value;
      },
      { flush: 'sync' },
    ),
  );
  store.cyclePlaybackRate();
  store.initialize();
  assert.deepEqual(
    players.map((player) => player.playbackRate),
    [1.5, 1.5],
  );
  stops.forEach((stop) => stop());
});

test('invalid stored values fall back to normal speed', () => {
  for (const saved of ['', 'NaN', '-1', 'Infinity', '3', 'broken']) {
    const store = setup(new Map([['audio-playback-rate', saved]]));
    store.initialize();
    assert.equal(store.playbackRate.value, 1);
  }
});

test('unavailable storage does not break speed controls', () => {
  const store = setup(new Map(), { blocked: true });
  assert.doesNotThrow(() => {
    store.initialize();
    store.cyclePlaybackRate();
  });
  assert.equal(store.playbackRate.value, 1.5);
});

test('SSR does not read browser storage or share preferences between requests', () => {
  const storage = new Map([['audio-playback-rate', '2']]);
  const store = setup(storage, { client: false, blocked: true });
  store.initialize();
  assert.equal(store.playbackRate.value, 1);
  store.cyclePlaybackRate();
  assert.equal(setup(storage, { client: false }).playbackRate.value, 1);
  assert.equal(storage.get('audio-playback-rate'), '2');
});
