# Spec: compiler de IR de filtros → ruleset DNR

Autoridad de los hechos de Chrome:
`https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest`
(consultado 2026-10-06; los límites y la semántica de abajo están tomados de esa página, no
de memoria).

El compiler toma `NetworkFilter[]` (IR de `@block-ads/core`, ver `filter-ir.md`) y produce un
ruleset estático de `chrome.declarativeNetRequest`. Es puro: sin `chrome.*`, sin E/S, sin
releer el texto del filtro — todo se deriva del IR.

## Salida

```ts
type DnrRule = {
  readonly id: number;          // >= 1, único dentro del ruleset
  readonly priority: number;    // >= 1
  readonly action: { readonly type: "block" | "allow" };
  readonly condition: DnrCondition;
};

type DnrCondition = {
  readonly urlFilter?: string;
  readonly regexFilter?: string;
  readonly resourceTypes?: readonly DnrResourceType[];
  readonly domainType?: "firstParty" | "thirdParty";
  readonly initiatorDomains?: readonly string[];
  readonly excludedInitiatorDomains?: readonly string[];
};
```

`compileToDnrRules(filters)` devuelve `{ rules, report }`. El JSON serializado tiene claves en
el orden de los tipos de arriba (salida determinista: mismo IR ⇒ mismo archivo byte a byte,
para que un diff de build sea revisable).

Nada de `redirect`, `modifyHeaders`, `upgradeScheme` ni `allowAllRequests` en el MVP: el parser
ya descarta las opciones que los requerirían. Las cosméticas y los scriptlets **no** pasan por
aquí: salen en otro artefacto (tarea 6).

## Mapeo de patrones

| IR | DNR | Nota |
|---|---|---|
| `domainAnchor{hostname}` | `urlFilter: "\|\|" + hostname + "^"` | No se usan `requestDomains`: el ancla de dominio de `urlFilter` ya expresa la semántica ABP, y tolera `*` dentro del hostname. |
| `substring{value}` | `urlFilter: value` | `*`, `\|`, `\|\|`, `^` se pasan literales: son los mismos tokens que documenta Chrome. |
| `regex{source}` | `regexFilter: source` | Ver validación de regex. |

`\|\|*` al inicio de un `urlFilter` no está permitido (Chrome pide `*` a secas) ⇒ error.
`urlFilter` vacío no está permitido ⇒ error.

## Mapeo de tipos de recurso (enum real de Chrome)

DNR: `main_frame, sub_frame, stylesheet, script, image, font, object, xmlhttprequest, ping,
csp_report, media, websocket, webtransport, webbundle, other`.

| IR (nombre ABP) | DNR |
|---|---|
| `document` | `["main_frame", "sub_frame"]` |
| `subdocument` | `["sub_frame"]` |
| `script`, `stylesheet`, `image`, `media`, `font`, `xmlhttprequest`, `ping`, `websocket`, `other` | idéntico |

Se deduplica el resultado. Con `resourceTypes: []` en el IR la clave **se omite**: Chrome
dice que sin `resourceTypes` ni `excludedResourceTypes` se bloquean todos los tipos *salvo*
`main_frame`, que es exactamente el default de ABP/uBO. Omitir no es una pérdida, es la
traducción correcta.

## Otras condiciones

- `thirdParty: true` ⇒ `domainType: "thirdParty"`; `false` ⇒ `"firstParty"`; `undefined` ⇒ se
  omite.
- `initiatorDomains`: término sin `~` ⇒ `initiatorDomains`; con `~` ⇒
  `excludedInitiatorDomains` (Chrome: el excluido tiene precedencia sobre el incluido).
- `denyAllow` ⇒ se fusiona en `excludedInitiatorDomains`.
- Listas vacías se omiten (`initiatorDomains: []` no es permitido por Chrome).
- `isUrlFilterCaseSensitive` se omite siempre: default `false` = insensible a mayúsculas, que
  es el comportamiento ABP.

## Acciones y prioridad

- Filtro normal ⇒ `action.type: "block"`, `priority: 1`.
- `exception: true` ⇒ `action.type: "allow"`, `priority: 2`.

Chrome ordena por `priority` y, a igualdad, por acción (`allow` > `block`). Prioridad 2 en las
excepciones hace que una lista blanca gane siempre a un bloqueo nuestro: si una regla nuestra
rompe un sitio, la excepción del sitio la desactiva. Es la propiedad que hace que el blocker se
pueda arreglar editando la lista sin reinstalar lógica.

## ids deterministas

Orden estable: `exception` primero (ascendente por `source`), después bloqueos por `source`.
`id = índice + 1`. Dos filtros con el mismo `source` y acción son un duplicado ⇒ se colapsan
y se reportan. Determinismo = un build revisable.

## Validación (límites reales de Chrome)

| Límite | Valor |
|---|---|
| `GUARANTEED_MINIMUM_STATIC_RULES` | 30 000 reglas garantizadas en el conjunto de rulesets estáticos habilitados |
| `MAX_NUMBER_OF_ENABLED_STATIC_RULESETS` | 50 habilitadas (100 declaradas) |
| `MAX_NUMBER_OF_REGEX_RULES` | 1 000 reglas con regex por tipo |
| Complejidad de regex | cada regla < 2 KB compilada, si no Chrome la ignora con warning |

El compiler valida y reporta; **nunca** suelta reglas que Chrome ignoraría en silencio (en una
extensión empaquetada las reglas inválidas se descartan sin aviso). Errores por regla:

- `non-ascii-regex` — `regexFilter` debe ser ASCII (se casa contra el host en punycode).
- `non-ascii-url-filter` — por la misma razón: un `urlFilter` no ASCII nunca casaría.
- `empty-regex-filter` — `regex{source: ""}` llega solo por IR directo; Chrome lo rechaza.
- `regex-too-long` — > 1 000 caracteres declarativos (presupuesto propio, conservador
  frente a los 2 KB compilados).
- `regex-unsupported-construct` — lookahead `(?=`/`(?<!`, negación `(?!`, backreference
  `\1`, grupos atómicos/condiciones: RE2 no los soporta.
- `empty-url-filter`, `url-filter-||*-prefix`.
- `invalid-initiator-domain` — hostname con espacio, `/`, `*` o no-ASCII.

Excesos sobre los límites globales (no por regla): `regex-budget-exceeded`,
`static-rules-budget-exceeded`. Desde ronda 2, **cualquier** error (por regla o por presupuesto)
hace `ok: false`: el build falla en vez de generar un ruleset que Chrome recorta en silencio.

`report` siempre incluye: `total`, `block`, `allow`, `regex`, `static`, `errors[]`
(`{ id?, source, code, detail }`), `dropped[]` (ítems inválidos excluidos del ruleset).

## Correcciones de diseño (ronda 2, sobre la primera implementación del compiler)

1. **`ok: false` ante cualquier error**, no solo ante exceso de presupuesto. El propósito
   declarado del reporte es que ninguna regla que Chrome ignoraría en silencio llegue al
   artefacto empaquetado. Con `ok: true` el build pasa igual y el defecto se pierde. Un error
   por regla es un bug del autor de la lista: rompe el build.
   Ojo con la frontera: las reglas que el **parser** descarta (`unsupported-option`,
   `procedural-cosmetic`, `unknown-option`…) **no son errores del compiler** y nunca lo
   afectan. Son el resultado normal de importar listas de terceros; viajan en
   `FilterList.unsupported` y se reportan aparte. `ok` solo habla de IR que *debería*
   compilar y no se puede traducir a un ruleset válido.
2. **Duplicados**: aceptado el canal `report.duplicates: { source }` separada de `dropped`.
   Un duplicado es ruido, no un defecto; no debe verse como un ítem inválido.
3. **`non-ascii-url-filter`** es un error nuevo obligatorio. Chrome casa `urlFilter` contra la
   URL normalizada (host en punycode, resto url-encoded); un `||ejemplo.com^` con acentos o
   ideogramas nunca casa: regla muerta comiendo cupo. Las reglas IDN deben venir en punycode.
4. **`empty-regex-filter`**: el parser garantiza `source` no vacío, pero el compiler acepta IR
   directo y Chrome rechazaría esa regla.
5. **Presupuesto de regex**: "por tipo" en Chrome significa por *tipo de regla*
   (dynamic / session / static), no por resource type. Como solo emitimos estáticas, el tope
   de 1 000 se aplica sobre el conjunto emitido: correcto y conservador.
6. **ids**: se asignan después de descartar inválidos y del recorte de regex ⇒ contiguos
   `1..n`. Aceptado.

### Invariante del pipeline

`parse → (filters | unsupported)` y `compile(filters) → (rules | errors)`. Dos capas de
reporte distintas: la primera describe qué *sabe* la lista que no puede expresar; la segunda
solo falla ante IR mal traducible. Mezclarlas haría que importar EasyList reviente el build.

## Límites del paquete

- `packages/core/src/dnr.ts` (compiler) + `dnr.test.ts`. ≤ ~500 líneas por archivo; si
  `dnr.ts` se pasa, dividir en `dnr/` (conditions, validation, limits).
- TDD obligatorio (AGENTS.md bloque 2), sin mocks: el compiler recibe IR, no cadenas.
- Tipos derivados de los del IR; nada de `any`, aserciones, `let`, `function`, `enum`, barrels.
