/**
 * Принимает любой текст и возвращает транслитерированный текст,
 * содержащий только латинские буквы, тире, нижнее подчеркивание и цифры.
 * Все пробелы и другие знаки удаляются.
 */

function slugify(text: string): string {
  const transliterationMap: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'yo',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'kh',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'shch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
    ә: 'ae',
    ғ: 'gh',
    қ: 'q',
    ң: 'ng',
    ө: 'oe',
    ұ: 'u',
    ү: 'ue',
    һ: 'h',
    і: 'i',
  };

  const lowercaseText = text.toLowerCase();
  let slug = '';

  for (let i = 0; i < lowercaseText.length; i += 1) {
    const char = lowercaseText[i];
    const transliteratedChar = transliterationMap[char] || char;
    const isAlphanumeric = /[a-z0-9]/.test(transliteratedChar);
    const isSeparator = /[ -]/.test(transliteratedChar);

    if (isAlphanumeric) {
      slug += transliteratedChar;
    } else if (isSeparator && slug[slug.length - 1] !== '_') {
      slug += '_';
    }
  }

  return slug;
}

export default slugify;
