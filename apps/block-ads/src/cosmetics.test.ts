import type { CosmeticFilter } from "@block-ads/core/rules";
import { describe, expect, it } from "vitest";
import { compileCosmetics } from "./cosmetics.ts";

const cosmetic = (overrides: Partial<CosmeticFilter>): CosmeticFilter => ({
  type: "cosmetic",
  source: "youtube.com##.ad-banner",
  exception: false,
  hostnames: ["youtube.com"],
  selector: ".ad-banner",
  ...overrides,
});

/** Hosts que declara el manifest para el content script de cosméticos. */
const INJECTED = ["youtube.com"];

describe("compilación de cosméticos a CSS", () => {
  it("convierte un filtro del host inyectado en una regla display:none", () => {
    const { css, report } = compileCosmetics([cosmetic({})], INJECTED);

    expect(css).toContain(".ad-banner { display: none !important; }");
    expect(report.emitted).toBe(1);
    expect(report.entries).toHaveLength(1);
  });

  it("mantiene dentro del alcance los filtros de subdominios del host inyectado", () => {
    const filter = cosmetic({ source: "www.youtube.com##.ytp-ad-overlay-slot", hostnames: ["www.youtube.com"] });
    const { report } = compileCosmetics([filter], INJECTED);

    expect(report.emitted).toBe(1);
    expect(report.outOfScope).toHaveLength(0);
  });

  it("omite y reporta las reglas cuyo host queda fuera del alcance de inyección", () => {
    const filter = cosmetic({ source: "news.example.com##.sponsored", hostnames: ["news.example.com"] });
    const { css, report } = compileCosmetics([filter], INJECTED);

    expect(css).not.toContain(".sponsored");
    expect(report.emitted).toBe(0);
    expect(report.outOfScope.map((entry) => entry.source)).toEqual(["news.example.com##.sponsored"]);
  });

  it("recoge la excepción #@# en el reporte y no emite CSS por ella", () => {
    const exception = cosmetic({ exception: true, source: "youtube.com#@#.ad-banner" });
    const { css, report } = compileCosmetics([exception], INJECTED);

    expect(css).toBe("");
    expect(report.emitted).toBe(0);
    expect(report.exceptions.map((entry) => entry.source)).toEqual(["youtube.com#@#.ad-banner"]);
  });

  it("aplica al host inyectado los filtros globales, que no declaran host", () => {
    const global = cosmetic({ source: "##.ad-banner", hostnames: [] });
    const { css, report } = compileCosmetics([global], INJECTED);

    expect(css).toContain(".ad-banner { display: none !important; }");
    expect(report.emitted).toBe(1);
  });

  it("colapsa los selectores repetidos y los cuenta como duplicados", () => {
    const filters = [
      cosmetic({ source: "youtube.com##.a", selector: ".a" }),
      cosmetic({
        source: "youtube.com,www.youtube.com##.a",
        hostnames: ["youtube.com", "www.youtube.com"],
        selector: ".a",
      }),
    ];
    const { css, report } = compileCosmetics(filters, INJECTED);

    expect(css.match(/\.a \{/g) ?? []).toHaveLength(1);
    expect(report.emitted).toBe(1);
    expect(report.deduped).toBe(1);
  });

  it("respeta los hosts negados del filtro", () => {
    const filter = cosmetic({ source: "~youtube.com##.ad-banner", hostnames: ["~youtube.com"] });
    const { css, report } = compileCosmetics([filter], INJECTED);

    expect(css).toBe("");
    expect(report.outOfScope.map((entry) => entry.source)).toEqual(["~youtube.com##.ad-banner"]);
  });

  it("no emite CSS cuando no hay filtros", () => {
    const { css, report } = compileCosmetics([], INJECTED);

    expect(css).toBe("");
    expect(report.total).toBe(0);
    expect(report.entries).toHaveLength(0);
  });
});
