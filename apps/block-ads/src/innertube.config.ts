export const PRUNE_ENDPOINTS = ["/youtubei/v1/player", "/youtubei/v1/next"] as const;
export type PruneEndpoint = (typeof PRUNE_ENDPOINTS)[number];

/**
 * Claves de anuncio de las respuestas de InnerTube. Ya no se borran: se conservan presentes con el
 * valor vacío de su propio tipo runtime (`[]`, `{}` o `""`). Una respuesta con `adPlacements`
 * ausente y `adBreakHeartbeatParams` no vacío es internamente inconsistente, y el player la
 * interpreta como "un bloqueador me quitó los anuncios" (muro de reproducción y
 * `video.currentSrc === ""`).
 *
 * Vaciar `adBreakHeartbeatParams` revierte la decisión de `odd/specs/extension-shell.md` §6
 * ("nunca se toca"), que asumía que borrarlo dejaba el reproductor no reproducible. La medición en
 * Chrome apunta a que el problema es la inconsistencia, no el vaciado; esto es exactamente lo que
 * se está probando.
 */
export const NEUTRALIZED_KEYS: readonly string[] = ["adPlacements", "adSlots", "playerAds", "adBreakHeartbeatParams"];

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
 * Rescate del player: si el player amanece con el muro de enforcement (la página puede reasignar
 * `window.ytInitialPlayerResponse` después de nuestra trampa de una sola escritura), se le pide una
 * respuesta fresca con `loadVideoById` — la única vía que la medición en vivo vio reproducir de
 * punta a punta: respuesta limpia y sesión SABR nueva. Acotado: a lo sumo dos rescates por página
 * y con plazo; nada de bucles infinitos.
 */
export const PLAYER_RESCUE_CONFIG = {
  intervalMs: 500,
  deadlineMs: 15000,
  maxAttempts: 2,
  retryGapMs: 2000,
} as const;
export type PlayerRescueConfig = typeof PLAYER_RESCUE_CONFIG;
