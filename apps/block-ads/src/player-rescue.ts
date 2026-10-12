import { hasEnforcementWall } from "./enforcement.ts";
import { PLAYER_RESCUE_CONFIG, type PlayerRescueConfig } from "./innertube.config.ts";

/**
 * Rescate del player cuando amanece con el muro de enforcement. La página puede reasignar
 * `window.ytInitialPlayerResponse` después de nuestra trampa de una sola escritura (el carrier y el
 * player amanecieron con el muro que ni la trampa ni el transport llegaron a ver), y reparar el
 * carrier no alcanza: el stream de una respuesta flagueada llega castigado (audio sin video).
 * `loadVideoById` pide una respuesta fresca — la única vía que la medición en vivo vio reproducir
 * de punta a punta, con sesión SABR nueva — y esa respuesta vuelve por el transport ya podada.
 */
export const PLAYER_ELEMENT_ID = "movie_player";

type JsonValue = string | number | boolean | null | { readonly [key: string]: JsonValue } | readonly JsonValue[];
type JsonObject = { readonly [key: string]: JsonValue };

export type RescuePlayer = {
  getPlayerResponse?: () => JsonValue | undefined;
  getVideoData?: () => JsonValue | undefined;
  loadVideoById?: (videoId: string) => void;
};

export type RescueStatus = { playerRescues: number };

declare global {
  interface HTMLElement {
    getPlayerResponse?: () => JsonValue | undefined;
    getVideoData?: () => JsonValue | undefined;
    loadVideoById?: (videoId: string) => void;
  }
}

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const videoIdOfResponse = (response: JsonValue | undefined): string | undefined => {
  if (!isJsonObject(response)) return undefined;
  const details = response.videoDetails;
  return isJsonObject(details) && typeof details.videoId === "string" ? details.videoId : undefined;
};

const videoIdOfData = (data: JsonValue | undefined): string | undefined => {
  if (!isJsonObject(data)) return undefined;
  return typeof data.video_id === "string" ? data.video_id : undefined;
};

/** El video a rescatar solo si la respuesta viva del player trae el muro; si no, `undefined`. */
export const rescueVideoId = (player: RescuePlayer): string | undefined => {
  const response = player.getPlayerResponse?.();
  if (response === undefined || !hasEnforcementWall(response)) return undefined;
  return videoIdOfResponse(response) ?? videoIdOfData(player.getVideoData?.());
};

/**
 * Interroga al player a intervalos acotados durante todo el plazo: el muro puede llegar tarde (la
 * página reasigna la respuesta del player después del arranque — la medición lo comprobó), así que
 * una respuesta limpia temprana no autoriza a dejar de mirar. Se rinde al vencer el plazo y nunca
 * pasa del máximo de rescates, con una espera entre intentos para no pisar la respuesta fresca de
 * un rescate anterior mientras está en vuelo.
 */
export const startPlayerRescue = (
  queryPlayer: () => RescuePlayer | undefined,
  attempt: (player: RescuePlayer, videoId: string) => void,
  status: RescueStatus,
  config: PlayerRescueConfig = PLAYER_RESCUE_CONFIG,
): void => {
  const startedAt = Date.now();
  const state = { lastAttemptAt: -config.retryGapMs };
  const tick = (): void => {
    const player = queryPlayer();
    const videoId = player === undefined ? undefined : rescueVideoId(player);

    if (Date.now() - startedAt >= config.deadlineMs) return;
    if (
      player !== undefined &&
      videoId !== undefined &&
      status.playerRescues < config.maxAttempts &&
      Date.now() - state.lastAttemptAt >= config.retryGapMs
    ) {
      state.lastAttemptAt = Date.now();
      status.playerRescues += 1;
      attempt(player, videoId);
    }
    setTimeout(tick, config.intervalMs);
  };

  setTimeout(tick, config.intervalMs);
};
