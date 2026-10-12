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

/**
 * Telemetría del rescate, etapa por etapa: el ciclo puede no correr (build viejo), no encontrar al
 * player (carga lenta), no ver el muro o morir con una excepción de un método del player. Sin estos
 * contadores, cada diagnóstico es una adivinanza y una ronda perdida con el usuario.
 */
export type RescueStatus = {
  playerRescues: number;
  rescueTicks: number;
  rescuePlayerSeen: boolean;
  rescueWallSeen: boolean;
  rescueErrors: number;
};

export const rescueStatusSeed = (): RescueStatus => ({
  playerRescues: 0,
  rescueTicks: 0,
  rescuePlayerSeen: false,
  rescueWallSeen: false,
  rescueErrors: 0,
});

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
 * Suscripción a los “nudges” que disparan una inspección inmediata fuera de la cadena de timers:
 * el tab vuelve a estar visible, el `<video>` intenta reproducirse. La medición en Chrome real lo
 * exigió: los tabs en segundo plano congelan los timers por completo y el muro llega justo después
 * de la última lectura posible.
 */
export type NudgeSubscribe = (handler: () => void) => void;

/**
 * Interroga al player a intervalos acotados durante toda la ventana de vigía: el muro puede llegar
 * tarde (la medición en vivo lo comprobó: respuesta limpia durante los primeros segundos, muro
 * después) y una respuesta limpia temprana no autoriza a dejar de mirar. La ventana arranca cuando
 * el player se ve por primera vez (`watchMs`, minutos — los ticks en segundo plano disparan ~1/min
 * y alcanzan) con un techo absoluto desde la instalación (`absoluteMs`). Nunca pasa del máximo de
 * rescates ni repite dentro de la espera entre intentos. Los métodos del player son código de la
 * página: una excepción se cuenta y no mata la vigía.
 *
 * Los nudges inyectados (foco, play) inspeccionan FUERA de la ventana: el tab congelado no debe
 * impedir el rescate cuando el usuario vuelve; el techo real es el máximo de rescates.
 */
export const startPlayerRescue = (
  queryPlayer: () => RescuePlayer | undefined,
  attempt: (player: RescuePlayer, videoId: string) => void,
  status: RescueStatus,
  config: PlayerRescueConfig = PLAYER_RESCUE_CONFIG,
  subscribeToNudges?: NudgeSubscribe,
): void => {
  const installedAt = Date.now();
  const state = { lastAttemptAt: -config.retryGapMs, firstSeenAt: -1 };

  const inspect = (): void => {
    const player = queryPlayer();
    if (player !== undefined) {
      status.rescuePlayerSeen = true;
      if (state.firstSeenAt < 0) state.firstSeenAt = Date.now();
    }

    status.rescueTicks += 1;
    try {
      const videoId = player === undefined ? undefined : rescueVideoId(player);
      if (player !== undefined && videoId !== undefined) {
        status.rescueWallSeen = true;
        if (status.playerRescues < config.maxAttempts && Date.now() - state.lastAttemptAt >= config.retryGapMs) {
          state.lastAttemptAt = Date.now();
          status.playerRescues += 1;
          attempt(player, videoId);
        }
      }
    } catch {
      status.rescueErrors += 1;
    }
  };

  const tick = (): void => {
    inspect();
    const now = Date.now();
    const watchExpired =
      state.firstSeenAt < 0 ? now - installedAt >= config.absoluteMs : now - state.firstSeenAt >= config.watchMs;
    if (watchExpired) return;
    setTimeout(tick, config.intervalMs);
  };

  setTimeout(tick, config.intervalMs);
  subscribeToNudges?.(inspect);
};
