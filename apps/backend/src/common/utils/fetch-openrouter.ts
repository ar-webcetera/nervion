import { Agent, ProxyAgent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';
import { buildProxyUrlFromEnv } from './proxy-url';

const directDispatcher = new Agent();

/** Запрос к OpenRouter: через HTTP-прокси при PROXY_ENABLE, иначе напрямую. */
export const fetchOpenRouter = (input: string | URL, init?: RequestInit): Promise<Response> => {
  const url = input.toString();
  const proxyUrl = buildProxyUrlFromEnv();

  if (proxyUrl) {
    return undiciFetch(url, {
      ...(init as UndiciRequestInit),
      dispatcher: new ProxyAgent(proxyUrl),
    }) as unknown as Promise<Response>;
  }

  return undiciFetch(url, { ...(init as UndiciRequestInit), dispatcher: directDispatcher }) as unknown as Promise<Response>;
};
