import { NEUTRALIZED_KEYS, PRUNE_ENDPOINTS, PRUNE_RULES } from "./innertube.config.ts";

/** JSON de una respuesta de InnerTube: el árbol que recorre la neutralización. */
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJsonArray = (value: unknown): value is readonly JsonValue[] => Array.isArray(value);

const isNeutralizedKey = (key: string, keys: readonly string[]): boolean => keys.includes(key);

/**
 * Valor vacío del mismo tipo runtime que el original: array vacío, objeto vacío o string vacío.
 * `number`, `boolean` y `null` no tienen un vacío honesto, así que devuelven `undefined` y la clave
 * se elimina (fallback documentado y pinneado por test).
 */
const emptyValueOf = (value: JsonValue): JsonValue | undefined => {
  if (isJsonArray(value)) return [];
  if (isJsonObject(value)) return {};
  if (typeof value === "string") return "";
  return undefined;
};

type ObjectEntry = { readonly key: string; readonly value: JsonValue };

const neutralizeEntry = (key: string, value: JsonValue, keys: readonly string[]): readonly ObjectEntry[] => {
  if (!isNeutralizedKey(key, keys)) return [{ key, value: neutralizeValue(value, keys) }];

  const empty = emptyValueOf(value);

  return empty === undefined ? [] : [{ key, value: empty }];
};

const neutralizeObject = (source: JsonObject, keys: readonly string[]): JsonObject => {
  const entries = Object.entries(source);
  const neutralized = entries.flatMap(([key, value]) => neutralizeEntry(key, value, keys));
  const changed =
    neutralized.length !== entries.length || neutralized.some((item, index) => item.value !== entries[index]?.[1]);

  return changed ? Object.fromEntries(neutralized.map((item) => [item.key, item.value] as const)) : source;
};

/**
 * Neutralización conservadora y recursiva: cada clave de la config permanece presente con el
 * valor vacío de su propio tipo runtime. Devuelve la misma referencia si no cambia nada.
 */
const neutralizeValue = (value: JsonValue, keys: readonly string[]): JsonValue => {
  if (isJsonArray(value)) return value.map((item) => neutralizeValue(item, keys));
  if (isJsonObject(value)) return neutralizeObject(value, keys);
  return value;
};

export const neutralizeAdKeys = (payload: JsonValue, keys: readonly string[]): JsonValue =>
  neutralizeValue(payload, keys);

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

  return rule === undefined ? payload : neutralizeAdKeys(payload, rule.keys);
};

const JSON_CONTENT_TYPE = "application/json";

const isJsonResponse = (response: Response): boolean =>
  (response.headers.get("content-type") ?? "").includes(JSON_CONTENT_TYPE);

/** `JSON.parse` no está tipado, así que se declara el árbol en el borde, no en la neutralización. */
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

/** Reconstruye la respuesta con el JSON neutralizado; las cabeceras del cuerpo viejo se descartan. */
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
 * (`arraybuffer`/`blob`) no hay forma de sombrear un string: se informa y no se neutraliza.
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
 * El carrier inline del watch page: el HTML trae `var ytInitialPlayerResponse = {…}`, así que la
 * primera respuesta nunca pasa por `fetch` ni por XHR y la neutralización de red no la ve.
 */
export const INLINE_CARRIER = "ytInitialPlayerResponse";

/**
 * Lo que el scriptlet publica en la página para que una carrera perdida sea verificable a mano.
 * `accessorInstalled`: se ganó la carrera y se instaló la trampa de una sola escritura.
 * `carrierPruned`: el carrier terminó neutralizado, por la trampa o por sobrescritura directa.
 */
export type CarrierStatus = { accessorInstalled: boolean; carrierPruned: boolean };

/** Única forma del portador que nos interesa; `window` la cumple, un objeto llano de test también. */
export type CarrierHost = { ytInitialPlayerResponse?: JsonValue };

/**
 * Telemetría opt-in: el estado solo se publica si la URL trae este token, porque un global legible
 * por la página es una huella que cualquier script de YouTube puede comprobar.
 */
export const DEBUG_PARAM = "blockadsdebug";

export const shouldPublishStatus = (search: string): boolean => search.includes(DEBUG_PARAM);

declare global {
  interface Window {
    ytInitialPlayerResponse?: JsonValue;
    __blockAdsInnerTube?: CarrierStatus;
  }
}

export const carrierStatusSeed = (): CarrierStatus => ({ accessorInstalled: false, carrierPruned: false });

/**
 * La forma que produce un `var ytInitialPlayerResponse = {…}` a nivel global en la página: dato
 * writable y enumerable, no configurable. Se restaura exactamente así para no dejar huella.
 */
const PAGE_VAR_DESCRIPTOR = { writable: true, enumerable: true, configurable: false } as const;

const healCarrier = (host: CarrierHost, value: JsonValue | undefined, status: CarrierStatus): void => {
  Object.defineProperty(host, INLINE_CARRIER, { ...PAGE_VAR_DESCRIPTOR, value });
  status.carrierPruned = true;
};

/**
 * Solo se neutraliza si el valor es un objeto JSON, que es lo que la página serializa ahí.
 * Cualquier otro valor pasa intacto: romperlo rompería la página.
 */
export const initialResponseValue = (raw: JsonValue | undefined, keys: readonly string[]): JsonValue | undefined =>
  isJsonObject(raw) ? neutralizeAdKeys(raw, keys) : raw;

/**
 * Usa el accesorio como **trampa de una sola escritura**: intercepta la asignación del `<script>`
 * inline, neutraliza, y devuelve la propiedad a su forma de data property. Un accesorio permanente
 * se detecta con `Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse')`; este no queda.
 *
 * Si la página ya declaró el carrier, `var` lo deja writable: se neutraliza sobrescribiendo el valor
 * sin tocar el descriptor. Si además fuera no-writable no hay forma de neutralizar sin romper la
 * página y se informa sin instalar nada. El retorno dice si se instaló la trampa, no si se neutralizó.
 */
export const shadowInlineCarrier = (host: CarrierHost, keys: readonly string[], status: CarrierStatus): boolean => {
  const existing = host.ytInitialPlayerResponse;

  if (existing !== undefined) {
    healOrReport(host, initialResponseValue(existing, keys), status);

    return false;
  }

  try {
    Object.defineProperty(host, INLINE_CARRIER, {
      configurable: true,
      enumerable: true,
      get: () => undefined,
      set: (raw: JsonValue | undefined) => healCarrier(host, initialResponseValue(raw, keys), status),
    });
    status.accessorInstalled = true;

    return true;
  } catch {
    return false;
  }
};

const healOrReport = (host: CarrierHost, value: JsonValue | undefined, status: CarrierStatus): void => {
  try {
    healCarrier(host, value, status);
  } catch {
    // Propiedad no configurable y no writable: no hay forma de neutralizar sin romper la página.
  }
};

/**
 * Se ejecuta al inyectarse el bundle de MAIN world; sin `window` (tests en Node) no hay nada que
 * envolver y se informa como no neutralizado. Sin `eval` ni `new Function`: la CSP de YouTube los bloquea.
 */
export const installInnerTubePatch = (): CarrierStatus => {
  if (typeof window === "undefined") return carrierStatusSeed();

  installFetchPatch();
  installXhrPatch();

  const status = carrierStatusSeed();
  if (shouldPublishStatus(window.location.search)) window.__blockAdsInnerTube = status;
  shadowInlineCarrier(window, NEUTRALIZED_KEYS, status);

  return status;
};

installInnerTubePatch();
