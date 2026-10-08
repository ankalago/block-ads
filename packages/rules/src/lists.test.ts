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

const cosmeticSelectors = (): readonly string[] =>
  parsedLists().flatMap((entry) => entry.list.filters.filter(isCosmetic).map((filter) => filter.selector));

const unsupportedReasons = (): readonly UnsupportedReason[] =>
  parsedLists().flatMap((entry) => entry.list.unsupported.map((line) => line.reason));

/** Único motivo tolerado: cabeceras (`comment`) y líneas en blanco (`empty`). */
const EXPECTED_UNSUPPORTED_REASONS: readonly UnsupportedReason[] = ["comment", "empty"];

/** Selectores verificados en `odd/specs/youtube-evidence.md` §3; ninguno inventado. */
const VERIFIED_SELECTORS: readonly string[] = [
  "ytd-ad-slot-renderer",
  "#masthead-ad",
  "ytd-in-feed-ad-layout-renderer",
  "video-ads ytp-ad-module",
  "ytp-ad-progress-list",
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

  it("solo usa selectores cosméticos verificados", () => {
    const unverified = cosmeticSelectors().filter((selector) => !VERIFIED_SELECTORS.includes(selector));

    expect(unverified).toEqual([]);
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

    expect(allowRules).toHaveLength(1);

    const canary = allowRules.at(0);

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
});
