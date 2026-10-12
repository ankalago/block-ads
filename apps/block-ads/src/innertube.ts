import { hasEnforcementWall, neutralizeEnforcement } from "./enforcement.ts";
import { NEUTRALIZED_KEYS, PLAYER_RESCUE_CONFIG, PRUNE_ENDPOINTS, PRUNE_RULES } from "./innertube.config.ts";
import { PLAYER_ELEMENT_ID, type RescueStatus, rescueStatusSeed, startPlayerRescue } from "./player-rescue.ts";

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

/**
 * Si la clave ya trae el vacío de su tipo, no hay trabajo: devolver el valor original preserva la
 * referencia. Sin esto, `emptyValueOf([])` fabricaba un `[]` nuevo y la respuesta entera se
 * reconstruía y se re-serializaba aunque YouTube no hubiera programado ningún anuncio.
 */
const isAlreadyEmpty = (value: JsonValue): boolean =>
  value === "" ||
  (isJsonArray(value) && value.length === 0) ||
  (isJsonObject(value) && Object.keys(value).length === 0);

const neutralizeEntry = (key: string, value: JsonValue, keys: readonly string[]): readonly ObjectEntry[] => {
  if (!isNeutralizedKey(key, keys)) return [{ key, value: neutralizeValue(value, keys) }];
  if (isAlreadyEmpty(value)) return [{ key, value }];

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
 * Recorre un array conservando la referencia original si ningún elemento cambió. Sin esto, `map`
 * devuelve siempre un array nuevo, `neutralizeObject` lee ese cambio de identidad como "hay que
 * reconstruir" y **toda** respuesta del player se re-serializaba aunque no hubiera un solo anuncio.
 */
const neutralizeArray = (value: readonly JsonValue[], keys: readonly string[]): readonly JsonValue[] => {
  const mapped = value.map((item) => neutralizeValue(item, keys));

  return mapped.every((item, index) => item === value[index]) ? value : mapped;
};

/**
 * Neutralización conservadora y recursiva: cada clave de la config permanece presente con el
 * valor vacío de su propio tipo runtime. Devuelve la misma referencia si no cambia nada.
 */
const neutralizeValue = (value: JsonValue, keys: readonly string[]): JsonValue => {
  if (isJsonArray(value)) return neutralizeArray(value, keys);
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

/** Claves de anuncio que hay que neutralizar en ese endpoint; vacías si no se poda. */
export const neutralizationKeysFor = (url: string): readonly string[] =>
  PRUNE_RULES.find((rule) => rule.endpoint === endpointOf(url))?.keys ?? [];

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

/**
 * Tamaño de un valor de anuncio: elementos del array, claves del objeto, 1 si el string trae algo.
 * Un vacío propio (`[]`, `{}`, `""`) y los escalares valen 0: no eran un anuncio.
 */
const weightOf = (value: JsonValue): number => {
  if (isJsonArray(value)) return value.length;
  if (isJsonObject(value)) return Object.keys(value).length;
  return typeof value === "string" && value.length > 0 ? 1 : 0;
};

const countEntry = (counts: Record<string, number>, key: string, value: JsonValue, keys: readonly string[]): void => {
  const weight = keys.includes(key) ? weightOf(value) : 0;
  if (weight > 0) counts[key] = (counts[key] ?? 0) + weight;
};

const walkAdKeys = (counts: Record<string, number>, value: JsonValue, keys: readonly string[]): void => {
  if (isJsonArray(value)) {
    value.forEach((item) => {
      walkAdKeys(counts, item, keys);
    });
    return;
  }
  if (!isJsonObject(value)) return;

  Object.entries(value).forEach(([key, child]) => {
    countEntry(counts, key, child, keys);
    walkAdKeys(counts, child, keys);
  });
};

/**
 * Cuántos anuncios había **antes** de neutralizar, por clave. Sin esto no se puede distinguir
 * "neutralizamos un pre-roll" de "este vídeo no traía anuncios": el resultado final es `[]` en
 * los dos casos. Solo se registra una clave si su peso es mayor que cero.
 */
export const countAdKeys = (value: JsonValue, keys: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  walkAdKeys(counts, value, keys);

  return counts;
};

export const markAdsFound = (network: NetworkStatus, counts: Record<string, number>): void => {
  Object.entries(counts).forEach(([key, weight]) => {
    network.adsFound[key] = (network.adsFound[key] ?? 0) + weight;
  });
};

const pruneResponse = async (response: Response, url: string, network: NetworkStatus): Promise<Response> => {
  if (!response.ok || !isJsonResponse(response)) return response;

  const payload = await readJson(response.clone());
  if (payload === undefined) return response;

  const adPruned = pruneResponsePayload(url, payload);
  const restored = neutralizeEnforcement(adPruned);
  if (restored === undefined) return response;
  if (restored === payload) return response;

  markAdsFound(network, countAdKeys(payload, neutralizationKeysFor(url)));
  if (restored !== adPruned) markEnforcementRewritten(network);

  return withPrunedBody(response, restored);
};

type RequestInput = RequestInfo | URL;

const requestInputUrl = (input: RequestInput): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

const requestUrl = (url: string | URL): string => (typeof url === "string" ? url : url.href);

export const installFetchPatch = (network: NetworkStatus): void => {
  const originalFetch = window.fetch;

  window.fetch = async (input: RequestInput, init?: RequestInit): Promise<Response> => {
    const url = requestInputUrl(input);
    recordTransport(network, url);

    const response = await originalFetch(input, init);
    if (!isPrunedEndpoint(url)) return response;

    const pruned = await pruneResponse(response, url, network);
    if (pruned !== response) markNeutralized(network);

    return pruned;
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
 */ export type XhrShadow = { readonly property: "response" | "responseText"; readonly value: string | JsonValue };

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
const overrideXhrPayload = (target: XMLHttpRequest, url: string, network: NetworkStatus): void => {
  if (target.readyState !== XMLHttpRequest.DONE) return;

  const payload = xhrPayload(target);
  if (payload === undefined) return;

  const adPruned = pruneResponsePayload(url, payload);
  const restored = neutralizeEnforcement(adPruned);
  if (restored === undefined) return;
  if (restored === payload) return;

  const shadows = xhrShadows(target.responseType, restored);
  if (shadows.length === 0) return;

  shadows.forEach((shadow) => {
    defineShadow(target, shadow.property, shadow.value);
  });
  markNeutralized(network);
  markAdsFound(network, countAdKeys(payload, neutralizationKeysFor(url)));
  if (restored !== adPruned) markEnforcementRewritten(network);
};

const prunedXhrMethods = (
  originalOpen: XhrOpen,
  originalSend: XhrSend,
  urls: WeakMap<XMLHttpRequest, string>,
  network: NetworkStatus,
) => ({
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

    if (url !== undefined) {
      // Se cuenta en el envío, no en la lectura: un `readystatechange` puede dispararse más de una
      // vez y un contador duplicado invalidaría la comparación contra el timing real de la página.
      recordTransport(network, url);

      if (isPrunedEndpoint(url)) {
        this.addEventListener("readystatechange", () => overrideXhrPayload(this, url, network));
      }
    }

    originalSend.call(this, body);
  },
});

export const installXhrPatch = (network: NetworkStatus): void => {
  const urls = new WeakMap<XMLHttpRequest, string>();
  const methods = prunedXhrMethods(XMLHttpRequest.prototype.open, XMLHttpRequest.prototype.send, urls, network);

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
 * El resto es la telemetría del rescate del player, etapa por etapa (§21): si un campo nuevo falta
 * en el paste del usuario, el build en el tab está desactualizado.
 */
export type CarrierStatus = RescueStatus & {
  accessorInstalled: boolean;
  carrierPruned: boolean;
  /** El server mandó el muro de enforcement en el carrier y la regla lo reescribió a OK. */
  wallRewritten: boolean;
};

/** Única forma del portador que nos interesa; `window` la cumple, un objeto llano de test también. */
export type CarrierHost = { ytInitialPlayerResponse?: JsonValue };

/**
/**
 * Contadores del transport parcheado. Sirven para una sola pregunta que el HTML no responde:
 * ¿la petición de `player` pasó por este realm? Con `seen > 0` y `matched === 0` mientras el
 * timing de la página sí muestra llamadas a `/youtubei/v1/player`, el parche está vivo pero la
 * página usa otro realm (fetch limpio de un iframe): un bypass, no un fallo del código.
 */
export type NetworkStatus = {
  seen: number;
  matched: number;
  neutralized: number;
  /** Veces que el transport reescribió un muro de enforcement (regla aparte de la poda). */
  enforcement: number;
  adsFound: Record<string, number>;
  matchedPaths: string[];
};

/** Techo de rutas guardadas: suficiente para leer la serie, acotado para no crecer sin límite. */
export const MAX_MATCHED_PATHS = 8;

export const NETWORK_STATUS_KEY = "__blockAdsNetwork";
export const networkStatusSeed = (): NetworkStatus => ({
  seen: 0,
  matched: 0,
  neutralized: 0,
  enforcement: 0,
  adsFound: {},
  matchedPaths: [],
});

/** Registra una petición que efectivamente pasó por el transport parcheado, al momento de enviarla. */
export const recordTransport = (network: NetworkStatus, url: string): void => {
  network.seen += 1;

  const endpoint = endpointOf(url);
  if (!isPrunedEndpoint(endpoint)) return;

  network.matched += 1;
  network.matchedPaths = [endpoint, ...network.matchedPaths].slice(0, MAX_MATCHED_PATHS);
};

/** Suma una respuesta realmente reconstruida; `matched` sin `neutralized` es forma, no éxito. */
export const markNeutralized = (network: NetworkStatus): void => {
  network.neutralized += 1;
};

/** Cuenta un muro de enforcement reescrito en el transport, causa distinta de la poda de anuncios. */
export const markEnforcementRewritten = (network: NetworkStatus): void => {
  network.enforcement += 1;
};

declare global {
  interface Window {
    ytInitialPlayerResponse?: JsonValue;
    __blockAdsInnerTube?: CarrierStatus;
    __blockAdsNetwork?: NetworkStatus;
  }
}

export const carrierStatusSeed = (): CarrierStatus => ({
  ...rescueStatusSeed(),
  accessorInstalled: false,
  carrierPruned: false,
  wallRewritten: false,
});

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
 * Neutraliza el valor crudo del carrier y cuenta cuántos anuncios había antes de vaciarlo. Contar
 * acá es el punto: el pre-roll de la primera carga no viene de `fetch` sino de este carrier inline,
 * y sin este conteo `adsFound` se quedaría en `{}` aunque acabáramos de matar un anuncio.
 */
const healRaw = (
  host: CarrierHost,
  raw: JsonValue | undefined,
  keys: readonly string[],
  status: CarrierStatus,
  network: NetworkStatus,
): void => {
  if (isJsonObject(raw)) {
    markAdsFound(network, countAdKeys(raw, keys));
    if (hasEnforcementWall(raw)) status.wallRewritten = true;
  }

  healOrReport(host, neutralizeEnforcement(initialResponseValue(raw, keys)), status);
};

/**
 * Usa el accesorio como **trampa de una sola escritura**: intercepta la asignación del `<script>`
 * inline, neutraliza, y devuelve la propiedad a su forma de data property. Un accesorio permanente
 * se detecta con `Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse')`; este no queda.
 *
 * Si la página ya declaró el carrier, `var` lo deja writable: se neutraliza sobrescribiendo el valor
 * sin tocar el descriptor. Si además fuera no-writable no hay forma de neutralizar sin romper la
 * página y se informa sin instalar nada. El retorno dice si se instaló la trampa, no si se neutralizó.
 */
export const shadowInlineCarrier = (
  host: CarrierHost,
  keys: readonly string[],
  status: CarrierStatus,
  network: NetworkStatus = networkStatusSeed(),
): boolean => {
  const existing = host.ytInitialPlayerResponse;

  if (existing !== undefined) {
    healRaw(host, existing, keys, status, network);

    return false;
  }

  try {
    Object.defineProperty(host, INLINE_CARRIER, {
      configurable: true,
      enumerable: true,
      get: () => undefined,
      set: (raw: JsonValue | undefined) => healRaw(host, raw, keys, status, network),
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

  const network = networkStatusSeed();

  installFetchPatch(network);
  installXhrPatch(network);

  window[NETWORK_STATUS_KEY] = network;

  const status = carrierStatusSeed();
  // La telemetría se publica siempre: el token de URL se perdía en navegaciones internas de
  // YouTube y dejaba la diagnosis cieca (paste con ESTADO undefined). El coste son dos claves
  // de window en una extensión en desarrollo; ninguna decisión de bloqueo depende de ellas.
  window.__blockAdsInnerTube = status;
  shadowInlineCarrier(window, NEUTRALIZED_KEYS, status, network);

  // El player puede amanecer con el muro aunque el carrier haya salido limpio (la página reasigna
  // el carrier después de la trampa); sin document (vm/tests) no hay player que interrogar. Los
  // nudges corren fuera de la cadena de timers porque Chrome congela los timers de tabs en segundo
  // plano por completo: al volver el foco y al intentar reproducir, se interroga al player al acto.
  if (typeof document !== "undefined") {
    startPlayerRescue(
      () => document.getElementById(PLAYER_ELEMENT_ID) ?? undefined,
      (player, videoId) => player.loadVideoById?.(videoId),
      status,
      PLAYER_RESCUE_CONFIG,
      (handler) => {
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") handler();
        });
        // `play` no burbujea; en captura el document lo recibe igual. Cualquier gesto del usuario
        // (pointerdown en captura) también interroga: un tab oculto puede congelar los timers
        // aunque el usuario esté tocando la página o la pared.
        document.addEventListener("play", handler, true);
        document.addEventListener("pointerdown", handler, true);
      },
    );
  }

  return status;
};

installInnerTubePatch();
