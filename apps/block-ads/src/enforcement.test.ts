import { describe, expect, it } from "vitest";
import {
  ENFORCEMENT_STATUS,
  hasEnforcementWall,
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

describe("la regla de enforcement sobre playabilityStatus", () => {
  it("reescriben el ERROR del muro a OK y sacan errorScreen, conservando el resto", () => {
    const result = neutralizeEnforcement(wallPayload());
    const playability = playabilityOf(result);

    expect(playability.status).toBe("OK");
    expect("errorScreen" in playability).toBe(false);
    expect(playability.miniplayer).toEqual({ miniplayerRenderer: { playbackMode: "PLAYBACK_MODE_ALLOW" } });
    expect(view(result).videoDetails).toEqual({ videoId: "dQw4w9WgXcQ" });
  });

  it("devuelven la misma referencia cuando la respuesta no trae muro", () => {
    const clean = { playabilityStatus: { status: "OK" }, videoDetails: { videoId: "dQw4w9WgXcQ" } };

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

  it("no reescriben otro estado aunque venga el view model de enforcement", () => {
    const loginWall = { playabilityStatus: { status: "LOGIN_REQUIRED", errorScreen: enforcementScreen() } };

    expect(neutralizeEnforcement(loginWall)).toBe(loginWall);
  });

  it("dejan pasar valores que no son objetos", () => {
    expect(neutralizeEnforcement(undefined)).toBeUndefined();
    expect(neutralizeEnforcement(null)).toBeNull();
    expect(neutralizeEnforcement("hola")).toBe("hola");
    expect(neutralizeEnforcement(42)).toBe(42);
  });
});

describe("detección del muro de enforcement", () => {
  it("reconocen un ERROR con el view model de enforcement", () => {
    expect(hasEnforcementWall(wallPayload())).toBe(true);
  });

  it("descartan respuestas limpias y errores ajenos", () => {
    expect(hasEnforcementWall({ playabilityStatus: { status: "OK" } })).toBe(false);
    expect(hasEnforcementWall({})).toBe(false);
    expect(hasEnforcementWall("hola")).toBe(false);
    expect(hasEnforcementWall(undefined)).toBe(false);
  });
});

describe("constancias fijas de la regla de enforcement", () => {
  it("fijan las claves y estados para que no se renombren por accidente", () => {
    expect(PLAYABILITY_KEY).toBe("playabilityStatus");
    expect(ENFORCEMENT_STATUS).toBe("ERROR");
    expect(PLAYABLE_STATUS).toBe("OK");
  });
});
