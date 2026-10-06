import { describe, expect, it } from "vitest";
import { parseFilterLine, parseFilterList } from "./parser.ts";
import type { ParsedLine, ResourceType } from "./rules.ts";

const ALL_RESOURCE_TYPES: readonly ResourceType[] = [
  "script",
  "stylesheet",
  "image",
  "media",
  "font",
  "xmlhttprequest",
  "subdocument",
  "document",
  "ping",
  "websocket",
  "other",
];

const NON_COMPILABLE_OPTIONS: readonly string[] = [
  "popup",
  "elemhide",
  "shide",
  "ehide",
  "generichide",
  "ghide",
  "genericblock",
  "important",
  "redirect",
  "replace",
  "rewrite",
  "removeparam",
  "queryprune",
  "csp",
  "urltransform",
  "speculative",
  "doc",
  "all",
  "empty",
  "badfilter",
];

describe("parseFilterLine — anclas y patrones", () => {
  it("parsea un ancla de dominio ||host^ como domainAnchor", () => {
    expect(parseFilterLine("||doubleclick.net^")).toEqual({
      type: "network",
      source: "||doubleclick.net^",
      exception: false,
      pattern: { kind: "domainAnchor", hostname: "doubleclick.net" },
      resourceTypes: [],
      thirdParty: undefined,
      initiatorDomains: [],
      denyAllow: [],
    });
  });

  it("trata ||host/path sin ^ final como substring con el valor original", () => {
    expect(parseFilterLine("||ads.example.com/ptracking")).toEqual({
      type: "network",
      source: "||ads.example.com/ptracking",
      exception: false,
      pattern: { kind: "substring", value: "||ads.example.com/ptracking" },
      resourceTypes: [],
      thirdParty: undefined,
      initiatorDomains: [],
      denyAllow: [],
    });
  });

  it("trata un filtro sin ancla como substring", () => {
    expect(parseFilterLine("ads.example.com/track.js")).toEqual({
      type: "network",
      source: "ads.example.com/track.js",
      exception: false,
      pattern: { kind: "substring", value: "ads.example.com/track.js" },
      resourceTypes: [],
      thirdParty: undefined,
      initiatorDomains: [],
      denyAllow: [],
    });
  });

  it("extrae la fuente de un filtro regex entre barras", () => {
    expect(parseFilterLine("/ad[0-9]+\\.js/")).toEqual({
      type: "network",
      source: "/ad[0-9]+\\.js/",
      exception: false,
      pattern: { kind: "regex", source: "ad[0-9]+\\.js" },
      resourceTypes: [],
      thirdParty: undefined,
      initiatorDomains: [],
      denyAllow: [],
    });
  });

  it("no interpreta como regex un filtro que solo empieza por barra", () => {
    expect(parseFilterLine("/ads/banner")).toEqual({
      type: "network",
      source: "/ads/banner",
      exception: false,
      pattern: { kind: "substring", value: "/ads/banner" },
      resourceTypes: [],
      thirdParty: undefined,
      initiatorDomains: [],
      denyAllow: [],
    });
  });

  it("mantiene el ancla de dominio cuando el filtro lleva opciones", () => {
    expect(parseFilterLine("||doubleclick.net^$script,third-party")).toEqual({
      type: "network",
      source: "||doubleclick.net^$script,third-party",
      exception: false,
      pattern: { kind: "domainAnchor", hostname: "doubleclick.net" },
      resourceTypes: ["script"],
      thirdParty: true,
      initiatorDomains: [],
      denyAllow: [],
    });
  });

  it("no interpreta como ancla de dominio un host con comodín", () => {
    expect(parseFilterLine("||ads.*^$image")).toEqual({
      type: "network",
      source: "||ads.*^$image",
      exception: false,
      pattern: { kind: "substring", value: "||ads.*^" },
      resourceTypes: ["image"],
      thirdParty: undefined,
      initiatorDomains: [],
      denyAllow: [],
    });
  });

  it("recorta el exterior de la línea original y la conserva en source", () => {
    expect(parseFilterLine("  ||doubleclick.net^  ")).toEqual({
      type: "network",
      source: "||doubleclick.net^",
      exception: false,
      pattern: { kind: "domainAnchor", hostname: "doubleclick.net" },
      resourceTypes: [],
      thirdParty: undefined,
      initiatorDomains: [],
      denyAllow: [],
    });
  });

  it("descarta el retorno de carro de una línea CRLF", () => {
    expect(parseFilterLine("||doubleclick.net^\r")).toEqual({
      type: "network",
      source: "||doubleclick.net^",
      exception: false,
      pattern: { kind: "domainAnchor", hostname: "doubleclick.net" },
      resourceTypes: [],
      thirdParty: undefined,
      initiatorDomains: [],
      denyAllow: [],
    });
  });
});

describe("parseFilterLine — excepciones", () => {
  it("marca una excepción de red con el prefijo @@", () => {
    expect(parseFilterLine("@@||doubleclick.net^")).toEqual({
      type: "network",
      source: "@@||doubleclick.net^",
      exception: true,
      pattern: { kind: "domainAnchor", hostname: "doubleclick.net" },
      resourceTypes: [],
      thirdParty: undefined,
      initiatorDomains: [],
      denyAllow: [],
    });
  });

  it("combina el prefijo @@ con las opciones de red", () => {
    expect(parseFilterLine("@@||doubleclick.net^$third-party")).toEqual({
      type: "network",
      source: "@@||doubleclick.net^$third-party",
      exception: true,
      pattern: { kind: "domainAnchor", hostname: "doubleclick.net" },
      resourceTypes: [],
      thirdParty: true,
      initiatorDomains: [],
      denyAllow: [],
    });
  });
});

describe("parseFilterLine — opciones de red", () => {
  it("marca third-party como tráfico de terceros", () => {
    const filter = parseFilterLine("||ads.example.com^$third-party");
    expect(filter).toEqual(expect.objectContaining({ thirdParty: true }));
  });

  it("marca 3p como tráfico de terceros", () => {
    const filter = parseFilterLine("||ads.example.com^$3p");
    expect(filter).toEqual(expect.objectContaining({ thirdParty: true }));
  });

  it("marca ~third-party como tráfico de primera parte", () => {
    const filter = parseFilterLine("||ads.example.com^$~third-party");
    expect(filter).toEqual(expect.objectContaining({ thirdParty: false }));
  });

  it("marca 1p como tráfico de primera parte", () => {
    const filter = parseFilterLine("||ads.example.com^$1p");
    expect(filter).toEqual(expect.objectContaining({ thirdParty: false }));
  });

  it("marca ~3p como tráfico de primera parte", () => {
    const filter = parseFilterLine("||ads.example.com^$~3p");
    expect(filter).toEqual(expect.objectContaining({ thirdParty: false }));
  });

  it("parsea domain= separando términos y conservando el prefijo ~ literal", () => {
    const filter = parseFilterLine("||ads.example.com^$domain=a.com|~b.com");
    expect(filter).toEqual(expect.objectContaining({ initiatorDomains: ["a.com", "~b.com"] }));
  });

  it("parsea domain= con varios términos afirmativos", () => {
    const filter = parseFilterLine("||ads.example.com^$domain=a.com|sub.b.com");
    expect(filter).toEqual(expect.objectContaining({ initiatorDomains: ["a.com", "sub.b.com"] }));
  });

  it("parsea denyallow= como lista de dominios permitidos", () => {
    const filter = parseFilterLine("||ads.example.com^$denyallow=a.com|b.com");
    expect(filter).toEqual(expect.objectContaining({ denyAllow: ["a.com", "b.com"] }));
  });

  it("acumula tipos de recurso y aplica los alias css y xhr", () => {
    const filter = parseFilterLine("||ads.example.com^$image,css,xhr");
    expect(filter).toEqual(expect.objectContaining({ resourceTypes: ["image", "stylesheet", "xmlhttprequest"] }));
  });

  it("acepta todos los tipos de recurso documentados", () => {
    const options = ALL_RESOURCE_TYPES.join(",");
    const filter = parseFilterLine(`||ads.example.com^$${options}`);
    expect(filter).toEqual(expect.objectContaining({ resourceTypes: ALL_RESOURCE_TYPES }));
  });

  it("deduplica los tipos de recurso repetidos", () => {
    const filter = parseFilterLine("||ads.example.com^$image,css,image");
    expect(filter).toEqual(expect.objectContaining({ resourceTypes: ["image", "stylesheet"] }));
  });

  it("combina opciones de terceros, dominio y tipo de recurso", () => {
    expect(parseFilterLine("||ads.example.com^$script,third-party,domain=a.com|~b.com,denyallow=c.com")).toEqual({
      type: "network",
      source: "||ads.example.com^$script,third-party,domain=a.com|~b.com,denyallow=c.com",
      exception: false,
      pattern: { kind: "domainAnchor", hostname: "ads.example.com" },
      resourceTypes: ["script"],
      thirdParty: true,
      initiatorDomains: ["a.com", "~b.com"],
      denyAllow: ["c.com"],
    });
  });

  it("trata foo$bar como substring filter y no como sección de opciones", () => {
    expect(parseFilterLine("foo$bar")).toEqual({
      type: "network",
      source: "foo$bar",
      exception: false,
      pattern: { kind: "substring", value: "foo$bar" },
      resourceTypes: [],
      thirdParty: undefined,
      initiatorDomains: [],
      denyAllow: [],
    });
  });

  it("no abre sección de opciones cuando no hay nada tras el $", () => {
    expect(parseFilterLine("foo$")).toEqual({
      type: "network",
      source: "foo$",
      exception: false,
      pattern: { kind: "substring", value: "foo$" },
      resourceTypes: [],
      thirdParty: undefined,
      initiatorDomains: [],
      denyAllow: [],
    });
  });

  it.each(["$image,typo", "$typo,image"])(
    "descarta la línea cuando una opción reconocida convive con un token irreconocible: %s",
    (options) => {
      expect(parseFilterLine(`||ads.example.com^${options}`)).toBeUndefined();
    },
  );
});

describe("parseFilterLine — opciones conocidas pero no compilables", () => {
  it("no produce filtro para popup porque el IR no representa la apertura de ventanas", () => {
    expect(parseFilterLine("||ads.example.com^$popup")).toBeUndefined();
  });

  it("rechaza el filtro completo cuando una opción compilable convive con una no compilable", () => {
    expect(parseFilterLine("||ads.example.com^$image,important")).toBeUndefined();
  });

  it("rechaza la negación de un tipo de recurso porque el IR no la representa", () => {
    expect(parseFilterLine("||ads.example.com^$~image")).toBeUndefined();
  });

  it.each([
    "important",
    "speculative",
    "doc",
    "redirect=noop.js",
    "removeparam=utm_source",
    "queryprune=utm",
    "csp=script-src 'self'",
  ])("no produce filtro para la opción no compilable %s", (option) => {
    expect(parseFilterLine(`||ads.example.com^$${option}`)).toBeUndefined();
  });
});

describe("parseFilterLine — cosméticas", () => {
  it("parsea una cosmética global sin hosts", () => {
    expect(parseFilterLine("##.ad-banner")).toEqual({
      type: "cosmetic",
      source: "##.ad-banner",
      exception: false,
      hostnames: [],
      selector: ".ad-banner",
    });
  });

  it("parsea una cosmética con varios hosts recortados", () => {
    expect(parseFilterLine("example.com, www.example.com ##.ad-banner")).toEqual({
      type: "cosmetic",
      source: "example.com, www.example.com ##.ad-banner",
      exception: false,
      hostnames: ["example.com", "www.example.com"],
      selector: ".ad-banner",
    });
  });

  it("marca una excepción cosmética con #@#", () => {
    expect(parseFilterLine("example.com#@#.ad-banner")).toEqual({
      type: "cosmetic",
      source: "example.com#@#.ad-banner",
      exception: true,
      hostnames: ["example.com"],
      selector: ".ad-banner",
    });
  });

  it("no produce filtro para ## sin selector", () => {
    expect(parseFilterLine("##")).toBeUndefined();
  });

  it.each([":has(.ad)", ":upward(.ad)", ":style(color: red)"])(
    "no produce filtro para el selector procedural %s",
    (selector) => {
      expect(parseFilterLine(`example.com##div${selector}`)).toBeUndefined();
    },
  );

  it.each(["#?#", "#$?#", "#%#"])("no produce filtro para la cosmética procedural con el separador %s", (separator) => {
    expect(parseFilterLine(`example.com${separator}div:has-text(ad)`)).toBeUndefined();
  });

  it.each(["#@?#", "#@$?#", "#@%#"])(
    "no produce filtro para la cosmética procedural de excepción con el separador %s",
    (separator) => {
      expect(parseFilterLine(`example.com${separator}div:has-text(ad)`)).toBeUndefined();
    },
  );
});

describe("parseFilterLine — scriptlets", () => {
  it("parsea un scriptlet sin argumentos", () => {
    expect(parseFilterLine("example.com##+js(json-prune)")).toEqual({
      type: "scriptlet",
      source: "example.com##+js(json-prune)",
      exception: false,
      hostnames: ["example.com"],
      scriptlet: "json-prune",
      args: [],
    });
  });

  it("parsea un scriptlet con argumentos recortados", () => {
    expect(parseFilterLine("##+js(set-constant, foo, bar)")).toEqual({
      type: "scriptlet",
      source: "##+js(set-constant, foo, bar)",
      exception: false,
      hostnames: [],
      scriptlet: "set-constant",
      args: ["foo", "bar"],
    });
  });

  it("marca como excepción una exclusión de scriptlet con #@#", () => {
    expect(parseFilterLine("example.com#@#+js(json-prune)")).toEqual({
      type: "scriptlet",
      source: "example.com#@#+js(json-prune)",
      exception: true,
      hostnames: ["example.com"],
      scriptlet: "json-prune",
      args: [],
    });
  });

  it("no produce filtro para un scriptlet sin nombre", () => {
    expect(parseFilterLine("example.com##+js()")).toBeUndefined();
  });
});

describe("parseFilterLine — líneas no soportadas", () => {
  it("no produce filtro para una línea vacía", () => {
    expect(parseFilterLine("   ")).toBeUndefined();
  });

  it("no produce filtro para un comentario", () => {
    expect(parseFilterLine("! este es un comentario")).toBeUndefined();
  });

  it("no produce filtro para una cabecera de lista", () => {
    expect(parseFilterLine("[Adblock Plus 2.0]")).toBeUndefined();
  });

  it("no produce filtro para @@ sin patrón", () => {
    expect(parseFilterLine("@@")).toBeUndefined();
  });
});

describe("parseFilterList", () => {
  it("devuelve una lista vacía para una fuente vacía", () => {
    expect(parseFilterList("")).toEqual({ filters: [], unsupported: [], totalLines: 0 });
  });

  it("separa los filtros soportados de las líneas registradas con número y motivo", () => {
    const source = [
      "! cabecera de la lista",
      "||doubleclick.net^",
      "example.com##+js(json-prune, payload)",
      "foo$important",
      "example.com##:has(.ad)",
      "",
      "@@",
      "##",
    ].join("\n");

    const list = parseFilterList(source);

    expect(list.totalLines).toBe(8);
    expect(list.filters).toEqual([
      {
        type: "network",
        source: "||doubleclick.net^",
        exception: false,
        pattern: { kind: "domainAnchor", hostname: "doubleclick.net" },
        resourceTypes: [],
        thirdParty: undefined,
        initiatorDomains: [],
        denyAllow: [],
      },
      {
        type: "scriptlet",
        source: "example.com##+js(json-prune, payload)",
        exception: false,
        hostnames: ["example.com"],
        scriptlet: "json-prune",
        args: ["payload"],
      },
    ]);
    expect(list.unsupported).toEqual([
      { line: 1, text: "! cabecera de la lista", reason: "comment" },
      { line: 4, text: "foo$important", reason: "unsupported-option" },
      { line: 5, text: "example.com##:has(.ad)", reason: "procedural-cosmetic" },
      { line: 6, text: "", reason: "empty" },
      { line: 7, text: "@@", reason: "malformed" },
      { line: 8, text: "##", reason: "malformed" },
    ] satisfies readonly ParsedLine[]);
  });

  it("registra las líneas en blanco como empty", () => {
    expect(parseFilterList("||ads.example.com^\n\n").unsupported).toEqual([{ line: 2, text: "", reason: "empty" }]);
  });

  it("no crea una línea fantasma cuando la lista termina en salto de línea", () => {
    const list = parseFilterList("||ads.example.com^\n");
    expect(list.totalLines).toBe(1);
    expect(list.unsupported).toEqual([]);
  });

  it("registra los comentarios como comment", () => {
    expect(parseFilterList("! uno\n[Adblock Plus 2.0]\n").unsupported).toEqual([
      { line: 1, text: "! uno", reason: "comment" },
      { line: 2, text: "[Adblock Plus 2.0]", reason: "comment" },
    ]);
  });

  it("registra una opción conocida no compilable como unsupported-option sin descartar la línea", () => {
    expect(parseFilterList("||ads.example.com^$csp=script-src\n").unsupported).toEqual([
      { line: 1, text: "||ads.example.com^$csp=script-src", reason: "unsupported-option" },
    ]);
  });

  it("registra la negación de un tipo de recurso como unsupported-option", () => {
    expect(parseFilterList("||ads.example.com^$~image\n").unsupported).toEqual([
      { line: 1, text: "||ads.example.com^$~image", reason: "unsupported-option" },
    ]);
  });

  it("registra un token no reconocido como unknown-option sin descartar la línea", () => {
    expect(parseFilterList("||ads.example.com^$noexiste=1\n").unsupported).toEqual([
      { line: 1, text: "||ads.example.com^$noexiste=1", reason: "unknown-option" },
    ]);
  });

  it.each(NON_COMPILABLE_OPTIONS)("registra la opción no compilable %s como unsupported-option", (option) => {
    expect(parseFilterList(`||ads.example.com^$${option}\n`).unsupported).toEqual([
      { line: 1, text: `||ads.example.com^$${option}`, reason: "unsupported-option" },
    ]);
  });

  it("registra la cosmética procedural como procedural-cosmetic", () => {
    expect(parseFilterList("example.com#?#div:has-text(ad)\n").unsupported).toEqual([
      { line: 1, text: "example.com#?#div:has-text(ad)", reason: "procedural-cosmetic" },
    ]);
  });

  it("registra la cosmética procedural de excepción como procedural-cosmetic", () => {
    expect(parseFilterList("example.com#@?#div:has-text(ad)\n").unsupported).toEqual([
      { line: 1, text: "example.com#@?#div:has-text(ad)", reason: "procedural-cosmetic" },
    ]);
  });

  it("registra unknown-option cuando la sección de opciones mezcla un token irreconocible", () => {
    expect(parseFilterList("||ads.example.com^$image,typo\n").unsupported).toEqual([
      { line: 1, text: "||ads.example.com^$image,typo", reason: "unknown-option" },
    ]);
  });

  it("parsea listas con terminaciones CRLF igual que LF", () => {
    const list = parseFilterList("||doubleclick.net^\r\n##.ad-banner\r\n");

    expect(list.totalLines).toBe(2);
    expect(list.unsupported).toEqual([]);
    expect(list.filters).toEqual([
      {
        type: "network",
        source: "||doubleclick.net^",
        exception: false,
        pattern: { kind: "domainAnchor", hostname: "doubleclick.net" },
        resourceTypes: [],
        thirdParty: undefined,
        initiatorDomains: [],
        denyAllow: [],
      },
      {
        type: "cosmetic",
        source: "##.ad-banner",
        exception: false,
        hostnames: [],
        selector: ".ad-banner",
      },
    ]);
  });
});
