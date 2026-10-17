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
  classList?: { readonly contains: (token: string) => boolean };
  querySelector?: (selector: string) => unknown;
};

const AD_SHOWING_CLASSES: readonly string[] = ["ad-showing", "ad-interrupting"];

const SKIP_BUTTON_SELECTORS: readonly string[] = [
  ".ytp-ad-skip-button",
  ".ytp-ad-skip-button-modern",
  ".ytp-skip-ad-button",
  ".ytp-ad-overlay-close-button",
];

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
  /** Marca de tiempo de la última inspección, por timer o nudge: -1 mientras no hubo ninguna. */
  rescueLastAt: number;
};

export const rescueStatusSeed = (): RescueStatus => ({
  playerRescues: 0,
  rescueTicks: 0,
  rescuePlayerSeen: false,
  rescueWallSeen: false,
  rescueErrors: 0,
  rescueLastAt: -1,
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

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const videoIdOfResponse = (response: JsonValue | undefined): string | undefined => {
  if (!isJsonObject(response)) return undefined;
  const details = response.videoDetails;
  return isJsonObject(details) ? nonEmptyString(details.videoId) : undefined;
};

const videoIdOfData = (data: JsonValue | undefined): string | undefined => {
  if (!isJsonObject(data)) return undefined;
  return nonEmptyString(data.video_id);
};

const PATH_VIDEO_PREFIXES: readonly string[] = ["/shorts/", "/embed/", "/live/"];

/** Extrae el videoId desde `?v=` o rutas `/shorts/`, `/embed/`, `/live/` cuando el muro omite `videoDetails`. */
export const videoIdOfLocation = (hrefOrSearch?: string): string | undefined => {
  const fallbackHref = typeof window !== "undefined" ? window.location?.href : undefined;
  const raw = nonEmptyString(hrefOrSearch ?? fallbackHref);
  if (raw === undefined) return undefined;
  try {
    const url = new URL(raw, "https://www.youtube.com");
    const fromQuery = nonEmptyString(url.searchParams.get("v"));
    if (fromQuery !== undefined) return fromQuery;

    const prefix = PATH_VIDEO_PREFIXES.find((candidate) => url.pathname.startsWith(candidate));
    if (prefix === undefined) return undefined;

    const segment = url.pathname.slice(prefix.length).split("/")[0];
    return nonEmptyString(segment);
  } catch {
    return undefined;
  }
};

const knownVideoId = (player: RescuePlayer, locationHref?: string): string | undefined =>
  videoIdOfResponse(player.getPlayerResponse?.()) ??
  videoIdOfData(player.getVideoData?.()) ??
  videoIdOfLocation(locationHref);

/** El video a rescatar solo si la respuesta viva del player trae el muro; si no, `undefined`. */
export const rescueVideoId = (player: RescuePlayer, locationHref?: string): string | undefined => {
  const response = player.getPlayerResponse?.();
  if (response === undefined || !hasEnforcementWall(response)) return undefined;
  return knownVideoId(player, locationHref);
};

type MutableVideoCandidate = {
  duration?: unknown;
  currentTime?: unknown;
  muted?: unknown;
};

type ClickableCandidate = {
  click?: unknown;
};

const isMutableVideo = (value: unknown): value is MutableVideoCandidate => typeof value === "object" && value !== null;

const isClickable = (value: unknown): value is ClickableCandidate => typeof value === "object" && value !== null;

const fastForwardAdVideo = (video: unknown): void => {
  if (!isMutableVideo(video)) return;
  const duration = video.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return;
  video.muted = true;
  video.currentTime = duration;
};

const clickSkipButton = (button: unknown): void => {
  if (!isClickable(button)) return;
  if (typeof button.click === "function") button.click();
};

/**
 * Backstop en el reproductor: si un anuncio instream llega a activarse (`.ad-showing` o
 * `.ad-interrupting` en `#movie_player`), silencia y adelanta el `<video>` al final y pulsa
 * cualquier botón de skip disponible. Nunca toca un vídeo orgánico.
 */
export const skipActiveAd = (player: RescuePlayer): boolean => {
  const isAdShowing = AD_SHOWING_CLASSES.some((token) => player.classList?.contains(token) === true);
  if (!isAdShowing) return false;

  fastForwardAdVideo(player.querySelector?.("video"));
  SKIP_BUTTON_SELECTORS.forEach((selector) => {
    clickSkipButton(player.querySelector?.(selector));
  });

  return true;
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
  const state: { lastAttemptAt: number; firstSeenAt: number; lastVideoId: string | undefined } = {
    lastAttemptAt: -config.retryGapMs,
    firstSeenAt: -1,
    lastVideoId: undefined,
  };

  const tryRescue = (player: RescuePlayer, videoId: string | undefined): void => {
    if (videoId === undefined) return;
    if (status.playerRescues >= config.maxAttempts) return;
    if (Date.now() - state.lastAttemptAt < config.retryGapMs) return;

    state.lastAttemptAt = Date.now();
    status.playerRescues += 1;
    attempt(player, videoId);
  };

  const inspectPlayer = (player: RescuePlayer): void => {
    skipActiveAd(player);
    const currentVideoId = knownVideoId(player);
    if (currentVideoId !== undefined) state.lastVideoId = currentVideoId;

    const response = player.getPlayerResponse?.();
    if (response === undefined || !hasEnforcementWall(response)) return;

    status.rescueWallSeen = true;
    tryRescue(player, currentVideoId ?? state.lastVideoId);
  };

  const inspect = (): void => {
    status.rescueLastAt = Date.now();
    const player = queryPlayer();
    if (player !== undefined) {
      status.rescuePlayerSeen = true;
      if (state.firstSeenAt < 0) state.firstSeenAt = Date.now();
    }

    status.rescueTicks += 1;
    if (player === undefined) return;
    try {
      inspectPlayer(player);
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
