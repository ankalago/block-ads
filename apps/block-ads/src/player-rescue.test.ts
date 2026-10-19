import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYER_RESCUE_CONFIG } from "./innertube.config.ts";
import {
  PLAYER_ELEMENT_ID,
  type RescuePlayer,
  rescueStatusSeed,
  rescueVideoId,
  skipActiveAd,
  startPlayerRescue,
  videoIdOfLocation,
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

  it("ignoran un video_id vacío del player en error y caen a la URL (?v=, /shorts/, /embed/)", () => {
    const playerWithEmptyData: RescuePlayer = {
      getPlayerResponse: () => ({
        playabilityStatus: { status: "ERROR", errorScreen: { enforcementMessageViewModel: {} } },
      }),
      getVideoData: () => ({ video_id: "" }),
    };

    expect(rescueVideoId(playerWithEmptyData, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(videoIdOfLocation("https://www.youtube.com/shorts/abc123XYZ")).toBe("abc123XYZ");
    expect(videoIdOfLocation("https://www.youtube.com/embed/xyz987ABC")).toBe("xyz987ABC");
    expect(videoIdOfLocation("https://www.youtube.com/")).toBeUndefined();
  });

  it("priorizan el videoId de la URL sobre un video_id rancio de getVideoData() al cambiar de video en una playlist", () => {
    const stalePlaylistPlayer: RescuePlayer = {
      getPlayerResponse: () => ({
        playabilityStatus: { status: "ERROR", errorScreen: { enforcementMessageViewModel: {} } },
      }),
      // En SPA/Mix, cuando el video #2 (_PXXW-Y1Es4) cae en el muro, getVideoData() todavía retiene
      // el video_id del video #1 (z_-sLv7g-0Q). Usar getVideoData() antes que la URL cambiaba el
      // reproductor de vuelta al video #1 tras 2 segundos.
      getVideoData: () => ({ video_id: "z_-sLv7g-0Q" }),
    };

    expect(
      rescueVideoId(stalePlaylistPlayer, "https://www.youtube.com/watch?v=_PXXW-Y1Es4&list=RDz_-sLv7g-0Q&index=2"),
    ).toBe("_PXXW-Y1Es4");
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

  it("no pasan del máximo de intentos sobre un mismo videoId aunque el muro siga", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    startPlayerRescue(() => walledPlayer(), attempt, status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.watchMs + PLAYER_RESCUE_CONFIG.intervalMs);

    expect(status.playerRescues).toBe(PLAYER_RESCUE_CONFIG.maxAttempts);
    expect(attempt).toHaveBeenCalledTimes(PLAYER_RESCUE_CONFIG.maxAttempts);
  });

  it("reinician el cupo de intentos y la ventana al cambiar de videoId en una playlist (caso index=27)", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    const current = { videoId: "videoUno111" };
    startPlayerRescue(() => walledPlayer(current.videoId), attempt, status);

    // Agota los 2 intentos en el primer video de la sesión.
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.retryGapMs * 3);
    expect(status.playerRescues).toBe(PLAYER_RESCUE_CONFIG.maxAttempts);

    // Avanza casi hasta el final de la ventana inicial y cambia al video #27 (v7K1QLyZpJ0).
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.watchMs - PLAYER_RESCUE_CONFIG.retryGapMs * 4);
    current.videoId = "v7K1QLyZpJ0";

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);
    expect(status.playerRescues).toBe(PLAYER_RESCUE_CONFIG.maxAttempts + 1);
    expect(attempt).toHaveBeenLastCalledWith(
      expect.objectContaining({ getPlayerResponse: expect.any(Function) }),
      "v7K1QLyZpJ0",
    );
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

  it("siguen mirando mucho después del primer minuto de vida del player", () => {
    const status = rescueStatusSeed();
    const query = vi.fn(() => cleanPlayer());
    startPlayerRescue(query, vi.fn(), status);

    vi.advanceTimersByTime(31000);
    const calls = query.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(20);

    // La medición en vivo: el muro llegó después de los 8 s que duró la primera vigía. Mirar
    // minutos, no segundos.
    vi.advanceTimersByTime(5000);
    expect(query.mock.calls.length).toBeGreaterThan(calls);
  });

  it("dejan la marca de la última inspección aunque no haya nada que rescatar", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    startPlayerRescue(() => cleanPlayer(), attempt, status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);
    expect(status.rescueTicks).toBe(1);
    expect(status.rescueLastAt).toBe(Date.now());
    expect(attempt).not.toHaveBeenCalled();
  });

  it("rescatan al volver el foco aunque la vigía por timer esté congelada o vencida", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    const nudges: Array<() => void> = [];
    const wall = { on: false };
    startPlayerRescue(
      () => (wall.on ? walledPlayer() : cleanPlayer()),
      attempt,
      status,
      PLAYER_RESCUE_CONFIG,
      (handler) => {
        nudges.push(handler);
      },
    );

    // El tab pierde el foco y los timers se congelan; el muro llega sin que ningún timer corra.
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.watchMs + PLAYER_RESCUE_CONFIG.intervalMs);
    expect(attempt).not.toHaveBeenCalled();

    wall.on = true;
    nudges[0]?.();
    expect(status.playerRescues).toBe(1);
    expect(status.rescueLastAt).toBe(Date.now());
  });

  it("rescatan cuando el video intenta reproducirse con el muro presente", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    const nudges: Array<() => void> = [];
    startPlayerRescue(
      () => walledPlayer(),
      attempt,
      status,
      PLAYER_RESCUE_CONFIG,
      (handler) => {
        nudges.push(handler);
      },
    );

    // Sin avanzar el reloj: timers congelados; el usuario aprieta play y el nudge corre.
    nudges[0]?.();
    expect(status.playerRescues).toBe(1);
    expect(status.rescueWallSeen).toBe(true);
  });

  it("no pasan del máximo de rescates aunque el foco vuelva muchas veces", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    const nudges: Array<() => void> = [];
    startPlayerRescue(
      () => walledPlayer(),
      attempt,
      status,
      PLAYER_RESCUE_CONFIG,
      (handler) => {
        nudges.push(handler);
      },
    );

    const handler = nudges[0];
    handler?.();
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.retryGapMs);
    handler?.();
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.retryGapMs);
    handler?.();
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.retryGapMs);
    handler?.();
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.retryGapMs);
    handler?.();

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

  it("marcan rescueWallSeen y rescatan usando el videoId recordado de ticks limpios previos cuando el muro real borra videoDetails", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    const state = { walled: false };
    const player: RescuePlayer = {
      getPlayerResponse: () =>
        state.walled
          ? { playabilityStatus: { status: "ERROR", errorScreen: { enforcementMessageViewModel: {} } } }
          : { playabilityStatus: { status: "OK" }, videoDetails: { videoId: "dQw4w9WgXcQ" } },
      getVideoData: () => ({ video_id: "" }),
    };

    startPlayerRescue(() => player, attempt, status);

    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);
    expect(status.rescueWallSeen).toBe(false);
    expect(status.playerRescues).toBe(0);

    state.walled = true;
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);
    expect(status.rescueWallSeen).toBe(true);
    expect(status.playerRescues).toBe(1);
    expect(attempt).toHaveBeenCalledWith(player, "dQw4w9WgXcQ");
  });

  it("marcan rescueWallSeen en verdadero aunque ninguna fuente exponga todavía un videoId", () => {
    const status = rescueStatusSeed();
    const attempt = vi.fn();
    const orphanWallPlayer: RescuePlayer = {
      getPlayerResponse: () => ({
        playabilityStatus: { status: "ERROR", errorScreen: { enforcementMessageViewModel: {} } },
      }),
      getVideoData: () => ({ video_id: "" }),
    };

    startPlayerRescue(() => orphanWallPlayer, attempt, status);
    vi.advanceTimersByTime(PLAYER_RESCUE_CONFIG.intervalMs);

    expect(status.rescueWallSeen).toBe(true);
    expect(status.playerRescues).toBe(0);
  });

  it("saltan al final del anuncio y pulsan el botón de skip cuando el player tiene ad-showing", () => {
    const video = { duration: 15, currentTime: 1, muted: false };
    const skipButton = { click: vi.fn() };
    const adPlayer: RescuePlayer = {
      classList: { contains: (token) => token === "ad-showing" },
      querySelector: (selector) => {
        if (selector === "video") return video;
        if (selector === ".ytp-ad-skip-button-modern") return skipButton;
        return null;
      },
    };
    const organicPlayer: RescuePlayer = {
      classList: { contains: () => false },
      querySelector: () => video,
    };

    expect(skipActiveAd(organicPlayer)).toBe(false);
    expect(video.currentTime).toBe(1);
    expect(video.muted).toBe(false);

    expect(skipActiveAd(adPlayer)).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.currentTime).toBe(15);
    expect(skipButton.click).toHaveBeenCalledTimes(1);
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
      rescueLastAt: -1,
    });
  });
});
