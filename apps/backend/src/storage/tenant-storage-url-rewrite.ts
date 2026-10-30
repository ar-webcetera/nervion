export type StorageDocumentValue =
  | null
  | string
  | number
  | boolean
  | StorageDocumentValue[]
  | { [key: string]: StorageDocumentValue };

export function parseStoragePublicBases(raw: string): URL[] {
  return raw.split(',').map((entry) => {
    const url = new URL(entry.trim().replace(/\/+$/, '') + '/');
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) {
      throw new Error('Public storage bases must be plain HTTP(S) URLs');
    }
    return url;
  });
}

function rewriteUrl(value: string, bases: URL[], copiedKeys: ReadonlySet<string>): string | null {
  if (!/^https?:\/\//i.test(value) || /[\s<>"\\]/.test(value)) return null;
  const htmlEscaped = value.includes('&amp;');
  let url: URL;
  try {
    url = new URL(htmlEscaped ? value.replaceAll('&amp;', '&') : value);
  } catch {
    return null;
  }
  // An old query must not override the destination API's authorization key.
  if (url.username || url.password || url.searchParams.has('key')) return null;
  for (const base of bases) {
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) continue;
    let key: string;
    try {
      key = decodeURIComponent(url.pathname.slice(base.pathname.length));
    } catch {
      return null;
    }
    if (!copiedKeys.has(key)) continue;
    const query = url.search ? `&${url.search.slice(1)}` : '';
    const rewritten = `/api/files/raw?key=${encodeURIComponent(key)}${query}${url.hash}`;
    return htmlEscaped ? rewritten.replaceAll('&', '&amp;') : rewritten;
  }
  return null;
}

function stripUnbalancedClosingDelimiters(value: string): string {
  let result = value;
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (;;) {
    const close = result.at(-1) ?? '';
    const open = pairs[close];
    if (!open) return result;
    const openingCount = result.split(open).length - 1;
    const closingCount = result.split(close).length - 1;
    if (closingCount <= openingCount) return result;
    result = result.slice(0, -1);
  }
}

/** Only complete URL tokens whose decoded keys are in the copy manifest change. */
export function rewriteStorageText(value: string, bases: URL[], copiedKeys: ReadonlySet<string>): string {
  const exact = rewriteUrl(value, bases, copiedKeys);
  if (exact !== null) return exact;
  return value.replace(/https?:\/\/[^\s<>"'`\\]+/gi, (token: string) => {
    let candidate = stripUnbalancedClosingDelimiters(token);
    for (;;) {
      const rewritten = rewriteUrl(candidate, bases, copiedKeys);
      if (rewritten !== null) return rewritten + token.slice(candidate.length);
      // Punctuation after a prose/Markdown URL is not part of the stored key.
      // Prefer the complete key first, so actual filenames ending in punctuation survive.
      if (!/[.,;:!?\])}]$/.test(candidate)) return token;
      candidate = candidate.slice(0, -1);
    }
  });
}

export function rewriteStorageUrls(
  value: StorageDocumentValue,
  bases: URL[],
  copiedKeys: ReadonlySet<string>,
): StorageDocumentValue {
  if (typeof value === 'string') return rewriteStorageText(value, bases, copiedKeys);
  if (Array.isArray(value)) return value.map((item) => rewriteStorageUrls(item, bases, copiedKeys));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteStorageUrls(item, bases, copiedKeys)]));
  }
  return value;
}

/** Preserve JSON formatting and number precision; rewrite string values, never property names. */
export function rewriteJsonDocumentText(value: string, bases: URL[], copiedKeys: ReadonlySet<string>): string {
  JSON.parse(value.startsWith('\uFEFF') ? value.slice(1) : value);
  return value.replace(/"(?:\\[\s\S]|[^"\\])*"/g, (token: string, offset: number) => {
    if (/^\s*:/.test(value.slice(offset + token.length))) return token;
    const decoded = JSON.parse(token) as string;
    const rewritten = rewriteStorageText(decoded, bases, copiedKeys);
    return rewritten === decoded ? token : JSON.stringify(rewritten);
  });
}
