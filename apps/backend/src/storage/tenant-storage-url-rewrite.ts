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

function rewriteUrl(value: string, bases: URL[], copiedKeys: ReadonlySet<string>, allowSpaces = false): string | null {
  // Encode literal spaces before URL parsing so trailing filename spaces cannot
  // be trimmed into a different, otherwise valid manifest key.
  const candidate = allowSpaces ? value.replace(/\p{Zs}/gu, (space: string) => encodeURIComponent(space)) : value;
  if (
    !/^https?:\/\//i.test(candidate) ||
    /[\s<>"\\]/.test(candidate) ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return null;
  const htmlEscaped = value.includes('&amp;');
  let url: URL;
  try {
    url = new URL(htmlEscaped ? candidate.replaceAll('&amp;', '&') : candidate);
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

function rewriteTextTokens(value: string, bases: URL[], copiedKeys: ReadonlySet<string>): string {
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

/** Only complete scalar URLs, quoted HTML URL attributes and known text tokens change. */
export function rewriteStorageText(value: string, bases: URL[], copiedKeys: ReadonlySet<string>): string {
  const exact = rewriteUrl(value, bases, copiedKeys, true);
  if (exact !== null) return exact;
  // A whitespace-bearing scalar URL without an exact manifest match must not
  // accidentally rewrite a shorter existing filename before its first space.
  if (/^https?:\/\//i.test(value) && /\s/.test(value)) return value;

  // Preserve markup byte-for-byte. Quotes delimit URL attributes, not arbitrary
  // prose; comments and raw-text elements must not be treated as nested tags.
  const markup =
    /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b(?:"[^"]*"|'[^']*'|[^'"<>])*>[\s\S]*?(?:<\/\1\s*>|$)|<[a-z][a-z0-9:-]*(?:"[^"]*"|'[^']*'|[^'"<>])*>/gi;
  let cursor = 0;
  let result = '';
  for (const match of value.matchAll(markup)) {
    result += rewriteTextTokens(value.slice(cursor, match.index), bases, copiedKeys);
    const tag = match[0];
    result +=
      tag.startsWith('<!--') || match[1]
        ? tag
        : tag.replace(
            /(\s+([^\s"'<>/=]+)\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g,
            (attribute: string, prefix: string, name: string, serialized: string) => {
              if (!/^(href|src|poster)$/i.test(name)) return attribute;
              const quote = serialized[0];
              if (quote !== '"' && quote !== "'") {
                const rewritten = rewriteUrl(serialized, bases, copiedKeys);
                return rewritten === null ? attribute : `${prefix}${rewritten}`;
              }
              const rewritten = rewriteUrl(serialized.slice(1, -1), bases, copiedKeys, true);
              return rewritten === null ? attribute : `${prefix}${quote}${rewritten}${quote}`;
            },
          );
    cursor = match.index + tag.length;
  }
  return result + rewriteTextTokens(value.slice(cursor), bases, copiedKeys);
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
