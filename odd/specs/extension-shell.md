# Spec: shell de la extensión MV3 (`apps/block-ads`)

Hechos de Chrome citados de la doc oficial (2026-10-06), no de memoria:
`/docs/extensions/mv3/content_scripts` y `/docs/extensions/reference/api/scripting`.

- `ExecutionWorld` (Chrome 95+) = `"ISOLATED" | "MAIN"`. `world` en `registerContentScripts` es
  Chrome 102+.
- **Los content scripts declarados estáticamente en el manifest se inyectan antes que
  cualquier script registrado dinámicamente**, en el orden en que aparecen en el manifest.
- Para inyección dinámica, `injectImmediately` (Chrome 102+) documenta explícitamente que
  *no* garantiza inyectar antes de los scripts de la página.
- Si un content script se inyecta en el main world, **aplica la CSP de la página**.

## Consecuencias de arquitectura (no son negociables en el MVP)

1. **El parche de InnerTube va como content script estático, `world: "MAIN"`,
   `run_at: "document_start"`.** Es el único vehículo con garantía de llegar antes del player.
   La vía `scripting.registerContentScripts` queda descartada para esto.
2. **El scriptlet MAIN world es autocontenido**: un script en MAIN world no tiene
   `chrome.runtime`, así que no puede pedir reglas al service worker en runtime. La config de
   poda se **embebe en el bundle en build time**. Si más adelante hace falta conmutar en
   runtime, se agrega un puente `CustomEvent` con un companion en `ISOLATED` (que sí tiene
   `chrome.*`), no se evalúa código desde datos.
3. **Prohibido `eval` / `new Function`** en el MAIN world: la CSP de YouTube lo bloquea y sería
   un vector de inyección. El parche envuelve `fetch` y `XMLHttpRequest` con código estático.
4. **Poda conservadora**: solo se eliminan `adPlacements`, `adSlots` y `playerAds` de las
   respuestas JSON de `/youtubei/v1/player` y `/next`. `adBreakHeartbeatParams` **nunca** se
   toca: borrarlo deja el reproductor en estado no reproducible.
5. **Nada de accesorio permanente en un global de la página.** El primer `ytInitialPlayerResponse`
   llega serializado en el HTML (`var ytInitialPlayerResponse = {…}`), así que la poda de red no lo
   ve y hay que interceptarlo. Un getter/setter que queda instalado es una huella detectable con
   `Object.getOwnPropertyDescriptor` y activó el muro de "Ad blockers violate YouTube's ToS".
   El accesorio se usa como **trampa de una sola escritura**: poda en el `set` y devuelve la
   propiedad a la forma exacta del `var` de la página (`value`, `writable: true`, `enumerable:
   true`, `configurable: false`). Si la página ya ganó la carrera la propiedad sigue *writable*: se
   poda sobrescribiendo el valor y no se instala nada.
6. **`dist/` es parte del entregable.** Paul carga la extensión unpacked desde
   `apps/block-ads/dist`; un artefacto rancio hace que se pruebe código viejo con la apariencia de
   una prueba válida. Antes de decir "recarga la extensión": `pnpm build` y comprobar que
   `dist/innertube.js` contiene los símbolos nuevos (y que Turbo reportó *cache miss*).

## Manifest (`manifest.json`, MV3)

```json
{
  "manifest_version": 3,
  "name": "Block Ads",
  "version": "0.1.0",
  "minimum_chrome_version": "111",
  "permissions": ["declarativeNetRequest", "storage", "declarativeNetRequestFeedback"],
  "host_permissions": ["https://*.youtube.com/*"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html", "default_title": "Block Ads" },
  "declarative_net_request": {
    "rule_resources": [{ "id": "core", "enabled": true, "path": "rules.json" }]
  },
  "content_scripts": [
    { "matches": ["https://*.youtube.com/*"], "js": ["innertube.js"],
      "run_at": "document_start", "world": "MAIN" },
    { "matches": ["https://*.youtube.com/*"], "css": ["cosmetics.css"], "run_at": "document_start" }
  ]
}
```

`declarativeNetRequestFeedback` es solo para depurar (reglas matched) y se deja en el build de
desarrollo. `minimum_chrome_version: "111"` es la hipótesis a validar cargando la extensión en
Chrome (tarea 7): `world` en content scripts estáticos del manifest se documenta desde Chrome
111 en la práctica. Si Chrome la rechaza, se sube el número, no se baja la funcionalidad.

## Estructura de `apps/block-ads`

```text
src/
  manifest.ts          → objeto manifiesto tipado (fonte única, no JSON a mano)
  background.ts        → service worker: toggle de rulesets + storage
  innertube.ts         → parche MAIN world (fetch/XHR)
  innertube.config.ts  → reglas de poda embebidas en build
  cosmetics.ts         → IR cosmético → CSS
  popup/{popup.html,popup.ts}
build.mjs              → esbuild + emisión de rules.json/cosmetics.css/manifest.json
tsconfig.json          → extends raíz, include src
```

## Pipeline de build

`pnpm build` en `@block-ads/extension` ejecuta `build.mjs`:

1. Lee los filtros de `@block-ads/rules` (tarea 6) → `parseFilterList()` de `@block-ads/core`.
2. `compileToDnrRules()` sobre los de red. **Si `report.ok === false`, el build falla** con los
   errores impresos (código + `source`). Chrome descarta reglas estáticas inválidas en silencio
   en una extensión empaquetada; el build es el único lugar donde todavía podemos quejarnos.
3. Escribe `dist/rules.json` con los ids contiguos que produce el compiler.
4. Compila cosméticas a `dist/cosmetics.css`: `host##selector` → `selector { display: none !important }`
   scopeado a los hosts; las excepciones `#@#` se listan en el reporte y se omiten (el CSS
   declarativo no puede expresar "anular una regla nuestra" sin `:not()`; lo decidirá la tarea 6
   con el DOM real delante).
5. Bundle de `background.ts` e `innertube.ts` con esbuild (`format: "iife"`, target chrome111,
   sin minificar en dev).
6. Emite `dist/manifest.json` desde `src/manifest.ts`.
7. Imprime el reporte: filtros de red, bloqueos/excepciones, reglas regex vs urlFilter,
   descartados por parser y por compiler.

`dist/` es la carpeta para "Load unpacked" en Chrome. Nada de `web_accessible_resources` en el
MVP: no hay redirects a recursos de la extensión.

## Service worker

- `chrome.storage.local` guarda `rulesetCoreEnabled: boolean`.
- En `onStartup`/`onInstalled`, sincroniza el estado guardado con
  `chrome.declarativeNetRequest.updateEnabledRulesets()`. La forma del objeto **no es
  negociable** (confirmada en `@types/chrome` y la doc, `UpdateRulesetOptions`, Chrome 87+):
  `{ enableRulesetIds?: string[], disableRulesetIds?: string[] }`. No existen
  `enableRulesets`/`disableRulesets`; un id en ambas listas es error.
- `popup.ts` lee y escribe ese flag con `chrome.storage` (sin mensajería propia: storage ya es
  el canal, y `chrome.storage.onChanged` notifica al SW).
- Nada de worklets ni `offscreen` en el MVP.

## Verificación

- El contrato de la trampa del carrier se prueba en Vitest con un objeto llano como portador:
  tras la asignación de la página el descriptor **no** puede tener `get`/`set` y tiene que valer
  `{ writable: true, configurable: false }`; y un carrier no-configurable *no writable* no se toca
  (`carrierPruned: false`). Un test de regresión sobre la forma del descriptor es lo que impide
  volver a dejar la huella que disparó el muro.

- `innertube.ts` y `cosmetics.ts` son módulos puros en su parte de decisiones: la lógica de
  poda (qué claves se eliminan de un objeto de respuesta) se extrae a una función pura y se
  prueba con Vitest con payloads reales capturados en la tarea 1. El envoltorio de `fetch`/
  `XMLHttpRequest` no se unit-testea: se verifica en Chrome (tarea 7).
- `build.mjs` se prueba con un caso de `report.ok === false` (filtro que produce `urlFilter`
  no ASCII) que debe terminar en exit ≠ 0.
- `manifest.ts` se valida con test: que `content_scripts[0].world === "MAIN"`, `run_at ===
  "document_start"`, y que cada archivo referenciado exista en `dist/` tras el build.

## Límites

- Sin `index.ts` barrel. Sin `chrome.*` en los módulos puros (solo en `background.ts`,
  `popup.ts` y el envoltorio de `innertube.ts`).
- ≤500 líneas por archivo. `build.mjs` se mantiene como script plano, no paquete.
