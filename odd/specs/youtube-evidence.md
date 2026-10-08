# Evidencia real de YouTube (Chrome, 2026-10-06)

Capturada con DevTools contra la sesión real, no de memoria ni de blogs. Esto es lo que las
tareas 6 y 7 pueden asumir; lo que no está aquí **no está verificado**.

## 1. Claves de anuncio en la player response viva

Sonda: `document.querySelector('#movie_player').getPlayerResponse()` en un video monetizado
(`playabilityStatus: "OK"`).

| clave | observada | forma real |
|---|---|---|
| `playerAds` | sí | `[ { playerLegacyDesktopWatchAdsRenderer: … } ]` |
| `adPlacements` | sí | `[ { adPlacementRenderer: … } ]` |
| `adSlots` | sí en una respuesta, ausente en otra | array (3 elementos) |
| `adBreakHeartbeatParams` | **siempre**, incluso en respuestas sin anuncios y `UNPLAYABLE` | string corto, valor visto `Q0FBJTNE` |

Consecuencias:

- Los tres objetivos de poda (`playerAds`, `adPlacements`, `adSlots`) existen tal cual los
  asumimos el recon y el spec. Los nombres van con `Renderer` dentro, no como claves planas.
- **`adBreakHeartbeatParams` nunca se elimina**: aparece hasta en respuestas `UNPLAYABLE` sin
  ads. Es parámetro de heartbeat del player, no un contenedor de anuncios.
- Las claves aparecen y desaparecen entre respuestas: la poda debe ser tolerante a clave
  ausente (no asumir índice ni longitud).
- `frameworkUpdates` usa `entityBatchUpdate` (no `entityUpdateStore`). La poda del MVP no lo
  toca; si algún día el anuncio revive por ahí, se abre investigación aparte.

## 2. POST directo a `/youtubei/v1/player` con `ytcfg.get('INNERTUBE_CONTEXT')`

Devuelve `200` con `playabilityStatus: "UNPLAYABLE"` y **sin** claves de anuncio. Un `context`
sintetizado desde la página no reproduce la request real del player. Sirve para confirmar el
endpoint; **no** sirve como fixture de payload con anuncios. El fixture de anuncios se saca de
`getPlayerResponse()`, que es la response real ya parseada.

## 3. Selectores de cosmética verificados con anuncios en pantalla

Home (`https://www.youtube.com/`, logged-out, con 4 ad slots renderizados):

```text
ytd-ad-slot-renderer            × 4   # slot de anuncio en feed
#masthead-ad                    × 2   # banner superior
ytd-in-feed-ad-layout-renderer        # wrapper del anuncio in-feed
video-ads ytp-ad-module               # contenedor de ads del player (existe sin ad activo)
ytp-ad-progress-list                  # progreso de ad en los controles
```

Búsqueda (`/results?search_query=…`, 4 ad slots):

```text
ytd-ad-slot-renderer
ytd-in-feed-ad-layout-renderer
```

Ambas páginas sin `ytd-promoted-sparkles-web-renderer` ni `ytd-companion-slot-renderer` en esta
muestra; si la tarea 6 los incluye, se marca como no verificado.

## 4. Lo que NO quedó verificado

- El DOM del overlay **durante** la reproducción de un anuncio (`.ytp-ad-player-overlay`,
  botón de skip y sus variantes `-modern`): contaron 0 y `getAdState()` devolvió `-1` porque el
  pre-roll no arrancó sin gesto de usuario (autoplay bloqueado). **Prohibido inventar esos
  selectores.** Se verifican en la tarea 7 con la extensión cargada y el anuncio reproduciendo
  de verdad.
- Que la poda de `playerAds`+`adPlacements`+`adSlots` elimine realmente el pre-roll sin romper
  el player. Esa es la hipótesis central; se prueba en Chrome, no aquí.
- Sitios de prensa: cero evidencia capturada, son fase posterior.

## 5. Implicación para el diseño

La capa cosmética es **complemento**, no el bloqueo: con la poda de InnerTube el anuncio no
llega a existir y el overlay no se renderiza. Los selectores verificados de home/búsqueda sí son
necesarios porque esos slots no vienen de la player response.

## 6. Tráfico real de la página de watch (verificado con `performance.getEntriesByType`)

Hosts de red publicitaria que la página contactó de verdad en esta sesión:

```text
pagead2.googlesyndication.com   /activeview_ext
ade.googlesyndication.com       /ddm/activity_ext/dc_pubid=…
```

Nada más apareció en esta muestra. `static.doubleclick.net`, `googleadservices.com` y
`doubleclick.net` **no se observaron**: si la tarea 6 los incluye, van marcados como no
verificados en esta sesión (son de conocimiento general, no de esta evidencia).

### El endpoint que materializa el corte de anuncios

`adPlacements[0].adPlacementRenderer.renderer.adBreakServiceRenderer` contiene:

```text
getAdBreakUrl = https://www.youtube.com/get_midroll_info?ei=…&m_pos=-1&token=…
prefetchMilliseconds = 10000
adPlacementConfig.kind = AD_PLACEMENT_KIND_END
```

O sea: `/get_midroll_info` es la request que devuelve el breakdown del anuncio. Da dos capas
independientes:

1. Si la poda de `adPlacements` funciona, el player nunca llega a pedir `/get_midroll_info`.
2. Si la poda falla o YouTube la mueve de sitio, bloquear `||youtube.com/get_midroll_info` por
   DNR sigue cortando el anuncio. Ese es el backstop de red, y ahora está justificado por
   evidencia, no por imitar a uBlock.

### Forma real de `adSlots`

```text
adSlots[0] = { adSlotRenderer: { adSlotMetadata: { slotId, slotType: "SLOT_TYPE_PLAYER_BYTES",
          triggerEvent: "SLOT_TRIGGER_EVENT_BEFORE_CONTENT" },
          fulfillmentContent: { fulfilledLayout: { playerBytesAdLayoutRenderer: … } } } }
```

`adSlots` trae el dato de serving del anuncio, no solo metadatos inocuos: podarlo tiene efecto.

## 7. Verificación funcional de la poda y la cosmética (bundle real, sin extensión cargada)

Método: se ejecutó el contenido de `apps/block-ads/dist/innertube.js` y de
`dist/cosmetics.css` directamente en la página mediante `Runtime.evaluate` (CDP), o sea en el
MAIN world — el mismo mundo en que corre el content script del manifiesto. La hoja cosmética se
aplicó como `<style>` real, no como estilos inline.

### Poda InnerTube: control sin parche (misma sesión, misma página)

```text
carga inicial        placements:2 playerAds:1 slots:absent heartbeat:present play:OK
loadVideoById(A)     placements:2 playerAds:1 slots:absent heartbeat:present play:OK
loadVideoById(B)     placements:2 playerAds:1 slots:absent heartbeat:present play:OK
```

El ad serving no es determinista, así que sin este control la desaparición de las claves no sería
atribuible: tres cargas consecutivas sin parche conservan `adPlacements` y `playerAds` siempre.

### Poda InnerTube: con el bundle parchando la página

```text
antes de parchar     placements:2 playerAds:1 slots:absent heartbeat:present play:OK
tras loadVideoById(A) placements:absent playerAds:absent slots:absent heartbeat:present play:OK
tras loadVideoById(B) placements:absent playerAds:absent slots:absent heartbeat:present play:OK
```

Además, con el parche activo: `video.paused === false`, `duration 252.2 s`, `currentTime`
avanzando. La poda elimina el payload que programa el corte **sin volver el video
inreproducible**, y `adBreakHeartbeatParams` sobrevive intacto (longitud 8 en ambas fases).

### Cosmética en home real (`https://www.youtube.com/`)

| Selector | nodos | visibles antes | visibles después | `display` calculado |
|---|---|---|---|---|
| `ytd-ad-slot-renderer` | 1 | 1 (caja 1272×259) | 0 | `none` |
| `#masthead-ad` | 2 | 1 (caja 1272×291) | 0 | `none` |
| `ytd-in-feed-ad-layout-renderer` | 0 | 0 | 0 | sin nodo en home |
| `video-ads ytp-ad-module` | 0 | 0 | 0 | sin nodo en home |
| `ytp-ad-progress-list` | 0 | 0 | 0 | sin nodo en home |

Control de daño colateral: `ytd-rich-item-renderer` (tarjetas de contenido orgánico) 34 antes,
34 después. La hoja aplicó como `<style>` real (`injectedAsRealStylesheet: true`).

### Lo que esta sección NO prueba

- Que el empaquetado funcione: registro del content script `world: MAIN` en `document_start`,
  activación del ruleset desde el manifiesto, y el bloqueo DNR en red. Eso requiere cargar la
  extensión (`chrome://extensions`) y no se puede simular desde CDP.
- Que un pre-roll desaparezca en pantalla: en estas corridas no llegó a reproducirse un anuncio,
  así que se probó la eliminación del payload que lo programa, no su efecto visual.
- Los selectores del overlay in-player y del botón de skip siguen sin verificar (§4).

## 8. El carrier inline: por qué el pre-roll sobrevivía a la poda de red

Medido en Chrome sobre un watch page, **sin** la extensión cargada (la estructura de la página no
depende de la extensión, así que esta medición es válida aunque el Chrome medidor no tenga el
`dist/` instalado):

| Medición | Resultado |
|---|---|
| requests de carga a `/youtubei/v1/player` | **0** — el único endpoint InnerTube de la carga es `/youtubei/v1/log_event` |
| descriptor de `window.ytInitialPlayerResponse` | `data`, `writable: true`, **`configurable: false`**, `enumerable: true` |
| quién lo crea | el propio HTML: `var ytInitialPlayerResponse = {…}` (3 scripts de página lo mencionan) |
| contenido del carrier en la carga inicial | `adPlacements: 1`, `playerAds: 1`, `adSlots: 8` |
| `getPlayerResponse()` en esa misma carga | `placements: 1 playerAds: 1 slots: 8` |

Consecuencia de diseño: la primera respuesta **nunca pasa por la red**, así que un parche de
`fetch`/`XHR` no tiene nada que interceptar. La poda verificada en §7 se midió con
`loadVideoById()`, que sí emite un request InnerTube: ese es el camino del **cambio de video**, no
el de la **entrada a la página**. Por eso el pre-roll seguía sonando con todo lo demás verde.

Fix: `c638867` instala un accesorio sobre el carrier a `document_start` (los content scripts
estáticos se inyectan antes de ejecutar los `<script>` inline del documento), de modo que la
asignación se poda en el momento y toda lectura posterior —incluido el bootstrap de la página— pasa
por el getter. El `configurable: false` observado es la razón de que el orden importe: si la
declaración `var` de la página llegara primero, `defineProperty` fallaría y la función lo informa
devolviendo `false` en vez de fingir que podó.

## 9. Verificación con la extensión cargada en el Chrome real

Datos aportados por Paul desde su propia sesión de Chrome (el Chrome gobernado por DevTools MCP se
lanza con `--disable-extensions`, así que allí las mediciones de extensión no valen):

- scriptlet activo en la carga analizada: `placements ABSENT / playerAds ABSENT / heartbeat string /
  playability OK`.
- `getEnabledRulesets()` → `['core']`.
- `getAvailableStaticRuleCount()` → `329995`. **No** es el conteo de reglas propias: la API devuelve
  cuántas reglas estáticas se pueden habilitar antes del límite global (`@types/chrome`,
  `getAvailableStaticRuleCount`). Con 330000 de cupo, `330000 − 329995 = 5` confirma que las 5 reglas
  están instaladas y habilitadas.
- `getMatchedRules({})` → entradas `{ruleId: 2}` (`||doubleclick.net^`) y `{ruleId: 4}`
  (`||pagead2.googlesyndication.com^`). `ruleId 5` (`get_midroll_info`) nunca matcheó, coherente con
  que el player no llegó a pedir el corte por esa vía.
- **Aun así sonó un pre-roll**, y eso es lo que §8 explica y `c638867` cierra.

Pendiente tras el fix: repetir en el Chrome real (recargar la extensión y el watch page)
`__blockAdsInnerTube` → `{ carrierShadowed: true }` y comprobar que el pre-roll no aparece.

## 10. El muro de cumplimiento: la poda inline delata el accesorio (2026-10-08)

**Síntoma.** Tras `c638867` (sombrear `window.ytInitialPlayerResponse` con un getter/setter), en el
Chrome real de Paul: desde la home entra a un video y lo mira; al elegir **otro** video aparece el
interstitial oficial: *"Ad blockers violate YouTube's Terms of Service. It looks like you may be
using an ad blocker. Video playback is blocked unless YouTube is allowlisted or the ad blocker is
disabled."*

**Mediciones (Chrome de Paul, extensión cargada, 2026-10-08).**

| # | Medición | Resultado |
|---|---|---|
| 1 | `playabilityStatus.status` | `ERROR` con `reason: ""`; con DNR desactivado, `OK` |
| 2 | Elemento del muro | `.ytp-mdx-popup-dialog` (dentro del reproductor HTML5, no inyectado por el servidor) |
| 3 | `Object.getOwnPropertyDescriptor(window,'ytInitialPlayerResponse')` | **`data` con el scriptlet OFF / `accessor` con el scriptlet ON** |
| 4 | Solo el accesorio (sin DNR), 4 cambios de video | **devolvió `data`**, sin muro |
| 5 | Prueba clásica `static.doubleclick.net/instream/ad_status.js` | responde `200` con `window.google_ad_status = 1;` y **sigue cargando con nuestras 5 reglas** → no es el disparador |
| 6 | Tráfico real de un watch page | **cero** requests a `doubleclick`/`googlesyndication` en la carga normal |

**Conclusión.** El muro es una decisión **del lado del cliente**, tomada por el HTML5 player. El
indicador observable que coincide con el fallo es el descriptor: un getter/setter permanente en
`window.ytInitialPlayerResponse` es detectable con una sola llamada a
`getOwnPropertyDescriptor`. La medición 4 muestra que YouTube no lo chequea en el arranque normal
(sigue viendo `data` porque la detección ocurre en la navegación SPA), así que la firma del
accesorio es el vector probable, no demostrado como único.

**Decisión (elegida por Paul).** Poda inline **sin dejar huella de accesorio**: el accesorio se usa
como trampa de **una sola escritura** y, en cuanto la página asigna el carrier, la propiedad se
restablece como data property con la forma exacta de un `var` global
(`writable: true, enumerable: true, configurable: false`). Si la página ya ganó la carrera, `var`
deja la propiedad *writable*: se poda sobrescribiendo el valor sin tocar el descriptor (esto lo
descubrió el propio test, no estaba previsto).

**Matriz de resultados esperada tras recargar la extensión en Chrome real.**

| Muro | Pre-roll | Lectura |
|---|---|---|
| No | No | B funciona: la poda inline sin huella no se detecta |
| No | Sí | la poda llega tarde (la página ya planificó el anuncio) → ir a A: neutralizar en reproducción |
| Sí | — | el delator son las claves de anuncio ausentes o el bloqueo DNR, no el descriptor → ir a A |

`window.__blockAdsInnerTube` ahora publica `{ accessorInstalled, carrierPruned }` para poder
distinguir "no gané la carrera" de "podé" en el mismo lugar.

## 11. Falsificación de la hipótesis del accesorio (2026-10-08, Chrome real de Paul)

Medición con la trampa de una sola escritura ya cargada (`75688f7` + `dist` rehecho):

```text
descriptor: data | configurable: false
scriptlet: {"accessorInstalled":true,"carrierPruned":true}
status: ERROR | placements: ABSENT
```

La huella del accesorio **desapareció** (el descriptor vuelve a ser el de un `var` de la página, con
la trampa disparada y el carrier podado) y **el muro sigue ahí**. Queda refutada la hipótesis de §10:
el getter/setter no era el disparador. La correlación que la sustentaba era real pero no causal.

Tabla de combos medida, que es lo que queda en pie:

| poda del carrier inline | DNR ON | resultado |
|---|---|---|
| NO (solo fetch/XHR) | ON | sin muro, **con pre-roll** (tarea 7) |
| SÍ | OFF | sin muro |
| SÍ | ON | **muro** (`playabilityStatus.status: ERROR`) |

El muro necesita las dos cosas a la vez, así que el delator está en la interacción entre *claves de
anuncio ausentes* y *requests de anuncio bloqueados*. No sabemos todavía:

1. **Ni qué request bloqueado es el delator.** `getMatchedRules` solo devuelve `ruleId`, `rulesetId`,
   `tabId` y `timeStamp` (verificado en `@types/chrome@0.3.4`, `MatchedRuleInfo`) — sin URL. Por eso
   `1347914` instrumenta `chrome.declarativeNetRequest.onRuleMatchedDebug`, que sí entrega
   `request.url` y `request.type` (`MatchedRuleInfoDebug`), y lo guarda en un buffer de 60 entradas
   deduplicado en `chrome.storage.session` con el texto del filtro que casó.
2. **Si el `ERROR` lo decide el servidor o el player.** `getPlayerResponse()` puede ser el objeto ya
   mutado por el player, así que no distingue. El probes de HTML crudo (abajo) sí: pide `/watch?v=…`
   y lee `playabilityStatus` en la respuesta del servidor, ajena a nuestra poda.

### Protocolo de medición (una sola recarga de la extensión)

En la consola de la **página** con el muro:

```js
(async () => {
  const vid = new URLSearchParams(location.search).get("v");
  const html = await (await fetch(`/watch?v=${vid}`, { credentials: "include" })).text();
  const raw = (html.match(/"playabilityStatus":(.{0,400})/s) ?? [])[1] ?? "";
  const count = (k) => (html.match(new RegExp(`"${k}":`, "g")) ?? []).length;
  console.log(JSON.stringify({
    servidor_status: raw.match(/"status":"(\w+)"/)?.[1] ?? "n/d",
    servidor_dice_adblocker: html.includes("Ad blockers violate"),
    servidor_adPlacements: count("adPlacements"),
    servidor_playerAds: count("playerAds"),
    servidor_adSlots: count("adSlots"),
    player_status: document.querySelector("#movie_player")?.getPlayerResponse?.().playabilityStatus?.status ?? "n/d",
    google_ad_status: typeof window.google_ad_status,
  }));
})();
```

En la consola del **service worker** (`chrome://extensions` → *Inspection views: Service worker*):

```js
chrome.storage.session.get("dnrBlocked").then((d) =>
  console.table((d.dnrBlocked ?? []).map((h) => ({ ruleId: h.ruleId, filter: h.filter, hits: h.hits, url: h.url.slice(0, 130) }))),
);
```

Cómo se lee:

| `servidor_status` | `player_status` | Conclusión |
|---|---|---|
| `ERROR` | `ERROR` | el flag es del servidor y es *sticky* por sesión: hay que reproducir en limpio (ventana de incógnito con la extensión) antes de tocar nada |
| `OK` con `adPlacements ≥ 1` | `ERROR` | lo decide el player en el cliente: el delator está en la poda o en el request bloqueado que muestre `dnrBlocked` |

Candidato clásico a confirmar con `dnrBlocked`: `static.doubleclick.net/instream/ad_status.js`
(la canary `window.google_ad_status`), que bloquea nuestra regla 2 `||doubleclick.net^`. EasyList
trae excepción explícita para esa URL; si aparece en el volcado, esa es la primera corrección.

## 12. El delator: la canary `ad_status.js` bloqueada por nuestra propia regla (2026-10-08)

Medición con el instrumento de §11 en el Chrome real de Paul, sobre un video con muro:

```json
{"servidor_status":"OK","servidor_dice_adblocker":true,"servidor_adPlacements":0,
 "servidor_playerAds":0,"player_status":"ERROR","google_ad_status":"undefined"}
```

```text
ruleId 2 | ||doubleclick.net^ | hits 1 | https://static.doubleclick.net/instream/ad_status.js
ruleId 2 | ||doubleclick.net^ | hits 2 | https://googleads.g.doubleclick.net/pagead/id
```

Cuatro conclusiones, cada una atada a un dato:

1. **El `ERROR` lo decide el player en el cliente.** El `/watch` crudo del servidor dice `OK`; el
   `getPlayerResponse()` en pantalla dice `ERROR`. No es un flag de servidor ni es *sticky* por sesión.
2. **La poda del carrier no era el delator.** En esa carga el servidor mandó
   `adPlacements: 0, playerAds: 0`: no había claves que podar y el muro igual estaba. Cae también la
   segunda hipótesis de §11.
3. **`servidor_dice_adblocker: true` no es señal.** El texto "Ad blockers violate" viene en el HTML de
   la página como plantilla del diálogo (`ytp-mdx-popup-dialog`), con `playabilityStatus` OK. Un probe
   que busque ese string para saber si hay muro es inútil: hay que mirar `playabilityStatus.status`.
4. **El delator es la canary.** `static.doubleclick.net/instream/ad_status.js` es el chequeo clásico
   de ad-blocker: ese script solo hace `window.google_ad_status = 1`, y aparecía muerto
   (`typeof window.google_ad_status === "undefined"`) porque nuestra regla 2 (`||doubleclick.net^`)
   lo cortaba. EasyList trae excepción para esa misma URL por algo.

Corrección aplicada: excepción de una línea en `packages/rules/lists/youtube.txt`, acotada al recurso
y al initiator, sin aflojar el resto del host.

```text
@@||static.doubleclick.net/instream/ad_status.js$domain=youtube.com
```

Compilado real en `apps/block-ads/dist/rules.json` (6 reglas):

```json
{ "id": 1, "priority": 2, "action": { "type": "allow" },
  "condition": { "urlFilter": "||static.doubleclick.net/instream/ad_status.js",
                 "initiatorDomains": ["youtube.com"] } }
```

Gates: `Tests 7 passed` en `packages/rules` (RED visto antes de editar la lista), core 145, extensión
60, `pnpm check:ci` exit 0, `build` con cache miss forzado y `dist` rehecho a las 11:14.

Detalle del parser que quedó registrado: `DOMAIN_ANCHOR_PATTERN` exige `^` final
(`packages/core/src/parser.ts:35`), así que `||…/ad_status.js` se clasifica como `substring` y el
compiler vuelca el patrón tal cual en `urlFilter`. Está bien: Chrome interpreta el anclaje `||` del
`urlFilter` por su cuenta, y `^` final sería peor (el separador no casa con un `?query` posterior).

Precedencia: `initiatorDomains` tiene precedencia sobre `domainType` en las reglas *de bloqueo* de
Chrome, pero nuestra lista no usa ninguna regla `$third-party` (`grep -c third-party` = 0), así que el
caso no se da aquí. Queda anotado como riesgo si la lista crece.

## 13. La canary reabierta no levantó el muro (2026-10-08, Chrome real de Paul)

Con `fd0b0ea` cargado (`dist` rehecho y verificado por contenido), el video que daba muro midió:

```json
{"servidor_status":"OK","player_status":"ERROR","google_ad_status":"number"}
```

```text
ruleId 1 | ||static.doubleclick.net/instream/ad_status.js | hits 1 | https://static.doubleclick.net/instream/ad_status.js
ruleId 3 | ||doubleclick.net^                              | hits 2 | https://googleads.g.doubleclick.net/pagead/id
```

`google_ad_status` pasó de `"undefined"` a `"number"`: la excepción funciona y Chrome reporta la regla
`allow` como la que gana (`ruleId 1`, prioridad 2). **Y el muro sigue.** La canary era *un* delator, no
*el* delator. El dato se conserva igual de valioso: acota la búsqueda al pedido de red que sigue
cortado (`pagead/id`) o a algo que hacemos en el mundo del page.

### El confound que aparece recién ahora

`git log -S "__blockAdsInnerTube"` devuelve un solo commit: `c638867`, el mismo que metió la poda del
carrier inline. Hasta hoy el scriptlet publicaba

```ts
window.__blockAdsInnerTube = status;   // innertube.ts:310, antes de c0f351c
```

una propiedad **own, enumerable y legible desde los scripts de la página**, con un nombre que dice
literalmente "block ads". Cualquier `Object.keys(window)` o `"__blockAdsInnerTube" in window` la ve.

Esto rompe la lectura de la tabla de §11: la fila "carrier sin podar + DNR ON = sin muro" se midió
*antes* de `c638867`, cuando ese global todavía no existía. O sea que `c638867` cambió dos cosas a la
vez (poda del carrier **y** fingerprint propio en `window`) y nunca las separamos. El "poda = delator"
está tan contaminado como estaba el "accesorio = delator".

Corrección estructural: `c0f351c` deja de publicar el estado por defecto. `shouldPublishStatus` solo
lo expone si la URL trae `blockadsdebug`, el `status` se sigue devolviendo desde
`installInnerTubePatch()`, y el orden de instalación no cambia (fetch → XHR → publish condicional →
`shadowInlineCarrier`). Tests: 66 en la extensión (6 nuevos, RED visto). `check:ci` exit 0.

Hipótesis sin verificar, ordenada por costo de prueba:

1. **El fingerprint propio era el delator.** Se prueba gratis: recargar sin `blockadsdebug` en la URL.
2. **`googleads.g.doubleclick.net/pagead/id`** es el segundo request de red que cortamos y sigue
   cortado. Si 1 no mueve nada, se prueba sacando `||doubleclick.net^` (regla que nuestra propia lista
   marca como *NO VERIFICADA EN ESTA SESIÓN*) y midiendo.
3. **Inconsistencia del response podado**: `adBreakHeartbeatParams` no vacío con `adPlacements`
   ausentes. Nuestro spec decide preservar el heartbeat; si 1 y 2 no explican, se mide la variante
   consistente. Todavía no tenemos ni un solo dato sobre esto, así que va tercera.
