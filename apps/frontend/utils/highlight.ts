import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import php from 'highlight.js/lib/languages/php';
import ini from 'highlight.js/lib/languages/ini';
import dockerfile from 'highlight.js/lib/languages/dockerfile';

const registered = new Set<string>();
const reg = (name: string, lang: LanguageFn) => {
  hljs.registerLanguage(name, lang);
  registered.add(name);
};

reg('typescript', typescript);
reg('javascript', javascript);
reg('json', json);
reg('xml', xml);
reg('css', css);
reg('scss', scss);
reg('bash', bash);
reg('markdown', markdown);
reg('yaml', yaml);
reg('python', python);
reg('go', go);
reg('rust', rust);
reg('sql', sql);
reg('php', php);
reg('ini', ini);
reg('dockerfile', dockerfile);

const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  json5: 'json',
  vue: 'xml',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  go: 'go',
  rs: 'rust',
  sql: 'sql',
  php: 'php',
  env: 'ini',
  ini: 'ini',
  toml: 'ini',
  conf: 'ini',
};

export const langForPath = (path: string): string | null => {
  const file = (path.split('/').pop() ?? '').toLowerCase();
  if (file === 'dockerfile') return 'dockerfile';
  const ext = file.includes('.') ? (file.split('.').pop() ?? '') : '';
  return EXT_LANG[ext] ?? null;
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Подсветить код (HTML со span.hljs-*); если язык не определён — экранированный текст. */
export const highlightCode = (code: string, path: string): string => {
  const lang = langForPath(path);
  if (lang && registered.has(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      return escapeHtml(code);
    }
  }
  return escapeHtml(code);
};
