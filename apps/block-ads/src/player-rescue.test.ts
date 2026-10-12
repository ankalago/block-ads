import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYER_RESCUE_CONFIG } from "./innertube.config.ts";
import {
  PLAYER_ELEMENT_ID,
  type RescuePlayer,
  rescueStatusSeed,
  rescueVideoId,
  startPlayerRescue,
} from "./player-rescue.ts";

const wallResponse = (videoId?: string) => ({
  videoDetails: { videoId: videoId ?? "dQw4w9WgXcQ" },
  playabilityStatus: {
    status: "ERROR",
    errorScreen: {
      enforcementMessageViewModel: { title: "Ad blockers violate YouTube's Terms of Service" },
    },
  },
});

const cleanPlayer = (videoId?: string): RescuePlayer => ({
  getPlayerResponse: () => ({ playabilityStatus: { status: "OK" }, videoDetails: { videoId: videoId ?? "x" } }),
});

const walledPlayer = (videoId?: string): RescuePlayer => ({
  getPlayerResponse: () => wallResponse(videoId),
});

describe("detección del video a rescatar", () => {
  it("devuelven el videoId cuando la respuesta viva del player trae el muro", () => {
    expect(rescueVideoId(walledPlayer())).toBe("dQw4w9WgXcQ");
  });

  it("usan el video_id del player como respaldo cuando la respuesta no lo trae", () => {
    const player: RescuePlayer = {
      getPlayerResponse: () => ({
        playabilityStatus: { status: "ERROR", errorScreen: { enforcementMessageViewModel: {} } },
      }),
      getVideoData: () => ({ video_id: "3g4S04DJPYQ" }),
    };

    expect(rescueVideoId(player)).toBe("3g4S04DJPYQ");
  });

  it("no rescatan una respuesta limpia ni un error ajeno al muro", () => {
    const broken: RescuePlayer = {
      getPlayerResponse: () => ({
        playabilityStatus: { status: "ERROR", errorScreen: { playerErrorMessageRenderer: {} } },
        videoDetails: { videoId: "dQw4w9WgXcQ" },
      }),
    };

    expect(rescueVideoId(cleanPlayer())).toBeUndefined();
    expect(rescueVideoId(broken)).toBeUndefined();
  });

  it("no rescatan cuando el player no expone respuesta todavía", () => {
    expect(rescueVideoId({})).toBeUndefined();
    expect(rescueVideoId({ getPlayerResponse: () => undefined })).toBeUndefined();
  });
});

describe("el ciclo de rescate acotado", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rescatan con loadVideoById cuando el player amanece con el muro", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    startPlayerRescue(() => walledPlayer(), attempt, status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);

    expect(attempt).toHaveBeenCalledWith(
      expect.objectContaining({ getPlayerResponse: expect.any(Function) }),
      "dQw4w9WgXcQ",
    );
    expect(status.playerRescues).toBe(1);
  });

  it("no pasan del máximo de intentos aunque el muro siga", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    startPlayerRescue(() => walledPlayer(), attempt, status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.watchMs + PLAYER_RESCUE_CONFIG.intervalMs);

    expect(status.playerRescues).toBe(PLAYER_RESCUE_CONFIG.maxAttempts);
    expect(attempt).toHaveBeenCalledTimes(PLAYER_RESCUE_CONFIG.maxAttempts);
  });

  it("no repiten el rescate dentro de la espera entre intentos", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    startPlayerRescue(() => walledPlayer(), attempt, status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);
    expect(status.playerRescues).toBe(1);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);
    expect(status.playerRescues).toBe(1);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.watchMs);
    expect(status.playerRescues).toBe(PLAYER_RESCUE_CONFIG.maxAttempts);
  });

  it("siguen interrogando aunque la respuesta amanezca limpia: el muro puede llegar tarde", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    const query = vi.fn(() => cleanPlayer());
    startPlayerRescue(query, attempt, status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.watchMs);
    const calls = query.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(20);
    expect(attempt).not.toHaveBeenCalled();

    // El tick de cierre mira una última vez y después silencio: la ventana quedó vencida.
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);
    const finalCalls = query.mock.calls.length;
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.watchMs);
    expect(query.mock.calls.length).toBe(finalCalls);
  });

  it("aguantan la ventana completa cuando el player recién aparece tarde", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    const presence = { present: false };
    const query = vi.fn(() => (presence.present ? cleanPlayer() : undefined));
    startPlayerRescue(query, attempt, status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.absoluteMs - PLAYER_RESCUE_CONFIG.intervalMs);
    presence.present = true;
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.watchMs);
    // El tick de cierre mira una última vez y después silencio: la ventana arrancó tarde y venció.
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);
    const calls = query.mock.calls.length;
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs * 10);
    expect(query.mock.calls.length).toBe(calls);
  });

  it("se rinden al vencer el plazo absoluto aunque no haya respuesta del player", () => {
    const status = rescueStatusSeed();
    const query = vi.fn(() => undefined);
    startPlayerRescue(query, vi.fn(), status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.absoluteMs);
    const calls = query.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs * 10);
    expect(query.mock.calls.length).toBe(calls);
  });

  it("sobreviven a un player que tira excepciones y rescatan cuando deja de tirarlas", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    const broken: RescuePlayer = {
      getPlayerResponse: () => {
        throw new Error("boom");
      },
    };
    const swapped = { broken: true };
    const query = vi.fn(() => (swapped.broken ? broken : walledPlayer()));
    startPlayerRescue(query, attempt, status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs * 2);
    swapped.broken = false;
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);

    expect(status.rescueErrors).toBe(2);
    expect(status.rescueTicks).toBe(3);
    expect(status.playerRescues).toBe(1);
    expect(status.rescueWallSeen).toBe(true);
  });

  it("exponen la etapa alcanzada: ticks, player visto y muro visto", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    startPlayerRescue(() => walledPlayer(), attempt, status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);

    expect(status.rescueTicks).toBe(1);
    expect(status.rescuePlayerSeen).toBe(true);
    expect(status.rescueWallSeen).toBe(true);
  });

  it("dejan el rastro del player visto también cuando su respuesta no trae muro", () => {
    const status = rescueStatusSeed();
    startPlayerRescue(() => cleanPlayer(), vi.fn(), status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);

    expect(status.rescuePlayerSeen).toBe(true);
    expect(status.rescueWallSeen).toBe(false);
  });

  it("fijan el id del elemento del player para que no se renombre por accidente", () => {
    expect(PLAYER_ELEMENT_ID).toBe("movie_player");
  });

  it("siembran el estado del rescate en cero", () => {
    expect(rescueStatusSeed()).toEqual({
      playerRescues: 0,
      rescueTicks: 0,
      rescuePlayerSeen: false,
      rescueWallSeen: false,
      rescueErrors: 0,
    });
  });
});
