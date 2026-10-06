import { describe, expect, it } from "vitest";
import { isPrunedEndpoint, pruneResponsePayload, xhrShadows } from "./innertube.ts";

const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?key=AIzaSyFixture";
const NEXT_URL = "https://www.youtube.com/youtubei/v1/next?key=AIzaSyFixture";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Vista plana de un payload podado para poder aserir claves concretas sin aserciones de tipo. */
const view = (value: unknown): Record<string, unknown> => (isRecord(value) ? { ...value } : {});

const key = (value: unknown, name: string): unknown => (isRecord(value) ? value[name] : undefined);

/** Payload con la forma de una respuesta real de `/youtubei/v1/player` (tarea 1). */
const playerResponse = () => ({
  responseContext: { visitorData: "fixture" },
  playabilityStatus: { status: "OK" },
  streamingData: { formats: [{ itag: 137 }], adaptiveFormats: [{ itag: 251 }] },
  adPlacements: [{ adPlacementRenderer: { renderer: "ad" } }],
  adSlots: [{ adSlotRenderer: { renderer: "slot" } }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  adBreakHeartbeatParams: "heartbeat-token",
  playerConfig: { adsConfig: { adBreakHeartbeatParams: "nested-heartbeat" } },
});

describe("poda de respuestas de InnerTube", () => {
  it("elimina adPlacements, adSlots y playerAds de la respuesta del player", () => {
    const pruned = view(pruneResponsePayload(PLAYER_URL, playerResponse()));

    expect(pruned.adPlacements).toBeUndefined();
    expect(pruned.adSlots).toBeUndefined();
    expect(pruned.playerAds).toBeUndefined();
  });

  it("nunca elimina adBreakHeartbeatParams, ni siquiera anidado", () => {
    const pruned = view(pruneResponsePayload(PLAYER_URL, playerResponse()));

    expect(pruned.adBreakHeartbeatParams).toBe("heartbeat-token");
    expect(key(key(pruned.playerConfig, "adsConfig"), "adBreakHeartbeatParams")).toBe("nested-heartbeat");
  });

  it("conserva intacto el resto de la respuesta del player", () => {
    const pruned = view(pruneResponsePayload(PLAYER_URL, playerResponse()));

    expect(key(pruned.playabilityStatus, "status")).toBe("OK");
    expect(key(pruned.streamingData, "formats")).toEqual([{ itag: 137 }]);
    expect(key(pruned.streamingData, "adaptiveFormats")).toEqual([{ itag: 251 }]);
  });

  it("poda las claves de anuncio anidadas en las respuestas de next", () => {
    const payload = {
      contents: { adSlots: [{ adSlotRenderer: {} }], tabs: [{ title: "Home" }] },
      onResponseReceivedActions: [{ adPlacements: [{ adPlacementRenderer: {} }] }],
      adBreakHeartbeatParams: "hb",
    };

    const pruned = view(pruneResponsePayload(NEXT_URL, payload));

    expect(key(pruned.contents, "adSlots")).toBeUndefined();
    expect(key(pruned.contents, "tabs")).toEqual([{ title: "Home" }]);
    expect(pruned.onResponseReceivedActions).toEqual([{}]);
    expect(pruned.adBreakHeartbeatParams).toBe("hb");
  });

  it("devuelve el mismo objeto cuando la respuesta no trae claves de anuncio", () => {
    const clean = { playabilityStatus: { status: "OK" }, adBreakHeartbeatParams: "hb" };

    expect(pruneResponsePayload(PLAYER_URL, clean)).toBe(clean);
  });

  it("no muta el payload original", () => {
    const original = playerResponse();

    pruneResponsePayload(PLAYER_URL, original);

    expect(original.adPlacements).toHaveLength(1);
    expect(original.adSlots).toHaveLength(1);
    expect(original.playerAds).toHaveLength(1);
  });

  it("no toca las respuestas de endpoints que no son player ni next", () => {
    const payload = { adPlacements: [{ ad: true }], adSlots: [] };

    expect(pruneResponsePayload("https://www.youtube.com/youtubei/v1/browse", payload)).toBe(payload);
    expect(pruneResponsePayload("https://www.youtube.com/watch?v=abc", payload)).toBe(payload);
  });

  it("reconoce la ruta del player y la de next con URL relativa o absoluta", () => {
    expect(isPrunedEndpoint("/youtubei/v1/player")).toBe(true);
    expect(isPrunedEndpoint("https://www.youtube.com/youtubei/v1/next?key=x")).toBe(true);
    expect(isPrunedEndpoint("https://www.youtube.com/youtubei/v1/playerX")).toBe(false);
    expect(isPrunedEndpoint("https://example.com/watch?v=/youtubei/v1/player")).toBe(false);
  });
});

describe("sombreado de respuestas XHR", () => {
  const pruned = { adBreakHeartbeatParams: "Q0FBJTNE" };

  it("sombrean response cuando la página lee JSON parseado, que es la clave del parche", () => {
    const shadows = xhrShadows("json", pruned);

    expect(shadows).toEqual([{ property: "response", value: pruned }]);
  });

  it("sombread responseText y response en el modo por defecto y en text", () => {
    const body = JSON.stringify(pruned);

    expect(xhrShadows("", pruned)).toEqual([
      { property: "responseText", value: body },
      { property: "response", value: body },
    ]);
    expect(xhrShadows("text", pruned)).toEqual(xhrShadows("", pruned));
  });

  it("no promete podas imposibles en responseType binario", () => {
    expect(xhrShadows("arraybuffer", pruned)).toEqual([]);
    expect(xhrShadows("blob", pruned)).toEqual([]);
  });
});
