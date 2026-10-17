export const PRUNE_ENDPOINTS = ["/youtubei/v1/player", "/youtubei/v1/next", "/youtubei/v1/get_watch"] as const;
export type PruneEndpoint = (typeof PRUNE_ENDPOINTS)[number];

/**
 * Claves de anuncio de las respuestas de InnerTube: se conservan presentes con el valor vacío de su
 * propio tipo runtime (`[]`, `{}` o `""`). `adBreakHeartbeatParams` se preserva intacto (aparece
 * incluso en vídeos sin anuncios, §1, y tocarlo reconstruye todas las respuestas limpias).
 */
export const NEUTRALIZED_KEYS: readonly string[] = ["adPlacements", "adSlots", "playerAds"];

export type PruneRule = {
  readonly endpoint: PruneEndpoint;
  readonly keys: readonly string[];
};

/**
 * Config de poda embebida en el bundle en build time: un script en MAIN world no tiene
 * `chrome.runtime`, así que no puede pedir reglas al service worker en runtime.
 */
export const PRUNE_RULES: readonly PruneRule[] = PRUNE_ENDPOINTS.map((endpoint) => ({
  endpoint,
  keys: NEUTRALIZED_KEYS,
}));

/**
 * Rescate del player: si el player amanece con el muro de enforcement (la página reasigna
 * `window.ytInitialPlayerResponse` después de nuestra trampa de una sola escritura), se le pide una
 * respuesta fresca con `loadVideoById` — la única vía que la medición en vivo vio reproducir de
 * punta a punta: respuesta limpia y sesión SABR nueva. Acotado: a lo sumo dos rescates por página,
 * con espera entre intentos. La medición en Chrome real (13e0673) mostró que el muro llega TARDE:
 * la respuesta del player estuvo limpia durante los primeros 8 s y el muro apareció minutos
 * después, sin pasar por el transporte visible. Por eso la vigía vive minutos — `watchMs` desde
 * que el player se ve por primera vez (los ticks en segundo plano disparan ~1/min y alcanzan para
 * verlo) y `absoluteMs` como techo absoluto desde la instalación. Nada de bucles infinitos.
 */
export const PLAYER_RESCUE_CONFIG = {
  intervalMs: 1000,
  watchMs: 600000,
  absoluteMs: 900000,
  maxAttempts: 2,
  retryGapMs: 2000,
} as const;
export type PlayerRescueConfig = typeof PLAYER_RESCUE_CONFIG;
