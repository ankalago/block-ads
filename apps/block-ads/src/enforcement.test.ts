import { describe, expect, it } from "vitest";
import {
  ADBLOCK_SUPPORT_URL,
  ENFORCEMENT_STATUS,
  hasEnforcementWall,
  neutralizeEnforcement,
  PLAYABILITY_KEY,
  PLAYABLE_STATUS,
  UNPLAYABLE_STATUS,
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

  it("reconocen la pantalla 'Something went wrong. Please try again later. Learn more' (UNPLAYABLE + 3037019)", () => {
    const disguisedWall = {
      playabilityStatus: {
        status: UNPLAYABLE_STATUS,
        errorScreen: {
          playerErrorMessageRenderer: {
            reason: { simpleText: "Something went wrong. Please try again later." },
            subreason: {
              runs: [
                {
                  text: "Learn more",
                  navigationEndpoint: {
                    urlEndpoint: { url: ADBLOCK_SUPPORT_URL },
                  },
                },
              ],
            },
          },
        },
      },
    };

    expect(hasEnforcementWall(disguisedWall)).toBe(true);
  });

  it("no confunden un captcha ni un video genuinamente caído sin enlace 3037019 con el muro", () => {
    const captchaScreen = {
      playabilityStatus: {
        status: UNPLAYABLE_STATUS,
        errorScreen: {
          playerErrorMessageRenderer: {
            playerCaptchaViewModel: {},
            subreason: { runs: [{ text: ADBLOCK_SUPPORT_URL }] },
          },
        },
      },
    };
    const genuineUnavailable = {
      playabilityStatus: {
        status: "ERROR",
        errorScreen: {
          playerErrorMessageRenderer: {
            reason: { simpleText: "Video unavailable" },
          },
        },
      },
    };

    expect(hasEnforcementWall(captchaScreen)).toBe(false);
    expect(hasEnforcementWall(genuineUnavailable)).toBe(false);
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
