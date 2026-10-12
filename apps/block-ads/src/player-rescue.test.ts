import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYER_RESCUE_CONFIG } from "./innertube.config.ts";
import { PLAYER_ELEMENT_ID, type RescuePlayer, rescueVideoId, startPlayerRescue } from "./player-rescue.ts";

const wallResponse = (videoId?: string) => ({
  videoDetails: { videoId: videoId ?? "dQw4w9WgXcQ" },
  playabilityStatus: {
    status: "ERROR",
    errorScreen: {
      enforcementMessageViewModel: { title: { content: "Ad blockers violate YouTube's Terms of Service" } },
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
    const status = { playerRescues: 0 };
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
    const status = { playerRescues: 0 };
    const attempt = vi.fn();
    startPlayerRescue(() => walledPlayer(), attempt, status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.deadlineMs + PLAYER_RESCUE_CONFIG.intervalMs);

    expect(status.playerRescues).toBe(PLAYER_RESCUE_CONFIG.maxAttempts);
    expect(attempt).toHaveBeenCalledTimes(PLAYER_RESCUE_CONFIG.maxAttempts);
  });

  it("dejan de interrogar al player cuando su respuesta existe y no trae muro", () => {
    const status = { playerRescues: 0 };
    const attempt = vi.fn();
    const query = vi.fn(() => cleanPlayer());
    startPlayerRescue(query, attempt, status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.deadlineMs + PLAYER_RESCUE_CONFIG.intervalMs);

    expect(query).toHaveBeenCalledTimes(1);
    expect(attempt).not.toHaveBeenCalled();
  });

  it("ignoran los ticks previos a que el player exista y siguen interrogando", () => {
    const status = { playerRescues: 0 };
    const attempt = vi.fn();
    const presence = { present: false };
    const query = vi.fn(() => (presence.present ? walledPlayer() : undefined));
    startPlayerRescue(query, attempt, status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs * 2);
    presence.present = true;
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);

    expect(status.playerRescues).toBe(1);
  });

  it("se rinden al vencer el plazo aunque no haya respuesta del player", () => {
    const status = { playerRescues: 0 };
    const query = vi.fn(() => undefined);
    startPlayerRescue(query, vi.fn(), status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.deadlineMs + PLAYER_RESCUE_CONFIG.intervalMs * 5);

    const lastCount = query.mock.calls.length;
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs * 10);
    expect(query.mock.calls.length).toBe(lastCount);
  });

  it("fijan el id del elemento del player para que no se renombre por accidente", () => {
    expect(PLAYER_ELEMENT_ID).toBe("movie_player");
  });
});
