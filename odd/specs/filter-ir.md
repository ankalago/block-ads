# Spec: filtro IR + parser ABP (`@block-ads/core`)

Referencia para las tareas #3 y #4. El IR es la única fuente de verdad; el compiler de DNR
(tarea #4) consume esto y no vuelve a leer texto de filtros.

`packages/core` es dominio puro: cero APIs de Chrome, cero dependencias de runtime, cero
mocks. Todo lo de este archivo es total y puro.

## Tipos (`packages/core/src/rules.ts`)

`ResourceType` — tupla `as const` + tipo derivado:

```
script, stylesheet, image, media, font, xmlhttprequest, subdocument, document, ping, websocket, other
```

`HostPattern` — discriminado por `kind`:

| variant | origen | ejemplo |
|---|---|---|
| `{ kind: 'domainAnchor'; hostname: string }` | `\|\|host^` | `||doubleclick.net^` → `doubleclick.net` |
| `{ kind: 'substring'; value: string }` | filtro plano, admite `*` | `\|\|ads.example.com/ptracking` |
| `{ kind: 'regex'; source: string }` | `/re/` sin las barras | `/ad[0-9]+\.js/` |

`NetworkFilter`:

```
type: 'network'
source: string                        // línea original, para reproducirla en DNR
exception: boolean                    // prefijo @@
pattern: HostPattern
resourceTypes: readonly ResourceType[]  // vacío = sin restricción
thirdParty: boolean | undefined       // undefined = sin restricción
initiatorDomains: readonly string[]   // $domain=
denyAllow: readonly string[]          // $denyallow=
```

`CosmeticFilter`:

```
type: 'cosmetic'
source: string
exception: boolean                    // #@#
hostnames: readonly string[]          // vacío = global
selector: string
```

`ScriptletFilter`:

```
type: 'scriptlet'
source: string
hostnames: readonly string[]
scriptlet: string                     // ej. 'json-prune'
args: readonly string[]               // sin args ⇒ []
```

`Filter` = unión discriminada por `type`.

`UnsupportedReason` — tupla `as const`: `comment`, `empty`, `unknown-option`,
`procedural-cosmetic`, `unsupported-option`, `malformed`.

`ParsedLine` = `{ line: number; text: string; reason: UnsupportedReason }` (`text` sin `\r`,
`line` es 1-based).

`FilterList` = `{ filters: readonly Filter[]; unsupported: readonly ParsedLine[]; totalLines: number }`.

## Parser (`packages/core/src/parser.ts`)

`parseFilterLine: (text: string) => Filter | undefined`
`parseFilterList: (source: string) => FilterList`

### Reglas de parseo

1. **Anclas**: `||host^` (con o sin opciones) → `domainAnchor`. `\|\|host/path` o cualquier
   filtro sin `^` final → `substring` con el valor original. Sin ancla → `substring`.
2. **Excepciones**: prefijo `@@` → `exception: true` y se parsea el resto normal.
3. **Opciones** (trozo tras el primer `$` no vacío), separadas por coma:
   - `third-party`, `3p` → `thirdParty: true`. `~third-party`, `1p`, `~3p` → `false`.
   - `domain=a.com|b.com` → `initiatorDomains`. Cada término puede traer prefijo `~`; se
     conserva el `~` literal dentro del string (el compiler lo interpreta). Documentar.
   - `denyallow=a.com` → `denyAllow`.
   - Tipos de recurso: aceptar `image`, `script`, `media`, `font`, `xhr`, `xmlhttprequest`,
     `css`, `stylesheet`, `subdocument`, `document`, `ping`, `websocket`, `other`.
     Alias: `css`→`stylesheet`, `xhr`→`xmlhttprequest`. Varios se acumulan.
     `popup` NO es un tipo soportado (ver ronda 2, punto 1).
   - Toda opción que el subconjunto no pueda representar hace que `parseFilterLine` devuelva
     `undefined` y que `parseFilterList` registre la línea con su razón (`unsupported-option`
     o `unknown-option`, ver ronda 2 punto 2). Nunca descartar en silencio.
4. **Cosméticas**: `hosts##selector`, hosts separados por coma, `##` solo = global, `#@#` =
   excepción. Si el selector contiene `:has(`, `:upward(` o `:style(` ⇒ `procedural-cosmetic`.
   Los separadores procedurales (`#?#`, `#$?#`, `#%#` y sus variantes de excepción) están en
   ronda 2 punto 4 y ronda 3 punto 1.
5. **Scriptlets**: `hosts##+js(nombre, arg1, arg2)`. Primer token = nombre, el resto args
   separados por coma y recortados. Sin args ⇒ `args: []`.
6. **`$` vacío**: `foo$bar` es un substring filter válido en ABP (no es una sección de
   opciones). El límite exacto está en la ronda 3, punto 2. Test explícito para esto.
7. **Vacío / malformado**: línea en blanco tras trim ⇒ `empty`. `##` sin selector ⇒
   `malformed`.
8. **`\r\n`**: se parsea igual que `\n`.
9. **`source`**: cada `Filter` guarda la línea exacta original sin `\r` y con trim exterior.

## Correcciones de diseño (ronda 2, decididas sobre la primera implementación)

Estas cuatro decisiones reemplazan lo que sigue en conflicto con la sección anterior.

1. **Sin traducciones semánticas pérdidas.** Un recurso que no se pueda representar NO se
   mapea a otro más general. `popup` deja de mapearse a `document` (convertiría una regla de
   `$popup` en bloqueo de documentos: sobrebloqueo masivo). `popup`, `~image` (tipos negados),
   `elemhide`/`shide`/`ehide`, `generichide`/`ghide`/`genericblock`, `important`, `redirect`,
   `replace`, `rewrite`, `removeparam`, `queryprune`, `csp`, `urltransform`, `speculative`,
   `doc`, `all`, `empty`, `badfilter` se reconocen pero no se compilan.
2. **Dos razones distintas, no una.**
   - `unsupported-option`: opción conocida de ABP/uBO que el subconjunto no puede compilar
     (incluye tipos de recurso negados con `~` y `popup`).
   - `unknown-option`: el token no es una opción conocida en absoluto (typo, sintaxis de otra
     lista). `parseFilterLine` devuelve `undefined` en ambos casos; lo que cambia es la razón.
   Con esto `unsupported-option` deja de ser un miembro muerto de la unión.
   `domain`/`denyallow` se sacan del conjunto de no soportadas: sí están soportadas.
3. **`ScriptletFilter` lleva `exception: boolean`.** `example.com#@#+js(...)` es una excepción:
   si se descarta la marca, el scriptlet que la lista desactivó explícitamente se aplicaría.
4. **`#?#`, `#$?#`, `#%#` son cosmetia procedural.** Se detectan antes de caer a red y
   producen `procedural-cosmetic`. Hoy caen a `parseNetwork` como `substring`, el compiler
   genera reglas que nunca casan ninguna URL y consumen cupo de las 30 000.

### Invariantes que hay que mantener

- `@@` + cosmética = excepción cosmética (`#@#`). Los scriptlets también llevan su excepción.
- Una línea nunca desaparece en silencio: o es `Filter`, o está en `unsupported` con su razón.
- `source` conserva la línea original (sin `\r`, trim exterior) para reproducirla en DNR.
- Ninguna cosmética procedural se compila, con o sin marca de excepción.

## Correcciones de diseño (ronda 3: cierra las dos ambigüedades que quedó de la ronda 2)

1. **Las variantes de excepción procedural se tratan igual.** `#@?#`, `#@$?#` y `#@%#` dan
   `procedural-cosmetic`, como `#?#`/`#$?#`/`#%#`. El resultado es el mismo en los dos casos:
   la regla no se compila. Dejarlas caer a `parseNetwork` reproduce exactamente el defecto 3
   de la ronda 2 (reglas muertas comiendo cupo de las 30 000). No se introduce una razón
   nueva: una cosmética procedural no soportada es no soportada, sea excepción o no.
2. **Límite exacto de "sección de opciones"** (refina la regla 6). El trozo tras `$` es una
   sección de opciones si **al menos un token** es una opción reconocida: un tipo de recurso,
   `~tipo`, `third-party`/`3p`/`1p`/`~third-party`/`~3p`, `domain=`, `denyallow=`, o un nombre
   conocido no compilarable (la lista de la ronda 2 punto 1). Entonces:
   - todos los tokens reconocidos ⇒ se aplica la ronda 2 (compilar o `unsupported-option`);
   - algún token irreconocible ⇒ `unknown-option`, la línea se descarta con esa razón.
   Si **ningún** token es reconocible, no hay sección de opciones y el `$` queda como parte
   del patrón (`foo$bar` sigue siendo `substring`). Esto elimina el caso `$image,typo`, que
   hasta ahora se convertía en un substring muerto.

## Límites del paquete

- Sin `index.ts` barrel: `package.json` exporta `"./rules"` → `./src/rules.ts` y
  `"./parser"` → `./src/parser.ts`.
- Archivo ≤ ~500 líneas. Si `parser.ts` se pasa, dividir en `parser/` por responsabilidad.
- Tests en español, identificadores en inglés. Un test = un comportamiento.
