/**
 * Утилита для безопасного формирования полных URL из базового адреса и пути
 * Следует правилам ADR-2: URL Conventions
 *
 * @param slug - Путь к ресурсу (должен начинаться с /)
 * @param baseUrl - Базовый URL (без завершающего /)
 * @returns Полный URL
 *
 * @example
 * resolveUrl('/path/to/file.jpg', 'https://example.com')
 * // => 'https://example.com/path/to/file.jpg'
 */
export const resolveUrl = (slug: string | null | undefined, baseUrl?: string): string | undefined => {
  if (!slug) return undefined;

  if (slug.startsWith('http://') || slug.startsWith('https://')) {
    return slug;
  }

  if (!baseUrl) {
    return slug;
  }

  try {
    const url = new URL(slug, baseUrl);
    return url.toString();
  } catch (error) {
    console.error('Failed to resolve URL:', { slug, baseUrl, error });
    return slug;
  }
};

/**
 * Строит публичный URL для объекта в S3-совместимом хранилище.
 *
 * В отличие от `resolveUrl`, эта функция сначала кодирует каждый сегмент ключа
 * через `encodeURIComponent`, а потом уже собирает абсолютный URL.
 * Это нужно для ключей с пробелами, `+`, кириллицей и другими символами,
 * которые ломают прямую конкатенацию вида `${AWS_ENDPOINT}/${key}`.
 *
 * @param key - S3 object key, например `uploads/Фото+отчет 1.png`
 * @param awsEndpoint - Базовый endpoint бакета/CDN без завершающего `/`
 * @returns Полный публичный URL до объекта или исходный key, если endpoint не задан
 *
 * @example
 * buildAwsObjectUrl('uploads/Фото+отчет 1.png', 'https://cdn.example.com')
 * // => 'https://cdn.example.com/uploads/%D0%A4%D0%BE%D1%82%D0%BE%2B%D0%BE%D1%82%D1%87%D0%B5%D1%82%201.png'
 */
export const buildAwsObjectUrl = (key: string | null | undefined, awsEndpoint?: string): string | undefined => {
  if (!key) return undefined;
  if (!awsEndpoint) return key;

  const normalizedKey = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return resolveUrl(`/${normalizedKey}`, awsEndpoint);
};

/**
 * Composable для использования в компонентах Vue
 * Автоматически использует AWS_ENDPOINT из runtimeConfig.
 * Для S3-ключей внутри вызывает `buildAwsObjectUrl`, а абсолютные `http/https`
 * ссылки возвращает как есть через `resolveUrl`.
 *
 * @example
 * const { resolveAwsUrl } = useResolveUrl();
 * const imageUrl = resolveAwsUrl(card.coverImage);
 */
export const useResolveUrl = () => {
  const config = useRuntimeConfig();
  const awsEndpoint = config.public.AWS_ENDPOINT;

  const resolveAwsUrl = (slug: string | null | undefined): string | undefined => {
    return slug?.startsWith('http://') || slug?.startsWith('https://')
      ? resolveUrl(slug, awsEndpoint)
      : buildAwsObjectUrl(slug, awsEndpoint);
  };

  return {
    buildAwsObjectUrl,
    resolveAwsUrl,
    resolveUrl,
  };
};
