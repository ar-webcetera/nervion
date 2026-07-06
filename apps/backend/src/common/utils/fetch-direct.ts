import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';

const directDispatcher = new Agent();

/** HTTP-запрос в обход глобального ProxyAgent (см. main.ts, PROXY_ENABLE). */
export const fetchDirect = (input: string | URL, init?: RequestInit): Promise<Response> => {
  const url = input.toString();
  return undiciFetch(url, { ...(init as UndiciRequestInit), dispatcher: directDispatcher }) as unknown as Promise<Response>;
};
