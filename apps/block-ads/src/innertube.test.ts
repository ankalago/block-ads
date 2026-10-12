import { describe, expect, it } from "vitest";
import { NEUTRALIZED_KEYS } from "./innertube.config.ts";
import {
  type CarrierHost,
  type CarrierStatus,
  carrierStatusSeed,
  countAdKeys,
  DEBUG_PARAM,
  INLINE_CARRIER,
  initialResponseValue,
  isPrunedEndpoint,
  markAdsFound,
  markEnforcementRewritten,
  markNeutralized,
  NETWORK_STATUS_KEY,
  networkStatusSeed,
  neutralizationKeysFor,
  neutralizeAdKeys,
  pruneResponsePayload,
  recordTransport,
  shadowInlineCarrier,
  shouldPublishStatus,
  xhrShadows,
} from "./innertube.ts";

/** Forma observable del descriptor: data property de `var` frente a accesorio. */
const carrierDescriptor = (host: CarrierHost) => {
  const descriptor = Object.getOwnPropertyDescriptor(host, INLINE_CARRIER);

  return {
    accessors:
      descriptor === undefined ? "sin-descriptor" : "get" in descriptor || "set" in descriptor ? "accesorio" : "dato",
    value: descriptor === undefined ? "sin-descriptor" : "value" in descriptor ? "presente" : "ausente",
    writable: descriptor?.writable,
    configurable: descriptor?.configurable,
  };
};

const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?key=AIzaSyFixture";
const NEXT_URL = "https://www.youtube.com/youtubei/v1/next?key=AIzaSyFixture";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Vista plana de un payload neutralizado para poder aserir claves concretas sin aserciones de tipo. */
const view = (value: unknown): Record<string, unknown> => (isRecord(value) ? { ...value } : {});

const key = (value: unknown, name: string): unknown => (isRecord(value) ? value[name] : undefined);

const lengthOf = (value: unknown): number => (Array.isArray(value) ? value.length : -1);

/** Payload con la forma de una respuesta real de `/youtubei/v1/player` (tarea 1). */
const playerResponse = () => ({
  responseContext: { visitorData: "fixture" },
  playabilityStatus: { status: "OK" },
  videoDetails: { videoId: "dQw4w9WgXcQ", title: "Fixture" },
  streamingData: { formats: [{ itag: 137 }], adaptiveFormats: [{ itag: 251 }] },
  adPlacements: [{ adPlacementRenderer: { renderer: "ad" } }],
  adSlots: [{ adSlotRenderer: { renderer: "slot" } }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  adBreakHeartbeatParams: "heartbeat-token",
  playerConfig: { adsConfig: { adBreakHeartbeatParams: "nested-heartbeat" } },
});

describe("neutralización de respuestas de InnerTube", () => {
  it("mantiene adPlacements, adSlots y playerAds presentes con un array vacío", () => {
    const neutralized = view(pruneResponsePayload(PLAYER_URL, playerResponse()));

    expect("adPlacements" in neutralized).toBe(true);
    expect(neutralized.adPlacements).toEqual([]);
    expect("adSlots" in neutralized).toBe(true);
    expect(neutralized.adSlots).toEqual([]);
    expect("playerAds" in neutralized).toBe(true);
    expect(neutralized.playerAds).toEqual([]);
  });

  it("vacía adBreakHeartbeatParams a string vacío, también anidado", () => {
    const neutralized = view(pruneResponsePayload(PLAYER_URL, playerResponse()));

    expect("adBreakHeartbeatParams" in neutralized).toBe(true);
    expect(neutralized.adBreakHeartbeatParams).toBe("");
    expect(key(key(neutralized.playerConfig, "adsConfig"), "adBreakHeartbeatParams")).toBe("");
  });

  it("conserva intactas las claves orgánicas de la respuesta del player", () => {
    const neutralized = view(pruneResponsePayload(PLAYER_URL, playerResponse()));

    expect(key(neutralized.videoDetails, "title")).toBe("Fixture");
    expect(key(neutralized.playabilityStatus, "status")).toBe("OK");
    expect(lengthOf(key(neutralized.streamingData, "formats"))).toBe(1);
    expect(key(neutralized.streamingData, "adaptiveFormats")).toEqual([{ itag: 251 }]);
  });

  it("neutraliza las claves de anuncio anidadas en las respuestas de next", () => {
    const payload = {
      contents: { adSlots: [{ adSlotRenderer: {} }], tabs: [{ title: "Home" }] },
      onResponseReceivedActions: [{ adPlacements: [{ adPlacementRenderer: {} }] }],
      adBreakHeartbeatParams: "hb",
    };

    const neutralized = view(pruneResponsePayload(NEXT_URL, payload));

    expect(key(neutralized.contents, "adSlots")).toEqual([]);
    expect(key(neutralized.contents, "tabs")).toEqual([{ title: "Home" }]);
    expect(neutralized.onResponseReceivedActions).toEqual([{ adPlacements: [] }]);
    expect(neutralized.adBreakHeartbeatParams).toBe("");
  });

  it("elimina una clave de anuncio cuyo valor no tiene vacío propio (number, boolean o null)", () => {
    const neutralized = view(pruneResponsePayload(PLAYER_URL, { adPlacements: 3, adSlots: true, playerAds: null }));

    expect("adPlacements" in neutralized).toBe(false);
    expect("adSlots" in neutralized).toBe(false);
    expect("playerAds" in neutralized).toBe(false);
  });

  it("neutraliza de forma pura con el vacío del tipo runtime y descarta el resto", () => {
    const source = {
      adPlacements: [{ ad: true }],
      adSlots: 7,
      playerAds: false,
      adBreakHeartbeatParams: "tok",
      videoDetails: { title: "Fixture" },
    };

    const result = view(neutralizeAdKeys(source, NEUTRALIZED_KEYS));

    expect(result.adPlacements).toEqual([]);
    expect(result.adBreakHeartbeatParams).toBe("");
    expect("adSlots" in result).toBe(false);
    expect("playerAds" in result).toBe(false);
    expect(key(result.videoDetails, "title")).toBe("Fixture");
  });

  it("devuelven la misma referencia cuando las claves de anuncio ya vienen vacías", () => {
    const payload = {
      adPlacements: [],
      playerAds: {},
      adBreakHeartbeatParams: "",
      streamingData: { formats: [{ itag: 137 }, { itag: 251 }] },
    };

    expect(neutralizeAdKeys(payload, NEUTRALIZED_KEYS)).toBe(payload);
    expect(pruneResponsePayload(PLAYER_URL, payload)).toBe(payload);
  });

  it("devuelven la misma referencia cuando solo hay arrays orgánicos", () => {
    const payload = {
      videoDetails: { videoId: "x" },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: "u" }] } },
    };

    expect(neutralizeAdKeys(payload, NEUTRALIZED_KEYS)).toBe(payload);
  });

  it("reconstruyen solo cuando hay un escalarn de anuncio que eliminar", () => {
    const payload = { videoDetails: { videoId: "x" }, playerAds: 42 };

    expect(neutralizeAdKeys(payload, NEUTRALIZED_KEYS)).not.toBe(payload);
  });

  it("devuelve el mismo objeto cuando la respuesta no trae claves de anuncio", () => {
    const clean = { playabilityStatus: { status: "OK" }, videoDetails: { videoId: "dQw4w9WgXcQ" } };

    expect(pruneResponsePayload(PLAYER_URL, clean)).toBe(clean);
  });

  it("no muta el payload original", () => {
    const original = playerResponse();

    pruneResponsePayload(PLAYER_URL, original);

    expect(original.adPlacements).toHaveLength(1);
    expect(original.adSlots).toHaveLength(1);
    expect(original.playerAds).toHaveLength(1);
    expect(original.adBreakHeartbeatParams).toBe("heartbeat-token");
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
  const neutralized = { adBreakHeartbeatParams: "" };

  it("sombrean response cuando la página lee JSON parseado, que es la clave del parche", () => {
    const shadows = xhrShadows("json", neutralized);

    expect(shadows).toEqual([{ property: "response", value: neutralized }]);
  });

  it("sombread responseText y response en el modo por defecto y en text", () => {
    const body = JSON.stringify(neutralized);

    expect(xhrShadows("", neutralized)).toEqual([
      { property: "responseText", value: body },
      { property: "response", value: body },
    ]);
    expect(xhrShadows("text", neutralized)).toEqual(xhrShadows("", neutralized));
  });

  it("no promete podas imposibles en responseType binario", () => {
    expect(xhrShadows("arraybuffer", neutralized)).toEqual([]);
    expect(xhrShadows("blob", neutralized)).toEqual([]);
  });
});

describe("neutralización del carrier inline de la primera respuesta", () => {
  const carrier = () => ({
    videoDetails: { videoId: "dQw4w9WgXcQ" },
    adPlacements: [{ kind: "AD_PLACEMENT_KIND_END" }],
    playerAds: [{ format: "preroll" }],
    adSlots: [{ slotId: "f0V3AVY6" }],
    adBreakHeartbeatParams: "Q0FBJTNE",
  });

  it("devuelven el carrier con las claves de anuncio presentes y vacías", () => {
    const result = initialResponseValue(carrier(), NEUTRALIZED_KEYS);

    expect(key(result, "adPlacements")).toEqual([]);
    expect(key(result, "playerAds")).toEqual([]);
    expect(key(result, "adSlots")).toEqual([]);
    expect(key(result, "adBreakHeartbeatParams")).toBe("");
    expect(key(result, "videoDetails")).toEqual({ videoId: "dQw4w9WgXcQ" });
  });

  it("no tocan valores que no son un objeto JSON", () => {
    expect(initialResponseValue(undefined, NEUTRALIZED_KEYS)).toBeUndefined();
    expect(initialResponseValue(null, NEUTRALIZED_KEYS)).toBeNull();
    expect(initialResponseValue("hola", NEUTRALIZED_KEYS)).toBe("hola");
    expect(initialResponseValue(42, NEUTRALIZED_KEYS)).toBe(42);
    expect(initialResponseValue([carrier()], NEUTRALIZED_KEYS)).toEqual([carrier()]);
  });

  it("devuelven la misma referencia cuando no hay nada que neutralizar", () => {
    const clean = { videoDetails: { videoId: "x" } };

    expect(initialResponseValue(clean, NEUTRALIZED_KEYS)).toBe(clean);
  });

  it("instalan antes que la página y neutralizan lo que esta asigna después", () => {
    const host: CarrierHost = {};
    const status = carrierStatusSeed();

    expect(shadowInlineCarrier(host, NEUTRALIZED_KEYS, status)).toBe(true);
    host.ytInitialPlayerResponse = carrier();

    const seen = host.ytInitialPlayerResponse;
    expect(key(seen, "playerAds")).toEqual([]);
    expect(key(seen, "adBreakHeartbeatParams")).toBe("");
  });

  it("neutralizan también el valor que ya estaba asignado cuando la propiedad existía como dato", () => {
    const host: CarrierHost = { ytInitialPlayerResponse: carrier() };
    const status = carrierStatusSeed();

    expect(shadowInlineCarrier(host, NEUTRALIZED_KEYS, status)).toBe(false);
    expect(status.carrierPruned).toBe(true);
    expect(key(host.ytInitialPlayerResponse, "adPlacements")).toEqual([]);
  });

  it("informan que no instalaron la trampa si la propiedad ya estaba declarada, y aun así neutralizan", () => {
    const host: CarrierHost = {};
    const existing = carrier();
    const status = carrierStatusSeed();
    Object.defineProperty(host, "ytInitialPlayerResponse", {
      configurable: false,
      enumerable: true,
      value: existing,
      writable: true,
    });

    expect(shadowInlineCarrier(host, NEUTRALIZED_KEYS, status)).toBe(false);
    expect(status.carrierPruned).toBe(true);
    expect(key(host.ytInitialPlayerResponse, "adPlacements")).toEqual([]);
  });

  it("no tocan un carrier no-configurable y no-writable, y avisan que no podaron", () => {
    const host: CarrierHost = {};
    const existing = carrier();
    const status = carrierStatusSeed();
    Object.defineProperty(host, "ytInitialPlayerResponse", {
      configurable: false,
      enumerable: true,
      value: existing,
      writable: false,
    });

    expect(shadowInlineCarrier(host, NEUTRALIZED_KEYS, status)).toBe(false);
    expect(status.carrierPruned).toBe(false);
    expect(host.ytInitialPlayerResponse).toBe(existing);
  });
});

describe("el muro de enforcement en el carrier inline", () => {
  const wallCarrier = () => ({
    videoDetails: { videoId: "dQw4w9WgXcQ" },
    playabilityStatus: {
      status: "ERROR",
      errorScreen: {
        enforcementMessageViewModel: { title: { content: "Ad blockers violate YouTube's Terms of Service" } },
      },
    },
  });

  it("reescriben el muro del carrier en la trampa y lo marcan en el estado", () => {
    const host: CarrierHost = {};
    const status = carrierStatusSeed();
    const network = networkStatusSeed();

    shadowInlineCarrier(host, NEUTRALIZED_KEYS, status, network);
    host.ytInitialPlayerResponse = wallCarrier();

    const playability = view(key(host.ytInitialPlayerResponse, "playabilityStatus"));
    expect(status.wallRewritten).toBe(true);
    expect(playability.status).toBe("OK");
    expect("errorScreen" in playability).toBe(false);
  });

  it("no marcan el muro en un carrier limpio", () => {
    const host: CarrierHost = {};
    const status = carrierStatusSeed();

    shadowInlineCarrier(host, NEUTRALIZED_KEYS, status);
    host.ytInitialPlayerResponse = { videoDetails: { videoId: "dQw4w9WgXcQ" } };

    expect(status.wallRewritten).toBe(false);
  });
});

describe("el carrier inline vuelve a ser data property después de neutralizarlo", () => {
  const carrier = () => ({
    videoDetails: { videoId: "dQw4w9WgXcQ" },
    adPlacements: [{ kind: "AD_PLACEMENT_KIND_END" }],
    playerAds: [{ format: "preroll" }],
    adSlots: [{ slotId: "f0V3AVY6" }],
    adBreakHeartbeatParams: "Q0FBJTNE",
  });

  // La página declara el carrier con `var` a nivel global: data property, writable, enumerable,
  // no configurable. Dejar un accesorio get/set es una huella trivialmente detectable, y el muro
  // "Ad blockers violate YouTube's ToS" (.ytp-mdx-popup-dialog, playabilityStatus ERROR) apareció
  // justo cuando esa fue la técnica. Ver odd/specs/youtube-evidence.md §10.
  const varShape = { accessors: "dato", value: "presente", writable: true, configurable: false };

  it("restauran la forma exacta de un var global tras la asignación de la página", () => {
    const host: CarrierHost = {};
    const status = carrierStatusSeed();

    shadowInlineCarrier(host, NEUTRALIZED_KEYS, status);
    host.ytInitialPlayerResponse = carrier();

    expect(carrierDescriptor(host)).toEqual(varShape);
  });

  it("mantienen el descriptor de dato aunque la página lea el carrier después de asignarlo", () => {
    const host: CarrierHost = {};
    const status = carrierStatusSeed();

    shadowInlineCarrier(host, NEUTRALIZED_KEYS, status);
    host.ytInitialPlayerResponse = carrier();
    expect(host.ytInitialPlayerResponse).toBeDefined();

    expect(carrierDescriptor(host)).toEqual(varShape);
  });

  it("no dejan restos de accesorio: ni get ni set visibles en la propiedad", () => {
    const host: CarrierHost = {};
    const status = carrierStatusSeed();

    shadowInlineCarrier(host, NEUTRALIZED_KEYS, status);
    host.ytInitialPlayerResponse = carrier();

    const descriptor = Object.getOwnPropertyDescriptor(host, INLINE_CARRIER);
    expect("get" in (descriptor ?? {})).toBe(false);
    expect("set" in (descriptor ?? {})).toBe(false);
  });

  it("informan accessorInstalled solo cuando se ganó la carrera, y carrierPruned al podar", () => {
    const host: CarrierHost = {};
    const status = carrierStatusSeed();

    expect(shadowInlineCarrier(host, NEUTRALIZED_KEYS, status)).toBe(true);
    expect(status).toEqual({
      accessorInstalled: true,
      carrierPruned: false,
      wallRewritten: false,
      playerRescues: 0,
      rescueTicks: 0,
      rescuePlayerSeen: false,
      rescueWallSeen: false,
      rescueErrors: 0,
      rescueLastAt: -1,
    });

    host.ytInitialPlayerResponse = carrier();
    expect(status).toEqual({
      accessorInstalled: true,
      carrierPruned: true,
      wallRewritten: false,
      playerRescues: 0,
      rescueTicks: 0,
      rescuePlayerSeen: false,
      rescueWallSeen: false,
      rescueErrors: 0,
      rescueLastAt: -1,
    });
  });

  it("restauran en el acto cuando el carrier ya venía asignado al instalarse", () => {
    const host: CarrierHost = { ytInitialPlayerResponse: carrier() };
    const status: CarrierStatus = carrierStatusSeed();

    expect(shadowInlineCarrier(host, NEUTRALIZED_KEYS, status)).toBe(false);

    expect(carrierDescriptor(host)).toEqual(varShape);
    expect(status.carrierPruned).toBe(true);
    expect(key(host.ytInitialPlayerResponse, "adPlacements")).toEqual([]);
  });

  it("restauran sin neutralizar un valor que no es un objeto JSON", () => {
    const host: CarrierHost = {};
    const status = carrierStatusSeed();

    shadowInlineCarrier(host, NEUTRALIZED_KEYS, status);
    host.ytInitialPlayerResponse = "ok";

    expect(host.ytInitialPlayerResponse).toBe("ok");
    expect(carrierDescriptor(host)).toEqual(varShape);
  });

  it("cuentan los anuncios del carrier inline, que es de donde sale el pre-roll", () => {
    const host: CarrierHost = {};
    const network = networkStatusSeed();

    shadowInlineCarrier(host, NEUTRALIZED_KEYS, carrierStatusSeed(), network);
    host.ytInitialPlayerResponse = { adPlacements: [{ kind: "preroll" }, { kind: "midroll" }] };

    expect(network.adsFound).toEqual({ adPlacements: 2 });
  });

  it("no inflan adsFound cuando el carrier no traía anuncios", () => {
    const host: CarrierHost = { ytInitialPlayerResponse: { videoDetails: { videoId: "x" }, adPlacements: [] } };
    const network = networkStatusSeed();

    shadowInlineCarrier(host, NEUTRALIZED_KEYS, carrierStatusSeed(), network);

    expect(network.adsFound).toEqual({});
    expect(host.ytInitialPlayerResponse).toEqual({ videoDetails: { videoId: "x" }, adPlacements: [] });
  });

  it("mantienen la misma referencia del carrier cuando no hay nada que neutralizar", () => {
    const existing = { videoDetails: { videoId: "x" }, playerAds: [], adBreakHeartbeatParams: "" };
    const host: CarrierHost = { ytInitialPlayerResponse: existing };

    shadowInlineCarrier(host, NEUTRALIZED_KEYS, carrierStatusSeed());

    expect(host.ytInitialPlayerResponse).toBe(existing);
  });

  it("neutraliza el carrier de extremo a extremo a través de la trampa y deja una data property no configurable", () => {
    const host: CarrierHost = {};
    const status = carrierStatusSeed();

    shadowInlineCarrier(host, NEUTRALIZED_KEYS, status);
    host.ytInitialPlayerResponse = {
      adPlacements: [{ kind: "AD_PLACEMENT_KIND_END" }],
      adBreakHeartbeatParams: "abc",
    };

    expect(key(host.ytInitialPlayerResponse, "adPlacements")).toEqual([]);
    expect(key(host.ytInitialPlayerResponse, "adBreakHeartbeatParams")).toBe("");
    expect(carrierDescriptor(host)).toEqual(varShape);
  });

  it("seed de estado arranca sin trampa ni poda", () => {
    expect(carrierStatusSeed()).toEqual({
      accessorInstalled: false,
      carrierPruned: false,
      wallRewritten: false,
      playerRescues: 0,
      rescueTicks: 0,
      rescuePlayerSeen: false,
      rescueWallSeen: false,
      rescueErrors: 0,
      rescueLastAt: -1,
    });
  });
});

describe("telemetría de estado opt-in por token de URL", () => {
  it("publica con el token de depuración presente", () => {
    expect(shouldPublishStatus("?blockadsdebug=1")).toBe(true);
  });

  it("publica con el token en cualquier posición de la query", () => {
    expect(shouldPublishStatus("?v=x&blockadsdebug")).toBe(true);
  });

  it("no publica con query vacía", () => {
    expect(shouldPublishStatus("")).toBe(false);
  });

  it("no publica en un watch normal de YouTube", () => {
    expect(shouldPublishStatus("?v=dQw4w9WgXcQ")).toBe(false);
  });

  it("fija el nombre del token para que no se renombre por accidente", () => {
    expect(DEBUG_PARAM).toBe("blockadsdebug");
  });

  it("no añade la clave de telemetría al host al podar el carrier", () => {
    const host: CarrierHost = {
      ytInitialPlayerResponse: {
        videoDetails: { videoId: "dQw4w9WgXcQ" },
        adPlacements: [{ kind: "AD_PLACEMENT_KIND_END" }],
        adBreakHeartbeatParams: "Q0FBJTNE",
      },
    };
    const status = carrierStatusSeed();

    shadowInlineCarrier(host, NEUTRALIZED_KEYS, status);

    expect(Object.keys(host)).not.toContain("__blockAdsInnerTube");
  });

  it("fija el nombre del estado de red para que no se renombre por accidente", () => {
    expect(NETWORK_STATUS_KEY).toBe("__blockAdsNetwork");
  });
});

describe("telemetría de red para distinguir un parche muerto de un bypass", () => {
  it("seed de red arranca en cero y sin rutas", () => {
    expect(networkStatusSeed()).toEqual({
      seen: 0,
      matched: 0,
      neutralized: 0,
      enforcement: 0,
      adsFound: {},
      matchedPaths: [],
    });
  });

  it("cuentan cada petición que pasa por el transport, aunque no sea de poda", () => {
    const status = networkStatusSeed();

    recordTransport(status, "https://www.youtube.com/youtubei/v1/browse");

    expect(status).toEqual({
      seen: 1,
      matched: 0,
      neutralized: 0,
      enforcement: 0,
      adsFound: {},
      matchedPaths: [],
    });
  });

  it("cuenten matched y guardan la ruta sin query cuando la petición es de poda", () => {
    const status = networkStatusSeed();

    recordTransport(status, PLAYER_URL);
    recordTransport(status, NEXT_URL);

    expect(status.matched).toBe(2);
    expect(status.matchedPaths).toEqual(["/youtubei/v1/next", "/youtubei/v1/player"]);
  });

  it("no guardan rutas de peticiones que no se podan", () => {
    const status = networkStatusSeed();

    recordTransport(status, "https://www.youtube.com/api/timedtext?v=x");

    expect(status.matchedPaths).toEqual([]);
  });

  it("acotan las rutas a ocho y conservan las más recientes", () => {
    const status = networkStatusSeed();

    Array.from({ length: 11 }, () => recordTransport(status, PLAYER_URL));

    expect(status.seen).toBe(11);
    expect(status.matched).toBe(11);
    expect(status.matchedPaths).toHaveLength(8);
    expect(status.matchedPaths.every((path) => path === "/youtubei/v1/player")).toBe(true);
  });

  it("suman neutralized solo cuando la respuesta se reconstruyó", () => {
    const status = networkStatusSeed();

    recordTransport(status, PLAYER_URL);
    expect(status.neutralized).toBe(0);

    markNeutralized(status);
    expect(status.neutralized).toBe(1);
  });

  it("suman enforcement solo cuando se reescribió el muro", () => {
    const status = networkStatusSeed();

    expect(status.enforcement).toBe(0);
    markEnforcementRewritten(status);
    expect(status.enforcement).toBe(1);
  });

  it("leen la URL relativa igual que el filtro de endpoint", () => {
    const status = networkStatusSeed();

    recordTransport(status, "/youtubei/v1/player?key=AIzaSyFixture");

    expect(status).toEqual({
      seen: 1,
      matched: 1,
      neutralized: 0,
      enforcement: 0,
      adsFound: {},
      matchedPaths: ["/youtubei/v1/player"],
    });
  });
});

describe("conteo de anuncios reales antes de neutralizar", () => {
  it("cuentan los elementos de cada clave de anuncio llena, incluidas las anidadas", () => {
    const found = countAdKeys(playerResponse(), NEUTRALIZED_KEYS);

    expect(found).toEqual({ adPlacements: 1, adSlots: 1, playerAds: 1, adBreakHeartbeatParams: 2 });
  });

  it("no registran nada cuando las claves ya vienen vacías", () => {
    const found = countAdKeys(
      { adPlacements: [], playerAds: {}, adBreakHeartbeatParams: "", videoDetails: { videoId: "x" } },
      NEUTRALIZED_KEYS,
    );

    expect(found).toEqual({});
  });

  it("suman un heartbeat vacío como cero, no como uno", () => {
    expect(countAdKeys({ adBreakHeartbeatParams: "" }, NEUTRALIZED_KEYS)).toEqual({});
  });

  it("ignoran las claves que no están en la config", () => {
    expect(countAdKeys({ streamingData: { formats: [{ itag: 137 }, { itag: 251 }] } }, NEUTRALIZED_KEYS)).toEqual({});
  });

  it("cuentan dentro de arrays de acciones, que es donde vive el ad break real", () => {
    const payload = { onResponseReceivedActions: [{ adPlacements: [{ kind: "preroll" }, { kind: "midroll" }] }] };

    expect(countAdKeys(payload, NEUTRALIZED_KEYS)).toEqual({ adPlacements: 2 });
  });

  it("acumulan por clave cada respuesta neutralizada", () => {
    const status = networkStatusSeed();

    markAdsFound(status, { adPlacements: 1, playerAds: 1 });
    markAdsFound(status, { adPlacements: 2 });

    expect(status.adsFound).toEqual({ adPlacements: 3, playerAds: 1 });
  });

  it("dan las claves de poda del endpoint pedido, y ninguna para los que no se podan", () => {
    expect(neutralizationKeysFor(PLAYER_URL)).toEqual(NEUTRALIZED_KEYS);
    expect(neutralizationKeysFor("https://www.youtube.com/youtubei/v1/browse")).toEqual([]);
  });
});
