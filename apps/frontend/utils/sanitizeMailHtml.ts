import sanitizeHtml from 'sanitize-html';

const MAIL_HTML_TAGS = [
  'a',
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'caption',
  'center',
  'code',
  'col',
  'colgroup',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  's',
  'section',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
];

const CSS_LENGTH = /^(?:auto|0|[-+]?\d*\.?\d+(?:px|pt|pc|em|rem|%|vh|vw)?)(?:\s*!important)?$/i;
const CSS_COLOR = /^(?:transparent|currentcolor|#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+-]+\)|[a-z-]+)(?:\s*!important)?$/i;
const CSS_BORDER = /^[\w\s#(),.%/+-]+(?:\s*!important)?$/i;

const allowedStyles = {
  '*': {
    color: [CSS_COLOR],
    'background-color': [CSS_COLOR],
    'font-family': [/^[-\w\s'",]+(?:\s*!important)?$/i],
    'font-size': [CSS_LENGTH],
    'font-style': [/^(?:normal|italic|oblique)(?:\s*!important)?$/i],
    'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)(?:\s*!important)?$/i],
    'line-height': [CSS_LENGTH],
    'letter-spacing': [CSS_LENGTH],
    'text-align': [/^(?:left|right|center|justify|start|end)(?:\s*!important)?$/i],
    'text-decoration': [/^[\w\s-]+(?:\s*!important)?$/i],
    'text-transform': [/^(?:none|capitalize|uppercase|lowercase)(?:\s*!important)?$/i],
    'vertical-align': [
      /^(?:baseline|sub|super|top|text-top|middle|bottom|text-bottom|[-+]?\d*\.?\d+(?:px|pt|em|%))(?:\s*!important)?$/i,
    ],
    'white-space': [/^(?:normal|pre|pre-wrap|pre-line|break-spaces)(?:\s*!important)?$/i],
    'word-break': [/^(?:normal|break-all|keep-all|break-word)(?:\s*!important)?$/i],
    'overflow-wrap': [/^(?:normal|break-word|anywhere)(?:\s*!important)?$/i],
    display: [/^(?:none|block|inline|inline-block|table|table-row|table-cell|flex)(?:\s*!important)?$/i],
    float: [/^(?:none|left|right)(?:\s*!important)?$/i],
    width: [CSS_LENGTH],
    'min-width': [CSS_LENGTH],
    'max-width': [CSS_LENGTH],
    height: [CSS_LENGTH],
    'min-height': [CSS_LENGTH],
    'max-height': [CSS_LENGTH],
    margin: [CSS_BORDER],
    'margin-top': [CSS_LENGTH],
    'margin-right': [CSS_LENGTH],
    'margin-bottom': [CSS_LENGTH],
    'margin-left': [CSS_LENGTH],
    padding: [CSS_BORDER],
    'padding-top': [CSS_LENGTH],
    'padding-right': [CSS_LENGTH],
    'padding-bottom': [CSS_LENGTH],
    'padding-left': [CSS_LENGTH],
    border: [CSS_BORDER],
    'border-top': [CSS_BORDER],
    'border-right': [CSS_BORDER],
    'border-bottom': [CSS_BORDER],
    'border-left': [CSS_BORDER],
    'border-width': [CSS_BORDER],
    'border-style': [/^[\w\s-]+(?:\s*!important)?$/i],
    'border-color': [CSS_BORDER],
    'border-radius': [CSS_BORDER],
    'border-collapse': [/^(?:collapse|separate)(?:\s*!important)?$/i],
    'border-spacing': [CSS_BORDER],
    'table-layout': [/^(?:auto|fixed)(?:\s*!important)?$/i],
  },
};

const SAFE_INLINE_IMAGE = /^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]+$/i;

interface SanitizeMailHtmlOptions {
  disableLinks?: boolean;
}

export const sanitizeMailHtml = (html: string, options: SanitizeMailHtmlOptions = {}): string => {
  const sanitizeOptions: NonNullable<Parameters<typeof sanitizeHtml>[1]> = {
    allowedTags: MAIL_HTML_TAGS,
    allowedAttributes: {
      '*': ['style', 'title', 'dir', 'lang', 'align', 'valign', 'role', 'aria-label'],
      a: ['href', 'name', 'target', 'rel', 'title', 'aria-disabled', 'tabindex', 'data-link-disabled'],
      blockquote: ['cite'],
      col: ['span', 'width'],
      colgroup: ['span', 'width'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding', 'referrerpolicy'],
      table: ['width', 'height', 'cellpadding', 'cellspacing', 'border', 'align', 'summary'],
      td: ['width', 'height', 'colspan', 'rowspan', 'align', 'valign', 'bgcolor'],
      th: ['width', 'height', 'colspan', 'rowspan', 'align', 'valign', 'bgcolor', 'scope'],
    },
    allowedStyles,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'cid', 'data'],
    },
    allowProtocolRelative: false,
    enforceHtmlBoundary: false,
    nestingLimit: 100,
    transformTags: {
      a: (_tagName, attributes) => {
        const nextAttributes = { ...attributes };
        if (options.disableLinks) {
          delete nextAttributes.href;
          delete nextAttributes.target;
          delete nextAttributes.rel;
          nextAttributes['aria-disabled'] = 'true';
          nextAttributes['data-link-disabled'] = 'true';
          nextAttributes.tabindex = '-1';
          nextAttributes.title = 'Ссылки отключены для писем в спаме';
        } else if (nextAttributes.href) {
          nextAttributes.target = '_blank';
          nextAttributes.rel = 'noopener noreferrer';
        }

        return { tagName: 'a', attribs: nextAttributes };
      },
      img: (_tagName, attributes) => {
        const nextAttributes = { ...attributes };
        if (nextAttributes.src?.startsWith('data:') && !SAFE_INLINE_IMAGE.test(nextAttributes.src)) {
          delete nextAttributes.src;
        }
        nextAttributes.alt ??= '';
        nextAttributes.loading = 'lazy';
        nextAttributes.decoding = 'async';
        nextAttributes.referrerpolicy = 'no-referrer';
        return { tagName: 'img', attribs: nextAttributes };
      },
    },
  };

  return sanitizeHtml(html, sanitizeOptions);
};
