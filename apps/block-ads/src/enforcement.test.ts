import { describe, expect, it } from "vitest";
import {
  ADBLOCK_SUPPORT_URL,
  ENFORCEMENT_STATUS,
  hasEnforcementWall,
  neutralizeEnforcement,
  PLAYABILITY_KEY,
  PLAYABLE_STATUS,
  PLAYER_ERROR_SUPPORT_URL,
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
  it("reescribe playabilityStatus a OK y quita errorScreen para que ytd-watch-flexy no muestre el cartel ni salte de video a los 10s", () => {
    const flagged = wallPayload();
    const result = neutralizeEnforcement(flagged);
    const playability = playabilityOf(result);

    expect(playability.status).toBe("OK");
    expect("errorScreen" in playability).toBe(false);
    expect(playability.miniplayer).toEqual({ miniplayerRenderer: { playbackMode: "PLAYBACK_MODE_ALLOW" } });
  });

  it("reescribe también playerResponse anidado en respuestas de /youtubei/v1/get_watch (playlists)", () => {
    const getWatchPayload = [{ playerResponse: wallPayload() }];
    const result = neutralizeEnforcement(getWatchPayload);
    const first = Array.isArray(result) ? view(result[0]) : {};
    const playability = playabilityOf(first.playerResponse);

    expect(playability.status).toBe("OK");
    expect("errorScreen" in playability).toBe(false);
  });

  it("conserva intacto auxiliaryUi para no disparar el error 282054944 (p=player_error1) en base.js", () => {
    const payload = auxiliaryPopupPayload();
    const result = neutralizeEnforcement(payload);

    expect(result).toBe(payload);
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

  it("reconocen el payload real de iUXbJhx_vfQ ('Something went wrong' + p=player_error1 + 282054944)", () => {
    const playerError1Wall = {
      playabilityStatus: {
        status: "ERROR",
        playableInEmbed: true,
        errorScreen: {
          playerErrorMessageRenderer: {
            reason: {
              runs: [{ text: "Something went wrong. Please try again later." }],
            },
            proceedButton: {
              buttonRenderer: {
                text: { runs: [{ text: "Learn more" }] },
                navigationEndpoint: {
                  commandMetadata: {
                    webCommandMetadata: {
                      url: "//support.google.com/youtube/?p=player_error1#zippy=%2Cupdate-your-browser",
                      webPageType: "WEB_PAGE_TYPE_UNKNOWN",
                    },
                  },
                  urlEndpoint: {
                    url: "//support.google.com/youtube/?p=player_error1#zippy=%2Cupdate-your-browser",
                  },
                },
              },
            },
            subreason: {
              runs: [{ text: "282054944" }],
            },
          },
        },
      },
    };

    expect(PLAYER_ERROR_SUPPORT_URL).toBe("support.google.com/youtube/?p=player_error1");
    expect(hasEnforcementWall(playerError1Wall)).toBe(true);
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
