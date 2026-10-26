import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DnrRule } from "@block-ads/core/dnr";
import { compileToDnrRules } from "@block-ads/core/dnr";
import { parseFilterList } from "@block-ads/core/parser";
import type { CosmeticFilter, Filter, NetworkFilter, UnsupportedReason } from "@block-ads/core/rules";
import { describe, expect, it } from "vitest";

const listsDir = fileURLToPath(new URL("../lists", import.meta.url));

/** Listas ABP del paquete; cualquier `.txt` nuevo entra en el guard automáticamente. */
const listNames = (): readonly string[] =>
  readdirSync(listsDir)
    .filter((name) => name.endsWith(".txt"))
    .sort();

const readList = (name: string): string => readFileSync(`${listsDir}/${name}`, "utf8");

const parsedLists = () => listNames().map((name) => ({ name, list: parseFilterList(readList(name)) }));

const isNetwork = (filter: Filter): filter is NetworkFilter => filter.type === "network";
const isCosmetic = (filter: Filter): filter is CosmeticFilter => filter.type === "cosmetic";

const networkFilters = (): readonly NetworkFilter[] =>
  parsedLists().flatMap((entry) => entry.list.filters.filter(isNetwork));

const compiledRules = (): readonly DnrRule[] =>
  parsedLists().flatMap((entry) => compileToDnrRules(entry.list.filters.filter(isNetwork)).rules);

/**
 * Un `allow` sin ruta reabre el host publicitario entero. Se exige que el `urlFilter`
 * tenga un `/` después de la parte de host, nunca solo el ancla de dominio.
 */
const isBareHostAnchor = (rule: DnrRule): boolean => {
  const urlFilter = rule.condition.urlFilter;
  if (urlFilter === undefined) return true;
  const body = urlFilter.startsWith("||") ? urlFilter.slice(2) : urlFilter;
  const separatorIndex = body.search(/[/^]/);
  return separatorIndex === -1 || body[separatorIndex] !== "/";
};

const cosmeticSelectors = (): readonly string[] =>
  parsedLists().flatMap((entry) => entry.list.filters.filter(isCosmetic).map((filter) => filter.selector));

const unsupportedReasons = (): readonly UnsupportedReason[] =>
  parsedLists().flatMap((entry) => entry.list.unsupported.map((line) => line.reason));

/** Único motivo tolerado: cabeceras (`comment`) y líneas en blanco (`empty`). */
const EXPECTED_UNSUPPORTED_REASONS: readonly UnsupportedReason[] = ["comment", "empty"];

/** Selectores verificados en `odd/specs/youtube-evidence.md` §3; las clases del player llevan punto. */
const VERIFIED_SELECTORS: readonly string[] = [
  "ytd-ad-slot-renderer",
  "#masthead-ad",
  "ytd-in-feed-ad-layout-renderer",
  ".video-ads.ytp-ad-module",
  ".ytp-ad-progress-list",
  ".ytdMiniplayerPlayerContainerHost .ytdMiniplayerPlayerContainerPlayabilityError",
  "ytd-miniplayer yt-playability-error-supported-renderers",
];

describe("listas de reglas del paquete @block-ads/rules", () => {
  it("incluye la lista de YouTube", () => {
    expect(listNames()).toContain("youtube.txt");
  });

  it("compila cada lista sin errores del compiler ni reglas descartadas", () => {
    const results = parsedLists().map((entry) => ({
      compiled: compileToDnrRules(entry.list.filters.filter(isNetwork)),
    }));

    expect(results.flatMap((entry) => entry.compiled.report.errors)).toEqual([]);
    expect(results.flatMap((entry) => entry.compiled.report.dropped)).toEqual([]);
    expect(results.every((entry) => entry.compiled.report.ok)).toBe(true);
  });

  it("solo descarta líneas por comentario o vacío", () => {
    const unexpected = unsupportedReasons().filter((reason) => !EXPECTED_UNSUPPORTED_REASONS.includes(reason));

    expect(unexpected).toEqual([]);
  });

  it("solo usa selectores cosméticos verificados y con prefijo de clase en nodos del player", () => {
    const selectors = cosmeticSelectors();
    const unverified = selectors.filter((selector) => !VERIFIED_SELECTORS.includes(selector));

    expect(unverified).toEqual([]);
    expect(selectors).toContain(".video-ads.ytp-ad-module");
    expect(selectors).toContain(".ytp-ad-progress-list");
    expect(selectors).toContain(".ytdMiniplayerPlayerContainerHost .ytdMiniplayerPlayerContainerPlayabilityError");
    expect(selectors).toContain("ytd-miniplayer yt-playability-error-supported-renderers");
  });

  it("no bloquea dominios enteros de telemetría ActiveView (googlesyndication/googleadservices) que disparan el muro en cliente", () => {
    const rules = compiledRules();
    const baitBlocks = rules.filter(
      (rule) =>
        rule.action.type === "block" &&
        (rule.condition.urlFilter?.includes("googlesyndication.com") === true ||
          rule.condition.urlFilter?.includes("googleadservices.com") === true),
    );

    expect(baitBlocks).toEqual([]);
  });

  it("bloquea get_midroll_info solo como xmlhttprequest, nunca como documento", () => {
    const midroll = networkFilters().filter((filter) => filter.source.includes("get_midroll_info"));

    expect(midroll.map((filter) => filter.resourceTypes)).toEqual([["xmlhttprequest"]]);
    expect(midroll.some((filter) => filter.resourceTypes.includes("document"))).toBe(false);
  });

  // El test de arriba solo protege get_midroll_info por comparación exacta de forma. Esta
  // propiedad es la que vale para la lista entera: ninguna regla compilada puede llevar
  // main_frame, porque bloquear la navegación top-level deja la página en blanco.
  it("ninguna regla compilada puede bloquear la navegación top-level", () => {
    const unsafe = compiledRules().filter((rule) => rule.condition.resourceTypes?.includes("main_frame") === true);

    expect(unsafe.map((rule) => rule.condition.urlFilter ?? rule.condition.regexFilter)).toEqual([]);
  });

  // Canary clásico de detección de ad-blocker de YouTube: `ad_status.js` solo
  // establece `window.google_ad_status = 1`, y bloquearlo es lo que dispara la
  // pared "Ad blockers violate YouTube's ToS" (decidida por el player). Se deja
  // pasar solo ese recurso; el resto de doubleclick.net sigue bloqueado.
  it("permite el canary ad_status.js de YouTube y conserva el resto de doubleclick.net bloqueado", () => {
    const rules = compiledRules();
    const allowRules = rules.filter((rule) => rule.action.type === "allow");

    expect(allowRules).toHaveLength(2);

    const canary = allowRules.find(
      (rule) => rule.condition.urlFilter === "||static.doubleclick.net/instream/ad_status.js",
    );

    // El filtro debe ser exactamente el canary, no un patrón que reabra doubleclick.net.
    expect(canary?.condition.urlFilter).toBe("||static.doubleclick.net/instream/ad_status.js");
    // Acotado a páginas de YouTube mediante `$domain=youtube.com` → initiatorDomains.
    expect(canary?.condition.initiatorDomains).toEqual(["youtube.com"]);

    // La `allow` debe ganar a todo `block`, en particular a `||doubleclick.net^`.
    const blockPriorities = rules.filter((rule) => rule.action.type === "block").map((rule) => rule.priority);

    expect(canary?.priority).toBeGreaterThan(Math.max(...blockPriorities));

    // `||doubleclick.net^` sigue presente y sigue cubriendo googleads.g.doubleclick.net.
    const doubleclickBlock = rules.find(
      (rule) => rule.action.type === "block" && rule.condition.urlFilter?.includes("doubleclick.net"),
    );

    expect(doubleclickBlock?.condition.urlFilter).toBe("||doubleclick.net^");
  });

  // Segunda excepción: un fallo de /pagead/id es otro vector de detección (uBO lo
  // neutraliza en uAssets). Se acota al recurso exacto y a páginas de YouTube.
  it("permite el endpoint /pagead/id solo en YouTube y no reabre ningún host entero", () => {
    const rules = compiledRules();
    const allowRules = rules.filter((rule) => rule.action.type === "allow");

    const pagead = allowRules.filter((rule) => rule.condition.urlFilter === "||googleads.g.doubleclick.net/pagead/id");

    expect(pagead).toHaveLength(1);

    const pageadRule = pagead.at(0);

    expect(pageadRule?.condition.initiatorDomains).toEqual(["youtube.com"]);

    const blockPriorities = rules.filter((rule) => rule.action.type === "block").map((rule) => rule.priority);

    expect(pageadRule?.priority).toBeGreaterThan(Math.max(...blockPriorities));

    // Propiedad de grupo: ninguna `allow` puede ser un ancla de host desnuda; debe
    // nombrar una ruta, o una excepción reabriría un host publicitario entero.
    const bareHostAnchors = allowRules
      .filter(isBareHostAnchor)
      .map((rule) => rule.condition.urlFilter ?? rule.condition.regexFilter ?? "<sin filtro>");

    expect(bareHostAnchors, `reglas allow que reabren un host entero: ${bareHostAnchors.join(", ")}`).toEqual([]);
  });
});
