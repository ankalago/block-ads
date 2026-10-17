import { describe, expect, it, vi } from "vitest";
import {
  ABNORMALITY_MARKER,
  ENFORCEMENT_STATUS,
  hasEnforcementWall,
  installAbnormalityGuard,
  isAbnormalityCallback,
  neutralizeEnforcement,
  PLAYABILITY_KEY,
  PLAYABLE_STATUS,
} from "./enforcement.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const view = (value: unknown): Record<string, unknown> => (isRecord(value) ? { ...value } : {});

const playabilityOf = (payload: unknown): Record<string, unknown> => view(view(payload)[PLAYABILITY_KEY]);

/** El muro observado en dQw4w9WgXcQ: ERROR + errorScreen.enforcementMessageViewModel (§19). */
const enforcementScreen = () => ({
  enforcementMessageViewModel: {
    title: { content: "Ad blockers violate YouTube's Terms of Service" },
    primaryButton: { buttonViewModel: { title: "Allow YouTube Ads" } },
  },
});

const wallPayload = () => ({
  playabilityStatus: {
    status: "ERROR",
    miniplayer: { miniplayerRenderer: { playbackMode: "PLAYBACK_MODE_ALLOW" } },
    errorScreen: enforcementScreen(),
  },
  videoDetails: { videoId: "dQw4w9WgXcQ" },
});

const auxiliaryPopupPayload = () => ({
  playabilityStatus: { status: "OK" },
  videoDetails: { videoId: "dQw4w9WgXcQ" },
  auxiliaryUi: {
    messageRenderers: {
      bkaEnforcementMessageViewModel: {
        title: "Ad blockers are not allowed on YouTube",
      },
      enforcementMessageViewModel: {
        title: "Ad blockers violate YouTube's Terms of Service",
      },
      upsellDialogRenderer: { title: "Premium" },
    },
  },
});

describe("la regla de enforcement sobre respuestas del player", () => {
  it("conserva intacto un ERROR de enforcement para que el rescate pida un stream sano en vez de dejar pantalla negra", () => {
    const flagged = wallPayload();
    const result = neutralizeEnforcement(flagged);
    const playability = playabilityOf(result);

    expect(result).toBe(flagged);
    expect(playability.status).toBe("ERROR");
    expect(hasEnforcementWall(result)).toBe(true);
  });

  it("elimina bkaEnforcementMessageViewModel y enforcementMessageViewModel de auxiliaryUi en respuestas jugables", () => {
    const result = neutralizeEnforcement(auxiliaryPopupPayload());
    const auxiliary = view(view(result).auxiliaryUi);
    const renderers = view(auxiliary.messageRenderers);

    expect("bkaEnforcementMessageViewModel" in renderers).toBe(false);
    expect("enforcementMessageViewModel" in renderers).toBe(false);
    expect(renderers.upsellDialogRenderer).toEqual({ title: "Premium" });
    expect(playabilityOf(result).status).toBe("OK");
  });

  it("devuelven la misma referencia cuando la respuesta no trae popup de enforcement en auxiliaryUi", () => {
    const clean = {
      playabilityStatus: { status: "OK" },
      videoDetails: { videoId: "dQw4w9WgXcQ" },
      auxiliaryUi: { messageRenderers: { upsellDialogRenderer: { title: "Premium" } } },
    };

    expect(neutralizeEnforcement(clean)).toBe(clean);
  });

  it("no reescriben un ERROR genuino de otro errorScreen (video caído, restricción)", () => {
    const broken = {
      playabilityStatus: {
        status: "ERROR",
        errorScreen: { playerErrorMessageRenderer: { reason: { content: "Video unavailable" } } },
      },
    };

    expect(neutralizeEnforcement(broken)).toBe(broken);
  });

  it("no reescriben un ERROR sin errorScreen", () => {
    const bare = { playabilityStatus: { status: "ERROR", reason: "Internal error" } };

    expect(neutralizeEnforcement(bare)).toBe(bare);
  });

  it("dejan pasar valores que no son objetos", () => {
    expect(neutralizeEnforcement(undefined)).toBeUndefined();
    expect(neutralizeEnforcement(null)).toBeNull();
    expect(neutralizeEnforcement("hola")).toBe("hola");
    expect(neutralizeEnforcement(42)).toBe(42);
  });
});

describe("detección del muro de enforcement", () => {
  it("reconocen un ERROR con enforcementMessageViewModel o bkaEnforcementMessageViewModel", () => {
    expect(hasEnforcementWall(wallPayload())).toBe(true);
    expect(
      hasEnforcementWall({
        playabilityStatus: {
          status: "ERROR",
          errorScreen: { bkaEnforcementMessageViewModel: {} },
        },
      }),
    ).toBe(true);
  });

  it("descartan respuestas limpias y errores ajenos", () => {
    expect(hasEnforcementWall({ playabilityStatus: { status: "OK" } })).toBe(false);
    expect(hasEnforcementWall({})).toBe(false);
    expect(hasEnforcementWall("hola")).toBe(false);
    expect(hasEnforcementWall(undefined)).toBe(false);
  });
});

describe("guardia contra onAbnormalityDetected en Promise.prototype.then", () => {
  it("identifica callbacks cuya fuente contiene onAbnormalityDetected", () => {
    const detector = () => "onAbnormalityDetected";
    const innocent = () => "normalPlayback";

    expect(ABNORMALITY_MARKER).toBe("onAbnormalityDetected");
    expect(isAbnormalityCallback(detector)).toBe(true);
    expect(isAbnormalityCallback(innocent)).toBe(false);
    expect(isAbnormalityCallback(null)).toBe(false);
    expect(isAbnormalityCallback("onAbnormalityDetected")).toBe(false);
  });

  it("neutraliza el callback de onAbnormalityDetected en Promise.then sin romper promesas normales", async () => {
    const onBlocked = vi.fn();
    installAbnormalityGuard(onBlocked);

    const sideEffect = vi.fn();
    const abnormalityHandler = () => {
      sideEffect("onAbnormalityDetected");
      return "walled";
    };
    const normalHandler = (value: number) => value * 2;

    const blockedResult = await Promise.resolve("tick").then(abnormalityHandler);
    const normalResult = await Promise.resolve(21).then(normalHandler);

    expect(sideEffect).not.toHaveBeenCalled();
    expect(blockedResult).toBeUndefined();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(normalResult).toBe(42);
  });
});

describe("constancias fijas de la regla de enforcement", () => {
  it("fijan las claves y estados para que no se renombren por accidente", () => {
    expect(PLAYABILITY_KEY).toBe("playabilityStatus");
    expect(ENFORCEMENT_STATUS).toBe("ERROR");
    expect(PLAYABLE_STATUS).toBe("OK");
  });
});
