export const DEFAULT_NO_PROXY = 'localhost,127.0.0.1,.local';

const DEFAULT_PROXY_PROTOCOL = 'http';

const isEnabled = (value: string | undefined) => Number(value) === 1;

export const buildProxyUrlFromEnv = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const directProxyUrl = env.HTTPS_PROXY || env.HTTP_PROXY;

  if (directProxyUrl) {
    return directProxyUrl;
  }

  if (!isEnabled(env.PROXY_ENABLE)) {
    return null;
  }

  const host = env.PROXY_HOST;
  const port = env.PROXY_PORT;

  if (!host || !port) {
    return null;
  }

  const protocol = env.PROXY_PROTOCOL || DEFAULT_PROXY_PROTOCOL;
  const user = env.PROXY_USER || '';
  const pass = env.PROXY_PASS || '';

  if (user && pass) {
    const encodedUser = encodeURIComponent(user);
    const encodedPass = encodeURIComponent(pass);

    return `${protocol}://${encodedUser}:${encodedPass}@${host}:${port}`;
  }

  return `${protocol}://${host}:${port}`;
};
