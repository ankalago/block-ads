export const PRUNE_ENDPOINTS = ["/youtubei/v1/player", "/youtubei/v1/next"] as const;
export type PruneEndpoint = (typeof PRUNE_ENDPOINTS)[number];

/** Claves que se eliminan de las respuestas de InnerTube. */
export const PRUNED_KEYS: readonly string[] = ["adPlacements", "adSlots", "playerAds"];

/** `adBreakHeartbeatParams` nunca se toca: borrarla deja el reproductor no reproducible. */
export const PROTECTED_KEYS: readonly string[] = ["adBreakHeartbeatParams"];

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
  keys: PRUNED_KEYS,
}));
