import { describe, expect, it } from "vitest";
import {
  type BlockedHit,
  DNR_BLOCKED_KEY,
  filterForId,
  filterMapFromRules,
  hitKey,
  MAX_BLOCKED_HITS,
  recordHit,
} from "./dnr-debug.ts";

const makeHit = (ruleId: number, hits: number, at: number): BlockedHit => ({
  ruleId,
  url: `https://example.com/${ruleId}.js`,
  resourceType: "script",
  filter: `filter-${ruleId}`,
  hits,
  at,
});

describe("hitKey", () => {
  it("deduplica por regla, url y tipo de recurso", () => {
    expect(hitKey({ ruleId: 7, url: "https://track.test/a.js", resourceType: "image" })).toBe(
      "7|https://track.test/a.js|image",
    );
  });

  it("expone la clave de storage y el límite del buffer", () => {
    expect(DNR_BLOCKED_KEY).toBe("dnrBlocked");
    expect(MAX_BLOCKED_HITS).toBe(60);
  });
});

describe("recordHit", () => {
  it("incrementa los impactos de una entrada existente y la mueve al final", () => {
    const buffer = [makeHit(1, 1, 10), makeHit(2, 3, 20)];
    const incoming = { ruleId: 1, url: "https://example.com/1.js", resourceType: "script", filter: "fresh" };

    const next = recordHit(buffer, incoming, 99);

    expect(next.map((hit) => hit.ruleId)).toEqual([2, 1]);
    expect(next.find((hit) => hit.ruleId === 1)).toEqual({
      ruleId: 1,
      url: "https://example.com/1.js",
      resourceType: "script",
      filter: "fresh",
      hits: 2,
      at: 99,
    });
  });

  it("añade una entrada nueva al final con un impacto", () => {
    const buffer = [makeHit(1, 1, 10)];
    const incoming = { ruleId: 5, url: "https://example.com/5.js", resourceType: "script", filter: "filter-5" };

    const next = recordHit(buffer, incoming, 42);

    expect(next.map((hit) => hit.ruleId)).toEqual([1, 5]);
    expect(next.at(-1)).toEqual({
      ruleId: 5,
      url: "https://example.com/5.js",
      resourceType: "script",
      filter: "filter-5",
      hits: 1,
      at: 42,
    });
  });

  it("no supera el límite y descarta primero las entradas más antiguas", () => {
    const full = Array.from({ length: MAX_BLOCKED_HITS }, (_, index) => makeHit(index + 1, 1, index));
    const incoming = { ruleId: 999, url: "https://example.com/999.js", resourceType: "script", filter: "f" };

    const next = recordHit(full, incoming, 1_000);

    expect(next).toHaveLength(MAX_BLOCKED_HITS);
    expect(next[0]?.ruleId).toBe(2);
    expect(next.at(-1)?.ruleId).toBe(999);
  });

  it("no muta el buffer de entrada", () => {
    const buffer = [makeHit(1, 1, 10), makeHit(2, 1, 20)];
    const snapshot = buffer.map((hit) => ({ ...hit }));
    const incoming = { ruleId: 1, url: "https://example.com/1.js", resourceType: "script", filter: "fresh" };

    recordHit(buffer, incoming, 30);

    expect(buffer).toEqual(snapshot);
  });

  it("devuelve un único elemento cuando el buffer está vacío", () => {
    const incoming = { ruleId: 8, url: "https://example.com/8.js", resourceType: "script", filter: "f" };

    const next = recordHit([], incoming, 77);

    expect(next).toEqual([
      { ruleId: 8, url: "https://example.com/8.js", resourceType: "script", filter: "f", hits: 1, at: 77 },
    ]);
  });
});

describe("filterMapFromRules", () => {
  it("prefiere urlFilter sobre regexFilter", () => {
    const map = filterMapFromRules([{ id: 7, condition: { urlFilter: "primary", regexFilter: "fallback" } }]);

    expect(filterForId(map, 7)).toBe("primary");
  });

  it("recurre a regexFilter cuando no hay urlFilter", () => {
    const map = filterMapFromRules([{ id: 2, condition: { regexFilter: "^https://track" } }]);

    expect(filterForId(map, 2)).toBe("^https://track");
  });

  it("mapea a cadena vacía cuando la condición no trae filtro", () => {
    const map = filterMapFromRules([{ id: 3, condition: {} }]);

    expect(filterForId(map, 3)).toBe("");
  });

  it("devuelve cadena vacía para un id desconocido", () => {
    const map = filterMapFromRules([{ id: 1, condition: { urlFilter: "ads" } }]);

    expect(filterForId(map, 404)).toBe("");
  });
});
