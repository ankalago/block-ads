import { PROTECTED_KEYS, PRUNE_ENDPOINTS, PRUNE_RULES } from "./innertube.config.ts";

/** JSON de una respuesta de InnerTube: el árbol que recorre la poda. */
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

const isJsonObject = (value: JsonValue): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJsonArray = (value: unknown): value is readonly JsonValue[] => Array.isArray(value);

const isPrunedKey = (key: string, keys: readonly string[]): boolean =>
  keys.includes(key) && !PROTECTED_KEYS.includes(key);

const pruneObject = (source: JsonObject, keys: readonly string[]): JsonObject => {
  const entries = Object.entries(source);
  const kept = entries.filter(([key]) => !isPrunedKey(key, keys));
  const pruned = kept.map(([key, value]) => ({ key, value: pruneValue(value, keys) }));
  const changed = kept.length !== entries.length || pruned.some((item, index) => item.value !== kept[index]?.[1]);

  return changed ? Object.fromEntries(pruned.map((item) => [item.key, item.value] as const)) : source;
};

/**
 * Poda conservadora y recursiva: solo desaparecen las claves de la config de poda
 * (nunca `adBreakHeartbeatParams`). Devuelve la misma referencia si no cambia nada.
 */
const pruneValue = (value: JsonValue, keys: readonly string[]): JsonValue => {
  if (isJsonArray(value)) return value.map((item) => pruneValue(item, keys));
  if (isJsonObject(value)) return pruneObject(value, keys);
  return value;
};

export const pruneAdKeys = (payload: JsonValue, keys: readonly string[]): JsonValue => pruneValue(payload, keys);

const PRUNED_ENDPOINTS: ReadonlySet<string> = new Set(PRUNE_ENDPOINTS);

/** Ruta del endpoint, tolerando URLs relativas (`/youtubei/v1/player`) y query string. */
const endpointOf = (url: string): string => {
  try {
    return new URL(url, "https://www.youtube.com").pathname;
  } catch {
    return url;
  }
};

export const isPrunedEndpoint = (url: string): boolean => PRUNED_ENDPOINTS.has(endpointOf(url));

export const pruneResponsePayload = (url: string, payload: JsonValue): JsonValue => {
  const endpoint = endpointOf(url);
  const rule = PRUNE_RULES.find((candidate) => candidate.endpoint === endpoint);

  return rule === undefined ? payload : pruneAdKeys(payload, rule.keys);
};

const JSON_CONTENT_TYPE = "application/json";

const isJsonResponse = (response: Response): boolean =>
  (response.headers.get("content-type") ?? "").includes(JSON_CONTENT_TYPE);

/** `JSON.parse` no está tipado, así que se declara el árbol en el borde, no en la poda. */
const readJson = async (response: Response): Promise<JsonValue | undefined> => {
  try {
    const payload: JsonValue = await response.json();
    return payload;
  } catch {
    return undefined;
  }
};

const parseJsonText = (text: string): JsonValue | undefined => {
  try {
    const payload: JsonValue = JSON.parse(text);
    return payload;
  } catch {
    return undefined;
  }
};

/** Reconstruye la respuesta con el JSON podado; las cabeceras del cuerpo viejo se descartan. */
const withPrunedBody = (response: Response, payload: JsonValue): Response => {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");

  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const pruneResponse = async (response: Response, url: string): Promise<Response> => {
  if (!response.ok || !isJsonResponse(response)) return response;

  const payload = await readJson(response.clone());
  if (payload === undefined) return response;

  const pruned = pruneResponsePayload(url, payload);
  return pruned === payload ? response : withPrunedBody(response, pruned);
};

type RequestInput = RequestInfo | URL;

const requestInputUrl = (input: RequestInput): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

const requestUrl = (url: string | URL): string => (typeof url === "string" ? url : url.href);

export const installFetchPatch = (): void => {
  const originalFetch = window.fetch;

  window.fetch = async (input: RequestInput, init?: RequestInit): Promise<Response> => {
    const url = requestInputUrl(input);
    const response = await originalFetch(input, init);

    return isPrunedEndpoint(url) ? pruneResponse(response, url) : response;
  };
};

type XhrOpen = (
  method: string,
  url: string | URL,
  async?: boolean,
  username?: string | null,
  password?: string | null,
) => void;

type XhrSend = (body?: Document | XMLHttpRequestBodyInit | null) => void;

const xhrPayload = (target: XMLHttpRequest): JsonValue | undefined => {
  if (target.responseType === "json") return target.response;
  return target.responseType === "" || target.responseType === "text" ? parseJsonText(target.responseText) : undefined;
};

const defineShadow = (target: XMLHttpRequest, property: string, value: string | JsonValue): void => {
  Object.defineProperty(target, property, { configurable: true, get: () => value });
};

/**
 * Decide qué propiedades hay que sombrear en un XHR terminado. Pura y sin DOM a propósito:
 * el error clásico aquí es sombrear `responseText` y dejar `response` intacto, que es lo que
 * la página lee cuando `responseType === "json"`, y el parche no bloquearía nada.
 */
export type XhrShadow = { readonly property: "response" | "responseText"; readonly value: string | JsonValue };

export const xhrShadows = (responseType: string, pruned: JsonValue): readonly XhrShadow[] => {
  const body = JSON.stringify(pruned);

  if (responseType === "json") return [{ property: "response", value: pruned }];
  if (responseType === "" || responseType === "text")
    return [
      { property: "responseText", value: body },
      { property: "response", value: body },
    ];

  return [];
};

/**
 * XHR no expone el cuerpo parseado, así que se sombrean `response`/`responseText` solo en las
 * respuestas de player/next ya terminadas (`readyState === DONE`). Con `responseType` binario
 * (`arraybuffer`/`blob`) no hay forma de sombrear un string: se informa y no se poda.
 */
const overrideXhrPayload = (target: XMLHttpRequest, url: string): void => {
  if (target.readyState !== XMLHttpRequest.DONE) return;

  const payload = xhrPayload(target);
  if (payload === undefined) return;

  const pruned = pruneResponsePayload(url, payload);
  if (pruned === payload) return;

  xhrShadows(target.responseType, pruned).forEach((shadow) => {
    defineShadow(target, shadow.property, shadow.value);
  });
};

const prunedXhrMethods = (originalOpen: XhrOpen, originalSend: XhrSend, urls: WeakMap<XMLHttpRequest, string>) => ({
  // Métodos (no funciones flecha) porque necesitan el `this` de la instancia que envuelven.
  open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    urls.set(this, requestUrl(url));
    originalOpen.call(this, method, url, async, username, password);
  },

  send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
    const url = urls.get(this);

    if (url !== undefined && isPrunedEndpoint(url)) {
      this.addEventListener("readystatechange", () => overrideXhrPayload(this, url));
    }

    originalSend.call(this, body);
  },
});

export const installXhrPatch = (): void => {
  const urls = new WeakMap<XMLHttpRequest, string>();
  const methods = prunedXhrMethods(XMLHttpRequest.prototype.open, XMLHttpRequest.prototype.send, urls);

  XMLHttpRequest.prototype.open = methods.open;
  XMLHttpRequest.prototype.send = methods.send;
};

/**
 * Se ejecuta al inyectarse el bundle de MAIN world; sin `window` (tests en Node) no hay nada
 * que envolver. Sin `eval` ni `new Function`: la CSP de YouTube los bloquearía.
 */
export const installInnerTubePatch = (): void => {
  if (typeof window === "undefined") return;

  installFetchPatch();
  installXhrPatch();
};

installInnerTubePatch();
