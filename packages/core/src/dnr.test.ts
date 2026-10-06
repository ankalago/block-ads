import { describe, expect, it } from "vitest";
import { compileToDnrRules } from "./dnr.ts";
import type { NetworkFilter } from "./rules.ts";

const networkFilter = (overrides: Partial<NetworkFilter>): NetworkFilter => ({
  type: "network",
  source: "||ads.example.com^",
  exception: false,
  pattern: { kind: "domainAnchor", hostname: "ads.example.com" },
  resourceTypes: [],
  thirdParty: undefined,
  initiatorDomains: [],
  denyAllow: [],
  ...overrides,
});

const indices = (count: number): readonly number[] => [...Array(count).keys()];

const manyRegexFilters = (count: number): readonly NetworkFilter[] =>
  indices(count).map((index) =>
    networkFilter({ source: `re${index}`, pattern: { kind: "regex", source: `re${index}` } }),
  );

const manyAnchorFilters = (count: number): readonly NetworkFilter[] =>
  indices(count).map((index) =>
    networkFilter({ source: `||h${index}.test^`, pattern: { kind: "domainAnchor", hostname: `h${index}.test` } }),
  );

describe("compileToDnrRules — mapeo de patrones", () => {
  it("traduce un ancla de dominio a urlFilter con ancla y cierre de host", () => {
    const { rules } = compileToDnrRules([
      networkFilter({ source: "||doubleclick.net^", pattern: { kind: "domainAnchor", hostname: "doubleclick.net" } }),
    ]);
    expect(rules[0]?.condition.urlFilter).toBe("||doubleclick.net^");
    expect(rules[0]?.condition.regexFilter).toBeUndefined();
  });

  it("conserva el asterisco dentro del hostname del ancla de dominio", () => {
    const { rules } = compileToDnrRules([
      networkFilter({ source: "||ad*host^", pattern: { kind: "domainAnchor", hostname: "ad*host" } }),
    ]);
    expect(rules[0]?.condition.urlFilter).toBe("||ad*host^");
  });

  it("pasa el substring tal cual, con sus tokens *, | y ^", () => {
    const { rules } = compileToDnrRules([
      networkFilter({ source: "ads*/x|^", pattern: { kind: "substring", value: "ads*/x|^" } }),
    ]);
    expect(rules[0]?.condition.urlFilter).toBe("ads*/x|^");
  });

  it("traduce un regex a regexFilter sin urlFilter", () => {
    const { rules } = compileToDnrRules([
      networkFilter({ source: "/ad[0-9]+\\.js/", pattern: { kind: "regex", source: "ad[0-9]+\\.js" } }),
    ]);
    expect(rules[0]?.condition.regexFilter).toBe("ad[0-9]+\\.js");
    expect(rules[0]?.condition.urlFilter).toBeUndefined();
  });

  it("deja la condición de un regex con regexFilter como única clave de patrón", () => {
    const { rules } = compileToDnrRules([networkFilter({ source: "/re/", pattern: { kind: "regex", source: "re" } })]);
    expect(Object.keys(rules[0]?.condition ?? {})).toEqual(["regexFilter"]);
  });
});

describe("compileToDnrRules — tipos de recurso", () => {
  it("expande document a main_frame y sub_frame", () => {
    const { rules } = compileToDnrRules([networkFilter({ resourceTypes: ["document"] })]);
    expect(rules[0]?.condition.resourceTypes).toEqual(["main_frame", "sub_frame"]);
  });

  it("mapea subdocument a sub_frame", () => {
    const { rules } = compileToDnrRules([networkFilter({ resourceTypes: ["subdocument"] })]);
    expect(rules[0]?.condition.resourceTypes).toEqual(["sub_frame"]);
  });

  it("deduplica sub_frame cuando conviven document y subdocument", () => {
    const { rules } = compileToDnrRules([networkFilter({ resourceTypes: ["document", "subdocument"] })]);
    expect(rules[0]?.condition.resourceTypes).toEqual(["main_frame", "sub_frame"]);
  });

  it("mapea los tipos idénticos de Chrome sin tocarlos", () => {
    const { rules } = compileToDnrRules([
      networkFilter({
        resourceTypes: [
          "script",
          "stylesheet",
          "image",
          "media",
          "font",
          "xmlhttprequest",
          "ping",
          "websocket",
          "other",
        ],
      }),
    ]);
    expect(rules[0]?.condition.resourceTypes).toEqual([
      "script",
      "stylesheet",
      "image",
      "media",
      "font",
      "xmlhttprequest",
      "ping",
      "websocket",
      "other",
    ]);
  });

  it("omite resourceTypes cuando el IR no restringe tipos", () => {
    const { rules } = compileToDnrRules([networkFilter({ resourceTypes: [] })]);
    expect(rules[0]?.condition.resourceTypes).toBeUndefined();
  });
});

describe("compileToDnrRules — acciones y prioridad", () => {
  it("marca un filtro normal como block con prioridad 1", () => {
    const { rules } = compileToDnrRules([networkFilter({})]);
    expect(rules[0]?.action).toEqual({ type: "block" });
    expect(rules[0]?.priority).toBe(1);
  });

  it("marca una excepción como allow con prioridad 2", () => {
    const { rules } = compileToDnrRules([networkFilter({ exception: true })]);
    expect(rules[0]?.action).toEqual({ type: "allow" });
    expect(rules[0]?.priority).toBe(2);
  });

  it("coloca las excepciones antes que los bloqueos", () => {
    const { rules } = compileToDnrRules([
      networkFilter({ source: "||b.com^", pattern: { kind: "domainAnchor", hostname: "b.com" } }),
      networkFilter({
        source: "@@||a.com^",
        exception: true,
        pattern: { kind: "domainAnchor", hostname: "a.com" },
      }),
    ]);
    expect(rules.map((rule) => rule.action.type)).toEqual(["allow", "block"]);
    expect(rules.map((rule) => rule.id)).toEqual([1, 2]);
  });
});

describe("compileToDnrRules — condiciones de dominio y parte", () => {
  it("traduce thirdParty true a domainType thirdParty", () => {
    const { rules } = compileToDnrRules([networkFilter({ thirdParty: true })]);
    expect(rules[0]?.condition.domainType).toBe("thirdParty");
  });

  it("traduce thirdParty false a domainType firstParty", () => {
    const { rules } = compileToDnrRules([networkFilter({ thirdParty: false })]);
    expect(rules[0]?.condition.domainType).toBe("firstParty");
  });

  it("omite domainType cuando thirdParty es undefined", () => {
    const { rules } = compileToDnrRules([networkFilter({ thirdParty: undefined })]);
    expect(rules[0]?.condition.domainType).toBeUndefined();
  });

  it("pone los términos sin ~ en initiatorDomains", () => {
    const { rules } = compileToDnrRules([networkFilter({ initiatorDomains: ["a.com", "b.com"] })]);
    expect(rules[0]?.condition.initiatorDomains).toEqual(["a.com", "b.com"]);
  });

  it("pone los términos con ~ en excludedInitiatorDomains sin el prefijo", () => {
    const { rules } = compileToDnrRules([networkFilter({ initiatorDomains: ["~a.com"] })]);
    expect(rules[0]?.condition.excludedInitiatorDomains).toEqual(["a.com"]);
    expect(rules[0]?.condition.initiatorDomains).toBeUndefined();
  });

  it("fusiona denyAllow en excludedInitiatorDomains", () => {
    const { rules } = compileToDnrRules([networkFilter({ denyAllow: ["allowed.com", "safe.test"] })]);
    expect(rules[0]?.condition.excludedInitiatorDomains).toEqual(["allowed.com", "safe.test"]);
  });

  it("deduplica un host que aparece como ~domain y como denyAllow", () => {
    const { rules } = compileToDnrRules([networkFilter({ initiatorDomains: ["~dup.com"], denyAllow: ["dup.com"] })]);
    expect(rules[0]?.condition.excludedInitiatorDomains).toEqual(["dup.com"]);
  });

  it("omite las listas de dominios vacías", () => {
    const { rules } = compileToDnrRules([networkFilter({ initiatorDomains: [], denyAllow: [] })]);
    expect(rules[0]?.condition.initiatorDomains).toBeUndefined();
    expect(rules[0]?.condition.excludedInitiatorDomains).toBeUndefined();
  });
});

describe("compileToDnrRules — ids y duplicados", () => {
  it("asigna ids consecutivos desde 1 en el orden estable", () => {
    const { rules } = compileToDnrRules([
      networkFilter({ source: "||z.com^", pattern: { kind: "domainAnchor", hostname: "z.com" } }),
      networkFilter({ source: "||a.com^", pattern: { kind: "domainAnchor", hostname: "a.com" } }),
      networkFilter({
        source: "@@||m.com^",
        exception: true,
        pattern: { kind: "domainAnchor", hostname: "m.com" },
      }),
    ]);
    expect(rules.map((rule) => rule.id)).toEqual([1, 2, 3]);
    expect(rules.map((rule) => rule.condition.urlFilter)).toEqual(["||m.com^", "||a.com^", "||z.com^"]);
  });

  it("colapsa duplicados con mismo source y acción y los reporta", () => {
    const filter = networkFilter({ source: "||ads.example.com^" });
    const { rules, report } = compileToDnrRules([filter, { ...filter }, { ...filter }]);
    expect(rules).toHaveLength(1);
    expect(report.total).toBe(3);
    expect(report.duplicates.map((duplicate) => duplicate.source)).toEqual([
      "||ads.example.com^",
      "||ads.example.com^",
    ]);
  });

  it("no colapsa un bloqueo y una excepción con el mismo source", () => {
    const block = networkFilter({ source: "||ads.example.com^" });
    const allow = networkFilter({ source: "||ads.example.com^", exception: true });
    const { rules, report } = compileToDnrRules([block, allow]);
    expect(rules).toHaveLength(2);
    expect(report.duplicates).toHaveLength(0);
  });

  it("mantiene ok true cuando solo hay duplicados sin errores", () => {
    const filter = networkFilter({ source: "||dup.example.com^" });
    const { report } = compileToDnrRules([filter, { ...filter }]);
    expect(report.duplicates).toHaveLength(1);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("produce el mismo ruleset con el IR en otro orden de entrada", () => {
    const blockB = networkFilter({ source: "||b.com^", pattern: { kind: "domainAnchor", hostname: "b.com" } });
    const blockA = networkFilter({ source: "||a.com^", pattern: { kind: "domainAnchor", hostname: "a.com" } });
    const regex = networkFilter({ source: "/re/", pattern: { kind: "regex", source: "re" } });
    const filters: readonly NetworkFilter[] = [blockB, blockA, regex];
    const shuffled: readonly NetworkFilter[] = [regex, blockB, blockA];
    expect(JSON.stringify(compileToDnrRules(shuffled).rules)).toBe(JSON.stringify(compileToDnrRules(filters).rules));
  });
});

describe("compileToDnrRules — validación de patrones", () => {
  it("descarta un regexFilter con caracteres no ASCII", () => {
    const { rules, report } = compileToDnrRules([
      networkFilter({ source: "/café/", pattern: { kind: "regex", source: "café" } }),
    ]);
    expect(rules).toHaveLength(0);
    expect(report.errors.map((error) => error.code)).toEqual(["non-ascii-regex"]);
  });

  it("descarta un regexFilter de más de 1000 caracteres", () => {
    const source = "a".repeat(1001);
    const { rules, report } = compileToDnrRules([
      networkFilter({ source: "long", pattern: { kind: "regex", source } }),
    ]);
    expect(rules).toHaveLength(0);
    expect(report.errors.map((error) => error.code)).toEqual(["regex-too-long"]);
  });

  const UNSUPPORTED_REGEX_SOURCES: readonly string[] = [
    "(?=ads)",
    "(?!ads)",
    "(?<=ads)",
    "(?<!ads)",
    "(?>ads)",
    "(?(1)ads)",
    "a\\1",
  ];

  it.each(UNSUPPORTED_REGEX_SOURCES)("descarta el constructo RE2 no soportado %s", (source) => {
    const { rules, report } = compileToDnrRules([
      networkFilter({ source: `/${source}/`, pattern: { kind: "regex", source } }),
    ]);
    expect(rules).toHaveLength(0);
    expect(report.errors.map((error) => error.code)).toEqual(["regex-unsupported-construct"]);
  });

  it("descarta un urlFilter vacío", () => {
    const { rules, report } = compileToDnrRules([networkFilter({ pattern: { kind: "substring", value: "" } })]);
    expect(rules).toHaveLength(0);
    expect(report.errors.map((error) => error.code)).toEqual(["empty-url-filter"]);
  });

  it("descarta un regexFilter con source vacío", () => {
    const { rules, report } = compileToDnrRules([
      networkFilter({ source: "//", pattern: { kind: "regex", source: "" } }),
    ]);
    expect(rules).toHaveLength(0);
    expect(report.errors.map((error) => error.code)).toEqual(["empty-regex-filter"]);
  });

  it("descarta un urlFilter con caracteres no ASCII", () => {
    const { rules, report } = compileToDnrRules([
      networkFilter({ source: "||café.com^", pattern: { kind: "domainAnchor", hostname: "café.com" } }),
    ]);
    expect(rules).toHaveLength(0);
    expect(report.errors.map((error) => error.code)).toEqual(["non-ascii-url-filter"]);
  });

  it("descarta un urlFilter con ideogramas no ASCII", () => {
    const { rules, report } = compileToDnrRules([
      networkFilter({ source: "||例子.com^", pattern: { kind: "domainAnchor", hostname: "例子.com" } }),
    ]);
    expect(rules).toHaveLength(0);
    expect(report.errors.map((error) => error.code)).toEqual(["non-ascii-url-filter"]);
  });

  it("descarta un urlFilter que empieza por ||*", () => {
    const { rules, report } = compileToDnrRules([
      networkFilter({ source: "||*ads", pattern: { kind: "substring", value: "||*ads" } }),
    ]);
    expect(rules).toHaveLength(0);
    expect(report.errors.map((error) => error.code)).toEqual(["url-filter-||*-prefix"]);
  });

  it("deja la regla inválida en dropped con su error y fuera del ruleset", () => {
    const invalid = networkFilter({ pattern: { kind: "substring", value: "" } });
    const valid = networkFilter({ source: "||a.com^", pattern: { kind: "domainAnchor", hostname: "a.com" } });
    const { rules, report } = compileToDnrRules([invalid, valid]);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.condition.urlFilter).toBe("||a.com^");
    expect(report.dropped).toHaveLength(1);
    expect(report.dropped[0]?.error.code).toBe("empty-url-filter");
    expect(report.dropped[0]?.filter.source).toBe("||ads.example.com^");
  });
});

describe("compileToDnrRules — validación de dominios", () => {
  const INVALID_DOMAIN_TERMS: readonly string[] = ["exa mple.com", "ads/example.com", "ads*.com", "café.com"];

  it.each(INVALID_DOMAIN_TERMS)("descarta el initiator domain inválido %s", (term) => {
    const { rules, report } = compileToDnrRules([networkFilter({ initiatorDomains: [term] })]);
    expect(rules).toHaveLength(0);
    expect(report.errors.map((error) => error.code)).toEqual(["invalid-initiator-domain"]);
  });

  it("descarta un dominio inválido en denyAllow", () => {
    const { rules, report } = compileToDnrRules([networkFilter({ denyAllow: ["bad host"] })]);
    expect(rules).toHaveLength(0);
    expect(report.errors.map((error) => error.code)).toEqual(["invalid-initiator-domain"]);
  });

  it("no descarta un dominio válido", () => {
    const { rules, report } = compileToDnrRules([networkFilter({ initiatorDomains: ["sub.example.co.uk"] })]);
    expect(rules).toHaveLength(1);
    expect(report.errors).toHaveLength(0);
  });
});

describe("compileToDnrRules — presupuestos globales", () => {
  it("marca ok false y descarta el exceso de reglas regex", () => {
    const { rules, report } = compileToDnrRules(manyRegexFilters(1001));
    expect(rules).toHaveLength(1000);
    expect(report.regex).toBe(1000);
    expect(report.ok).toBe(false);
    expect(report.errors.filter((error) => error.code === "regex-budget-exceeded")).toHaveLength(1);
    expect(report.dropped).toHaveLength(1);
  });

  it("marca ok false y descarta el exceso de reglas estáticas", () => {
    const { rules, report } = compileToDnrRules(manyAnchorFilters(30_001));
    expect(rules).toHaveLength(30_000);
    expect(report.static).toBe(30_000);
    expect(report.ok).toBe(false);
    expect(report.errors.filter((error) => error.code === "static-rules-budget-exceeded")).toHaveLength(1);
    expect(report.dropped).toHaveLength(1);
  });

  it("marca ok false cuando hay una regla inválida descartada sin exceso de presupuesto", () => {
    const { report } = compileToDnrRules([networkFilter({ pattern: { kind: "substring", value: "" } })]);
    expect(report.dropped).toHaveLength(1);
    expect(report.ok).toBe(false);
  });

  it("marca ok false cuando se descarta un regex vacío", () => {
    const { report } = compileToDnrRules([networkFilter({ pattern: { kind: "regex", source: "" } })]);
    expect(report.dropped).toHaveLength(1);
    expect(report.ok).toBe(false);
  });
});

describe("compileToDnrRules — serialización y reporte", () => {
  const FULL_FILTER: NetworkFilter = networkFilter({
    source: "||ads.example.com^$third-party,domain=a.com|~b.com,denyallow=c.com,image",
    resourceTypes: ["image"],
    thirdParty: true,
    initiatorDomains: ["a.com", "~b.com"],
    denyAllow: ["c.com"],
  });

  const mixedFilters: readonly NetworkFilter[] = [
    FULL_FILTER,
    networkFilter({
      source: "@@||safe.test^",
      exception: true,
      pattern: { kind: "domainAnchor", hostname: "safe.test" },
    }),
    networkFilter({ source: "/re/", pattern: { kind: "regex", source: "re" } }),
  ];

  it("produce el mismo JSON byte a byte para el mismo IR", () => {
    expect(JSON.stringify(compileToDnrRules(mixedFilters).rules)).toBe(
      JSON.stringify(compileToDnrRules(mixedFilters).rules),
    );
  });

  it("ordena las claves de la regla y de la condición en el orden documentado", () => {
    const rule = compileToDnrRules([FULL_FILTER]).rules.find((candidate) => candidate.id === 1);
    expect(Object.keys(rule ?? {})).toEqual(["id", "priority", "action", "condition"]);
    expect(Object.keys(rule?.condition ?? {})).toEqual([
      "urlFilter",
      "resourceTypes",
      "domainType",
      "initiatorDomains",
      "excludedInitiatorDomains",
    ]);
  });

  it("cuenta block, allow, regex y static del ruleset", () => {
    const { report } = compileToDnrRules(mixedFilters);
    expect(report.total).toBe(3);
    expect(report.block).toBe(2);
    expect(report.allow).toBe(1);
    expect(report.regex).toBe(1);
    expect(report.static).toBe(3);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.dropped).toEqual([]);
  });

  it("no emite claves con valor undefined en ninguna condición", () => {
    const undefinedEntries = compileToDnrRules(mixedFilters).rules.flatMap((rule) =>
      Object.entries(rule.condition).filter(([, value]) => value === undefined),
    );
    expect(undefinedEntries).toEqual([]);
  });
});
