import { rewriteStorageUrls } from './migrate-tenant-storage';
import { parseStoragePublicBases, rewriteJsonDocumentText } from './tenant-storage-url-rewrite';

describe('rewriteStorageUrls', () => {
  const bases = [new URL('https://files.example.com/bucket/')];
  const copied = new Set(['tracker-tasks/1/report.pdf', 'tracker-avatars/a.png']);

  it('rewrites nested document references only after their objects are selected for copying', () => {
    expect(
      rewriteStorageUrls(
        { content: [{ attrs: { href: 'https://files.example.com/bucket/tracker-tasks/1/report.pdf' } }] },
        bases,
        copied,
      ),
    ).toEqual({ content: [{ attrs: { href: '/api/files/raw?key=tracker-tasks%2F1%2Freport.pdf' } }] });
  });

  it('keeps unrelated domains, paths and files outside the migration manifest', () => {
    const values = [
      'https://files.example.com/other/tracker-avatars/a.png',
      'https://external.example.com/bucket/tracker-avatars/a.png',
      'https://files.example.com/bucket/other-client/file.pdf',
      'http://files.example.com/bucket/tracker-avatars/a.png',
      'https://files.example.com.evil.test/bucket/tracker-avatars/a.png',
      'https://files.example.com/bucket-other/tracker-avatars/a.png',
      'https://files.example.com/bucket/tenants/another/tracker-avatars/a.png',
      'https://user:password@files.example.com/bucket/tracker-avatars/a.png',
      'https://files.example.com/bucket/tracker-avatars/a.png?key=other-client%2Fsecret',
    ];
    expect(rewriteStorageUrls(values, bases, copied)).toEqual(values);
  });

  it('does not change relative URLs or scalar JSON values', () => {
    const value = { src: '/api/files/raw?key=tracker-avatars%2Fa.png', enabled: true, id: 7, empty: null };
    expect(rewriteStorageUrls(value, bases, copied)).toEqual(value);
  });

  it('rewrites HTML, Markdown and strings embedded in rich text without changing surrounding content', () => {
    const source = {
      html: '<p>Фото <img src="https://files.example.com/bucket/tracker-avatars/a.png"></p>',
      markdown: '[Файл](https://files.example.com/bucket/tracker-tasks/1/report.pdf).',
      richtext: [{ text: 'Вложение: https://files.example.com/bucket/tracker-avatars/a.png, готово.' }],
    };
    expect(rewriteStorageUrls(source, bases, copied)).toEqual({
      html: '<p>Фото <img src="/api/files/raw?key=tracker-avatars%2Fa.png"></p>',
      markdown: '[Файл](/api/files/raw?key=tracker-tasks%2F1%2Freport.pdf).',
      richtext: [{ text: 'Вложение: /api/files/raw?key=tracker-avatars%2Fa.png, готово.' }],
    });
  });

  it('preserves encoded filenames, query and fragments, including HTML entity separators', () => {
    const key = 'tracker-tasks/1/Фото + отчет(1).pdf';
    const keys = new Set([key]);
    const path = key.split('/').map(encodeURIComponent).join('/');
    const target = `/api/files/raw?key=${encodeURIComponent(key)}`;
    expect(rewriteStorageUrls(`https://files.example.com/bucket/${path}?download=1#page=2`, bases, keys)).toBe(
      `${target}&download=1#page=2`,
    );
    expect(rewriteStorageUrls(`<a href="https://files.example.com/bucket/${path}?a=1&amp;b=2#page=2">PDF</a>`, bases, keys)).toBe(
      `<a href="${target}&amp;a=1&amp;b=2#page=2">PDF</a>`,
    );
    expect(rewriteStorageUrls(`[PDF](https://files.example.com/bucket/${path}#page=2)`, bases, keys)).toBe(
      `[PDF](${target}#page=2)`,
    );
  });

  it('rewrites whole scalar URLs with literal spaces only for exact decoded manifest keys', () => {
    const key = 'tracker-tasks/1/Фото + отчет (1).pdf';
    const url = `https://files.example.com/bucket/${key}`;
    const target = `/api/files/raw?key=${encodeURIComponent(key)}`;
    expect(rewriteStorageUrls({ attrs: { href: url } }, bases, new Set([key]))).toEqual({ attrs: { href: target } });
    expect(rewriteStorageUrls(`${url}?download=1&amp;name=a b#page 2`, bases, new Set([key]))).toBe(
      `${target}&amp;download=1&amp;name=a%20b#page%202`,
    );
    expect(rewriteStorageUrls(target, bases, new Set([key]))).toBe(target);
  });

  it('preserves trailing filename spaces instead of normalizing them to another object', () => {
    const key = 'tracker-tasks/1/report.pdf ';
    const url = `https://files.example.com/bucket/${key}`;
    expect(rewriteStorageUrls(url, bases, copied)).toBe(url);
    expect(rewriteStorageUrls(url, bases, new Set([key]))).toBe(`/api/files/raw?key=${encodeURIComponent(key)}`);
  });

  it('preserves Unicode spacing characters in complete filename URLs', () => {
    for (const space of ['\u00a0', '\u202f', '\u2007']) {
      const key = `tracker-tasks/1/screenshot 10${space}AM.png`;
      expect(rewriteStorageUrls(`https://files.example.com/bucket/${key}`, bases, new Set([key]))).toBe(
        `/api/files/raw?key=${encodeURIComponent(key)}`,
      );
    }
  });

  it('does not partially rewrite absent whitespace-bearing scalar URLs or normalize control characters', () => {
    const values = [
      'https://files.example.com/bucket/tracker-tasks/1/report.pdf missing',
      'https://files.example.com/bucket/tracker-tasks/1/report.pdf\t',
      'https://files.example.com/bucket/tracker-tasks/1/report.pdf\n',
      'https://files.example.com/bucket/tracker-tasks/1/report.pdf\r',
    ];
    expect(rewriteStorageUrls(values, bases, copied)).toEqual(values);
  });

  it('retains origin, prefix, credentials and key-query guards for scalar URLs with spaces', () => {
    const key = 'tracker-tasks/1/my report.pdf';
    const values = [
      `https://external.example.com/bucket/${key}`,
      `https://files.example.com/bucket-other/${key}`,
      `https://files.example.com.evil.test/bucket/${key}`,
      `https://user:password@files.example.com/bucket/${key}`,
      `https://files.example.com/bucket/${key}?key=other-client/secret`,
      `https://files.example.com/bucket/${key.replace(' ', '%2520')}`,
    ];
    expect(rewriteStorageUrls(values, bases, new Set([key]))).toEqual(values);
  });

  it('rewrites quoted HTML URL attributes with spaces while preserving markup and other attributes', () => {
    const key = 'tracker-tasks/1/my report.pdf';
    const url = `https://files.example.com/bucket/${key}`;
    const target = `/api/files/raw?key=${encodeURIComponent(key)}`;
    const source = `<a class="file" HREF = '${url}?a=1&amp;b=2' title="Report > PDF">file</a><img src="${url}"><video poster='${url}'></video>`;
    expect(rewriteStorageUrls(source, bases, new Set([key]))).toBe(
      `<a class="file" HREF = '${target}&amp;a=1&amp;b=2' title="Report > PDF">file</a><img src="${target}"><video poster='${target}'></video>`,
    );
    expect(rewriteStorageUrls('<img src=https://files.example.com/bucket/tracker-avatars/a.png>', bases, copied)).toBe(
      '<img src=/api/files/raw?key=tracker-avatars%2Fa.png>',
    );
  });

  it('does not expand raw-space URLs in prose, non-URL attributes, comments or raw-text elements', () => {
    const key = 'tracker-tasks/1/my report.pdf';
    const url = `https://files.example.com/bucket/${key}`;
    const values = [
      `Файл: ${url}, конец.`,
      `<span data-note="href='${url}'">keep</span>`,
      `<!-- <a href="${url}">keep</a> -->`,
      `<script>const html = '<a href="${url}">keep</a>';</script>`,
      `<style>/* <a href="${url}">keep</a> */</style>`,
      `<textarea><a href="${url}">keep</a></textarea>`,
      `<title><a href="${url}">keep</a></title>`,
    ];
    expect(rewriteStorageUrls(values, bases, new Set([key]))).toEqual(values);
    const absent = `<a href="https://files.example.com/bucket/tracker-tasks/1/report.pdf missing">keep</a>`;
    expect(rewriteStorageUrls(absent, bases, copied)).toBe(absent);
  });

  it('preserves JSON formatting and large numbers when rewriting scalar URLs with spaces', () => {
    const key = 'tracker-tasks/1/my report.pdf';
    const source = `{ "large": 9007199254740993123, "href": "https://files.example.com/bucket/${key}" }`;
    expect(rewriteJsonDocumentText(source, bases, new Set([key]))).toBe(
      `{ "large": 9007199254740993123, "href": "/api/files/raw?key=${encodeURIComponent(key)}" }`,
    );
  });

  it('does not decode twice or rewrite a URL nested inside a foreign URL query', () => {
    const values = [
      'https://files.example.com/bucket/tracker-avatars%252Fa.png',
      'https://external.example.com/?next=https://files.example.com/bucket/tracker-avatars/a.png',
      'ftp://files.example.com/bucket/tracker-avatars/a.png',
    ];
    expect(rewriteStorageUrls(values, bases, copied)).toEqual(values);
  });

  it('keeps JSON formatting, large integers and keys while rewriting escaped string values', () => {
    const source =
      '{\n  "large": 9007199254740993123, "https://files.example.com/bucket/tracker-avatars/a.png": "keep",\n  "document": "https:\\/\\/files.example.com\\/bucket\\/tracker-avatars\\/a.png"\n}';
    const result = rewriteJsonDocumentText(source, bases, copied);
    expect(result).toContain('"large": 9007199254740993123');
    expect(result).toContain('"https://files.example.com/bucket/tracker-avatars/a.png": "keep"');
    expect(result).toContain('"document": "/api/files/raw?key=tracker-avatars%2Fa.png"');
    expect(result.startsWith('{\n  ')).toBe(true);
    expect(rewriteJsonDocumentText(result, bases, copied)).toBe(result);
    expect(() => rewriteJsonDocumentText('not JSON', bases, copied)).toThrow();
  });

  it('validates explicit storage origins and is idempotent', () => {
    expect(parseStoragePublicBases('https://files.example.com/bucket')[0].href).toBe(bases[0].href);
    for (const invalid of ['file:///tmp', 'https://user:password@files.example.com', 'https://files.example.com/?key=a']) {
      expect(() => parseStoragePublicBases(invalid)).toThrow();
    }
    const value = 'Фото https://files.example.com/bucket/tracker-avatars/a.png';
    const rewritten = rewriteStorageUrls(value, bases, copied);
    expect(rewriteStorageUrls(rewritten, bases, copied)).toEqual(rewritten);
  });
});
