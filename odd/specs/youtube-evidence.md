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

**Desenlace (mismo día, siguiente medición).** La 1 se **refuta por medición directa**: con
`fingerprint_en_window: false` el muro sigue ahí, bloqueando la reproducción. Queda documentado en §14.

## 14. El muro es real y corta la reproducción: el delator restante es `/pagead/id` (2026-10-08)

Con `c0f351c` cargado, el mismo video:

```json
{ "servidor_status": "OK", "servidor_adPlacements": 0, "player_status": "ERROR",
  "reason": null, "mensaje": null, "placements": "ABSENT", "heartbeat": "no-vacio",
  "fingerprint_en_window": false }
```

Y el probe de UI, confirmado con captura de pantalla:

```json
{ "video": { "paused": true, "currentTime": 0, "duration": null, "src": "" },
  "adState": -1, "ytp_error": null,
  "nodos_texto_adblock": [
    { "visible": true, "text": "Ad blockers violate YouTube's Terms of Service" },
    { "visible": true, "text": "It looks like you may be using an ad blocker. Video playback is blocked unless YouTube is " },
    { "visible": true, "text": "Not using an ad blocker?" } ] }
```

### El detector de muros que estaba usando estaba mal

Medía `muro_visible` con `.ytp-mdx-popup-dialog` — un selector sacado de una observación vieja que **no es el
cartel del ad-blocker**: devolvía `false` con el muro en pantalla. Los nodos del cartel no tienen clase útil
(`cls: ""`), así que la señal robusta es el texto.

**Regla**: detectar el muro por su texto y por `video.currentSrc` vacío. Nunca por una clase adivinada, y
`player_status: ERROR` sin `reason` ni `mensaje` tampoco prueba nada solo.

### Estado de los candidatos después de refutar dos más

| Candidato | Estado |
|---|---|
| podar el carrier inline | necesario pero **no suficiente**: con DNR OFF y podado, sin muro |
| descriptor persistente en `ytInitialPlayerResponse` | refutado (§10) |
| canary `ad_status.js` | refutada como única delatora (§12) |
| nuestro global `__blockAdsInnerTube` | **refutado por medición directa** (§14) |
| red (DNR) | **necesario**: sin DNR, con todo lo demás igual, no hay muro |

La pareja que discrimina, cruzando la tabla de §11 con la medición de hoy:

| `ad_status.js` | `pagead/id` | resultado |
|---|---|---|
| bloqueado | bloqueado | muro |
| permitido | bloqueado | **muro** (hoy) |
| permitido | permitido | sin muro (fila DNR OFF de §8) |

En la sesión murada el único request que DNR corta es `googleads.g.doubleclick.net/pagead/id` (2 hits), y es obra
de `||doubleclick.net^` — regla que **nuestra propia lista marca como NO VERIFICADA**: conocimiento general ancho
que resultó disparar el muro.

uBO no tiene excepción para YouTube en esa URL, pero neutraliza el fallo con
`||doubleclick.net/pagead/id$xhr,redirect=nooptext,domain=windowsreport.com` en su `filters.txt`: un `redirect` de
cuerpo vacío que **DNR no puede hacer**. Nosotros no podemos fingir el cuerpo, así que la única vía con DNR puro es
no matar el request.

### Primer dato de la inconsistencia del heartbeat

`heartbeat: "no-vacio"` con `placements: "ABSENT"`, medido en una sesión murada. La combinación que sospechaba
existe; esto no prueba causalidad (también aparece en las sesiones sin muro de §7), pero es el candidato siguiente.

### El experimento que envía esta sección

`cfe56d4` agrega `@@||googleads.g.doubleclick.net/pagead/id$domain=youtube.com` (ahora hay 2 excepciones). La
prueba nueva fija una **propiedad de grupo**: ninguna regla `allow` puede ser un ancla de host desnuda — tiene que
nombrar una ruta, si no una excepción reabriría el host publicitario entero. Verificado a mano: metiendo
`@@||doubleclick.net^$domain=youtube.com` falla con `reglas allow que reabren un host entero: ||doubleclick.net^`;
restaurada, 8/8.

Qué esperamos en Chrome real: **sin muro**. La segunda pregunta es la buena: **¿aparece pre-roll?** Con el carrier
inline y el `/player` podados no debería haber anuncios que servir — `pagead/id` es un ping de identidad, no el
medio del anuncio. Si aparece pre-roll, muro y pre-roll están acoplados y hay que resolverlo por otra vía (la 3:
consistencia del response podado).

## 15. Cero reglas DNR matcheadas y poda aplicada: el delator es la forma de la response (2026-10-08)

Medición con el protocolo correcto por primera vez: recargar la extensión en `chrome://extensions` →
**pestaña nueva** (`watch?v=3Oxlzhk3pXA`) → sonda en la página → dump en el service worker. El orden importa
porque `chrome.storage.session` es memoria: se vacía al recargar, y un `[]` leído en una pestaña vieja no es
una medición.

```json
{ "carrier_en_window": "ABSENT", "live_adPlacements": "ABSENT", "live_playerAds": "ABSENT",
  "live_adSlots": "ABSENT", "heartbeat": "len 8", "status": "ERROR",
  "reproduce": { "src": "", "paused": true }, "fetch_es_nativa": false }
```

Dump del service worker, en la misma carga:

```text
chrome.storage.session.get("dnrBlocked") → []
```

### Qué establishes con esto

- La poda del carrier inline **sí aplicó**: las tres claves no están en el objeto que lee el player.
- La red **no participó en esta carga**: ninguna regla DNR se matcheó una sola vez. El muro se dispara tan
  temprano que YouTube nunca llega a agendar anuncios, así que no pidió ni `ad_status.js` ni `/pagead/id`.
- El muro igual está ahí: `status: "ERROR"`, `video.currentSrc === ""`, `paused: true`.

Quedan refutados por medición directa: las reglas de red (`fd0b0ea`, `cfe56d4` no levantaron el muro, y acá
ni siquiera corrieron), el accesorio permanente (§11), la huella `window.__blockAdsInnerTube` (§13) y la
canary `ad_status.js` (§13).

### La hipótesis que queda, y por qué es la última sin probar

Le estamos entregando al player un objeto **al que le faltan teclas** con `adBreakHeartbeatParams` de 8
caracteres intacta. Para el player eso no se lee como "no hay anuncios programados", se lee como "había un
ad break y alguien me borró los placements". Una response coherente de "sin anuncios" tiene las mismas
claves, vacías.

Es el mismo motivo por el que los bloqueadores mainstream devuelven arrays vacíos en vez de podar claves, y
por el que `declarativeNetRequest` con `redirect=nooptext` neutraliza en vez de matar la request.

### El fix: neutralizar en lugar de borrar

`NEUTRALIZED_KEYS` reemplaza a `PRUNED_KEYS`, y `PROTECTED_KEYS` desaparece:

```ts
["adPlacements", "adSlots", "playerAds", "adBreakHeartbeatParams"]
```

Cada clave neutralizada **queda presente** con el valor vacío de su propio tipo runtime: `[]`, `{}`, `""`.
`number` / `boolean` / `null` no tienen vacío honesto y se eliminan (fallback documentado y pinneado por
test). La función sigue siendo pura, recursiva, y devuelve la misma referencia cuando no cambia nada.

Vaciar `adBreakHeartbeatParams` **revierte la decisión §6 de `extension-shell.md`**, que asumía (sin medición)
que tocarla dejaba el reproductor no reproducible. El árbol de decisión de la próxima medición:

| Resultado | Interpretación | Acción |
|---|---|---|
| sin muro y reproduce | la inconsistencia era el disparador | cerrar tarea 7 |
| sin muro pero no reproduce | heartbeat vacío rompe | devolver heartbeat al set protegido, mantener `[]` |
| muro igual | no era la forma | Plan B: solo cosmética + media verificado, aceptar pre-roll |

### Verificación adversarial del artefacto, no de los tests

Los 69 tests del paquete verde no prueban el bundle que carga Paul. Cargué `dist/innertube.js` real en un
`vm` de Node con un `window` falso y un carrier con anuncios:

```text
token + preexistente  | adPlacements: []  heartbeat: ""  telemetría: publicada
token + trampa        | adPlacements: []  heartbeat: ""  telemetría: publicada
sin token + trampa    | adPlacements: []  heartbeat: ""  telemetría: undefined
query real (?app=…&blockadsdebug=1) | adPlacements: []  heartbeat: ""  telemetría: publicada
```

Además, en los cuatro casos: descriptor `data` con `configurable: false` (no queda accesorio),
`videoDetails` y `streamingData.formats` intactos, y la clave anidada dentro de
`onResponseReceivedActions[0].adPlacements` también neutralizada (la poda anterior dejaba `[{}]`, ahora
deja el array vacío dentro del action).

### Lección metodológica sobre las sondas

La medición anterior decía `placements: "PRESENTES"` porque la sonda distinguía `undefined` vs presente y
perdía el `.length`: un `[]` vacío y un array con anuncios se veían igual. Las sondas tienen que imprimir
**el valor**, no una etiqueta de presencia. Igual que `muro_visible` por `.ytp-mdx-popup-dialog` (§14).

## 16. Telemetría de red opt-in: separar "parche muerto" de "bypass de realm" (2026-10-09)

La medición de §15 dejó una contradicción sin resolver: el carrier inline salía neutralizado
(`heartbeat: ""`) pero la respuesta viva del player seguía con 7 `adPlacements` y
`playerAds: playerLegacyDesktopWatchAdsRenderer`. Con esos dos datos solos caben dos lecturas opuestas,
y cada una pide un fix distinto:

1. **Bypass de realm**: la página agarra un `fetch` limpio (típicamente de
   `document.createElement('iframe').contentWindow.fetch`) y la petición nunca pasa por nuestro
   `window.fetch` parcheado.
2. **Parche que ve la petición pero no la entrega**: la reconstrucción llega tarde o el player lee otra
   copia.

Ninguna sonda de DOM distingue 1 de 2. Lo hace un contador dentro del propio transport, así que
`innertube.ts` publica `window.__blockAdsNetwork` bajo el mismo token `?blockadsdebug` (sin token, no
existe ese global: sigue sin haber huella legible por la página):

| campo | qué prueba |
|---|---|
| `seen` | peticiones que **efectivamente** pasaron por `window.fetch`/`XHR.send` parcheados |
| `matched` | de esas, las que cayeron en endpoint de poda (`/player`, `/next`) |
| `neutralized` | de esas, las que se reconstruyeron de verdad |
| `matchedPaths` | últimas 8 rutas (sin query) que vimos pasar |

Lectura: `seen > 0` y `matched === 0` mientras el timing de la página sí muestra llamadas a
`/youtubei/v1/player` ⇒ **bypass** (hipótesis 1). `seen === 0` ⇒ el scriptlet no corre en el realm que
usa la página. `matched > 0` y `neutralized < matched` ⇒ hipótesis 2.

Decisiones de diseño que importan para no vuelvan loco al siguiente:

- Se cuenta en el **envío**, no en la lectura: `readystatechange` puede dispararse más de una vez y un
  contador duplicado invalidaría la comparación contra `performance`.
- XHR solo suma `neutralized` si realmente aplicó algún sombraje; con `responseType` binario no hay
  forma de sombrear y no infla el número.
- En fetch la señal es `respuesta reconstruida !== respuesta original`, que es la referencia que
  devuelve `pruneResponse` cuando no cambia nada.

Verificación del artefacto (no del test): ejecuté `dist/innertube.js` en un `vm` de Node con `window`,
`fetch`, `Response` y `XMLHttpRequest` falsos, haciendo 4 llamadas por el transport parcheado **más una
por la referencia limpia de `fetch` capturada antes del parche**, simulando el bypass:

```text
{ seen: 4, matched: 3, neutralized: 3, matchedPaths: ["/youtubei/v1/player", "/youtubei/v1/next", "/youtubei/v1/player"] }
```

La petición del realm limpio es invisible para el contador: ese es exactamente el patrón que hay que
buscar en Chrome real.

### Plantilla de medición en Chrome real (pestana nueva con `?blockadsdebug`)

Contexto **page** en DevTools (no el isolated de la extension):

```js
const net = window.__blockAdsNetwork;
const seen = performance.getEntriesByType("resource")
  .map((e) => new URL(e.name).pathname)
  .filter((p) => p === "/youtubei/v1/player" || p === "/youtubei/v1/next");
const ad = (o) => JSON.stringify((o?.adPlacements ?? []).length) + "/" + JSON.stringify((o?.playerAds ?? []).length);
console.log(JSON.stringify({
  telemetry: net,
  pageCalledEndpoints: seen,
  live: ad(window.ytInitialPlayerResponse),
}, null, 2));
```

Si `pageCalledEndpoints` tiene entradas y `telemetry.matched` es `0`, el bypass está confirmado y hay
que cambiar de vector (el parche de `window.fetch` no alcanza).

## 17. El muro desapareció con la neutralización y el parche de red sí llega (2026-10-09, Chrome real de Paul)

Tres cargas consecutivas con `?blockadsdebug`, extensión recargada y pestañas nuevas:

```text
run 1  seen 29  matched 1  neutralized 1  matchedPaths [/youtubei/v1/player]  carrier 0/0/0  muro false  paused true   readyState 4
run 2  seen 33  matched 1  neutralized 1  matchedPaths [/youtubei/v1/player]  carrier 0/0/0  muro false  paused false  readyState 4
run 3  seen 25  matched 1  neutralized 1  matchedPaths [/youtubei/v1/player]  carrier 0/0/0  muro false  paused false  readyState 4
```

Qué mata y qué deja abierto:

- **La hipótesis del bypass de realm murió.** Hubo una petición real a `/youtubei/v1/player` y pasó por
  nuestro `window.fetch` parcheado (`matched 1`, `neutralized 1`). No hace falta parchar el realm del
  iframe: el vector actual funciona.
- **El disparador del muro era la forma de la response**, exactamente lo que sospechaba §15: con las
  claves presentes y vacías (`carrier 0/0/0`) el player reproduce (`readyState 4`, `currentSrc` con
  `blob:`) y el mensaje de enforcement no aparece. Antes: claves borradas → `status ERROR`,
  `currentSrc ""`, muro.
- `endpoints_que_la_pagina_pidio: {}` **no** significa que la página no haya pedido el player: es el
  artefacto de la sonda. `performance.getEntriesByType("resource")` tiene un buffer acotado (250
  entradas por default) y un watch page lo desborda, así que las entradas tempranas — la llamada al
  player en el arranque — se pierden. La prueba de la llamada es el contador del transport, que sí
  vive dentro del realm. Queda registrado para no volver a leer mal esa sonda.

Lo que queda abierto es eficacia, no muro: `neutralized 1` prueba que reconstruimos una response, pero
`adPlacements: []` se ve igual cuando acabamos de neutralizar un pre-roll que cuando el video nunca trajo
anuncios. Por eso la telemetría ahora también cuenta `adsFound` (peso por clave **antes** de vaciarla):

```text
adsFound: { adPlacements: 3, adSlots: 3, playerAds: 3, adBreakHeartbeatParams: 3 }
```

Lectura con `adsFound`:

| adsFound | muro | reproducción | interpretación |
|---|---|---|---|
| `adPlacements > 0` | false | OK | **había anuncio y lo neutralizamos**: tarea 7 cerrada |
| `{}` | false | OK | ese video no traía ad break; probar con otro |
| `adPlacements > 0` | true | ERROR | ver §19: el ERROR puede venir del servidor, no de nosotros |

## 18. Protocolo de medición en frío (para que la respuesta sea sí/no)

El muro es **stateful**: depende del `visitorData` y del caché del navegador, así que una sola
medición no prueba nada. Secuencia que sí decide:

1. Cerrar **todas** las pestañas de YouTube (limpia el carrier en memoria).
2. `chrome://extensions` → recargar la extensión (deja atrás cualquier dist viejo).
3. Abrir una pestaña nueva con `…&blockadsdebug` y pegar la sonda **apenas carga**.
4. Volver a correr la sonda a los 90 s: un midroll vive ahí, no en el arranque.

La sonda tiene que imprimir los cuatro campos juntos: `telemetria` (con `adsFound`),
`estado` (`__blockAdsInnerTube`: `accessorInstalled`/`carrierPruned`), el `playabilityStatus`
**completo** (no `String(status)`: hay que ver `errorScreen`) y `video` (`currentSrc`, `paused`,
`readyState`). Con `accessorInstalled: false` y `carrierPruned: true` perdimos la carrera pero
sobrescribimos el carrier: sigue siendo neutralización válida, solo cambia por qué.


## 19. 2026-10-11 — **el muro es server-side**: `playabilityStatus` trae la orden en el HTML

Medición en frío sobre `dQw4w9WgXcQ`, build de `a6cb126`, protocolo de §18. La sonda ahora lee el
`playabilityStatus` **completo** en vez de un `String(status)`, porque el `String()` ocultaba el
`errorScreen` — y ahí estaba todo.

```json
{
  "videoId": "dQw4w9WgXcQ",
  "playabilityStatus.status": "ERROR",
  "errorScreen": { "enforcementMessageViewModel": {
      "title": "Ad blockers violate YouTube's Terms of Service",
      "primaryButton": "Allow YouTube Ads",
      "feedbackMessage": "Not using an ad blocker? Report issue",
      "displayType": "ENFORCEMENT_MESSAGE_VIEW_MODEL_DISPLAY_TYPE_PLAYER",
      "isVisible": true } },
  "errorEnElReproductor": "ABSENT",
  "anunciosEnDOM": 0,
  "adsFound": { "playerAds": 1, "adPlacements": 1, "adSlots": 2, "adBreakHeartbeatParams": 1 },
  "red": "seen 26 / matched 1 / neutralized 1",
  "estado": { "accessorInstalled": true, "carrierPruned": true }
}
```

Dos conclusiones, y van en direcciones opuestas.

**Eficacia: confirmada.** `adsFound` no es `{}`: había `adPlacements`, `playerAds`, `adSlots` y
`adBreakHeartbeatParams` **con contenido** en una respuesta del player, y `neutralized: 1` dice que
la reescribimos. Con el fix de `a6cb126` (no reconstruir cuando no hay trabajo), ese
contador ya no puede ser falso: `adsFound` y `neutralized` ahora cuentan cosas distintas y reales. Un anuncio real se neutralizó.

**El muro no lo causamos nosotros.** El `ERROR` está en `ytInitialPlayerResponse`, el objeto que
YouTube serializa **dentro del HTML que baja del servidor**, antes de que cualquier línea nuestra
corra. `playabilityStatus` no es una de nuestras claves: no lo tocamos. La orden de bloqueo viene
de Google, con su texto, su botón "Allow YouTube Ads" y su `feedbackToken` de `/youtubei/v1/feedback`.

Tres detalles que importan para no leer mal la próxima vez:

- `anunciosEnDOM: 0` y `errorEnElReproductor: "ABSENT"`: el overlay de enforcement todavía no está
  en el DOM cuando se toma la muestra. **El DOM no es la señal**; la señal es `playabilityStatus`.
  Detectar el muro por texto visible da `false` en frío y miente.
- `isVisible: true` viene del servidor, no del render. No prueba que Paul haya visto el cartel.
- Conviven en la misma respuesta `adPlacements` **y** `ERROR`: YouTube arma los slots igual y después
  niega la reproducción. O sea que "hay ads en la respuesta" no implica "el video se reproduce".

§17 decía "el muro se levantó". **Era demasiado optimista**: con esta build hay videos que juegan
(`3g4S04DJPYQ`, `kZMiB05GEWg`: `readyState: 4`, `blob:` src) y hay otros (`dQw4w9WgXcQ`) donde el
servidor niega la reproducción de entrada. El muro es **stateful y por sesión**, no un interruptor
del código.

**Control ejecutado (misma build, mismo `dQw4w9WgXcQ`, extensión desactivada, sin token):**

```json
CONTROL-SIN-EXTENSION { "status": "OK", "enforcement": false }
```

Sin la extensión el servidor responde `OK`. Con ella responde `ERROR` con el enforcement pegado.
Caen dos hipótesis a la vez:

- **No es estado pegajoso de la sesión.** Un flag de cuenta o de `visitorData` persistiría con la
  extensión apagada. No persiste. La decisión se toma **por request**, sobre algo que mandamos
  nosotros.
- **No es "YouTube sirve el anuncio y después lo mata".** La respuesta que neutralizamos traía
  `playerAds`, `adPlacements`, `adSlots` **y** `playabilityStatus.ERROR` juntos: el servidor programó
  los anuncios y negó la reproducción en el mismo payload. El bloqueo se decide antes de servir.

Queda una sola pregunta con dos respuestas posibles y baratas de medir: cuál de nuestras dos capas
(GDN de red o scriptlet InnerTube) produce la señal que el servidor lee. La segunda bisagra es si
`streamingData` trae el stream adentro de la respuesta con `ERROR`: si lo trae, neutralizar el campo
de enforcement es una salida real; si no, sería mentirle al player y daría pantalla negra.

## 20. 2026-10-11 — la request fresca juega: el muro es por-request, no universal (test en vivo 2)

**Setup.** Consola de Paul sobre el watch de `dQw4w9WgXcQ` con la extensión puesta (build de
`a6cb126`). Un wrapper de `window.fetch` montado sobre el fetch ya parcheado reescribe
`playabilityStatus` en las respuestas de `/youtubei/v1/player`, y después
`movie_player.loadVideoById("dQw4w9WgXcQ")` obliga una request fresca.

```json
RESPUESTA-FRESCA { "antes": "OK", "conUrl": 0, "conCipher": 1, "total": 27, "serverAbr": true }
VEREDICTO-2 { "t0": 0, "t1": 5.536277, "avanza": true, "src": "blob:https://www.youtube.com/…", "error": "ABSENT" }
```

Tres lecturas:

- **El server no flagueó la request fresca.** `antes: "OK"` es el valor que llegó del servidor
  *antes* de que el wrapper tocara algo. Con la extensión puesta, una segunda request de `player`
  en la misma sesión responde `OK` mientras el carrier del HTML sigue `ERROR`. La decisión de
  enforcement es por request **y no todas las requests la llevan**: el HTML de la página la trae,
  la API de `player` después no. §19 queda: per-request, no sticky; §20 agrega: tampoco universal.
- **El material de stream viene siempre.** La respuesta OK tiene la misma forma que la flagueada:
  27 formats sin `url` directa, 1 `signatureCipher`, `serverAbrStreamingUrl`. Eso cierra la
  "segunda bisagra" de §19: la ausencia de URLs no es retención del server, es la era SABR normal
  (el stream llega por la sesión SABR, `blob:` src). **La única diferencia jugable entre una
  respuesta flagueada y una limpia es `playabilityStatus.status` + `errorScreen`.**
- **Con una respuesta OK la reproducción funciona con todo nuestro filtro activo**: 5.5 s de
  playback, `src` `blob:`, sin overlay. El bloqueo de red + scriptlet no impide reproducir.

**Consecuencia de código (implementada con TDD, regla aparte con nombre propio).**
`src/enforcement.ts`: si una respuesta trae `playabilityStatus.status === "ERROR"` **y**
`errorScreen.enforcementMessageViewModel`, se reescribe el estado a `"OK"` y se saca `errorScreen`;
cualquier otro error (video caído, restricción, otro renderer) se conserva intacto. La regla corre
en los dos caminos donde entra una respuesta de player: la trampa del carrier inline (nuevo flag
`wallRewritten` en el estado de carrier) y el transport `fetch`/XHR (nuevo contador `enforcement`
en la telemetría de red). Verificación del artefacto real en `vm`: muro→OK con orgánico intacto en
carrier y fetch; respuesta limpia sin reconstrucción; `playerErrorMessageRenderer` sin reescritura.

**Riesgos que quedan anotados, sin medir hoy:** SABR significa que el server puede pasar a insertar
anuncios dentro del stream (server-side stitching), que este filtro no ve; y el enforcement puede
escalar por acumulación de señales (la cuenta de "3 strikes" del ecosistema). La regla actual
reescribe el muro cuando aparece; no evita que el server lo mande.

## §21 — El muro tiene otra puerta: la página reasigna el carrier después de la trampa (2025-10-12)

**La medición (`FORMA-ERROR`, sin recargar).** Con la extensión 78cd779 puesta, un cold start quedó
en muro duro (nada suena, `estadoPlayer: 5`). El volcado de la sesión:

- `movie_player.getPlayerResponse().playabilityStatus` → `status: "ERROR"` **con**
  `errorScreen.enforcementMessageViewModel` (título del muro, botones, `displayType: PLAYER`,
  `isVisible: true`).
- `window.ytInitialPlayerResponse.playabilityStatus` → **idéntico** (mismos `trackingParams`,
  mismos tokens de feedback): el player y el carrier tienen la misma respuesta.
- `rutas: ["/youtubei/v1/next", "/youtubei/v1/player"]` — ambas pasaron por el transport.
- Telemetría de esa misma sesión: `wallRewritten: false`, `enforcement: 0`, `carrierPruned: true`.

**La deducción.** Las dos vías del carrier (trampa y carrera perdida) chequean el muro al
procesarlo; `wallRewritten: false` significa que **cuando lo procesamos no tenía muro**. Y ahora lo
tiene. La respuesta flagueada entró después: **la página reasigna `window.ytInitialPlayerResponse`
más de una vez por carga**, y la segunda asignación cae en la data property writable que la trampa
restaura — por diseño sin huella — y por diseño de una sola escritura, sin inspeccionar. El muro de
esta sesión nunca pasó por la trampa ni por el transport: por eso `enforcement: 0`.

**Las tres corridas comparadas:**

| Camino | Corrida | Resultado |
|---|---|---|
| Carrier flagueado + reescrito a OK | run 1 | audio sin video: el stream de la respuesta flagueada llega castigado |
| Carrier sobrescrito con el muro (v2) | run 2 | muro duro, nada suena |
| Request fresca (`loadVideoById`) | Test 2 ×2 | la única vía que jugó de punta a punta |

**Consecuencia de código (TDD, módulo `src/player-rescue.ts`).** Reparar el carrier de nuevo no
alcanza: dejaría el stream envenenado del run 1. El rescate ataca el resultado: si la respuesta
viva del player trae el muro, se le pide una respuesta fresca con `loadVideoById` — respuesta
limpia **y sesión SABR nueva**, que además vuelve por el transport ya podada de anuncios. Acotado:
interroga cada 500 ms, se rinde a los 15 s, nunca más de 2 rescates por página, y se detiene en
cuanto existe una respuesta sin muro (limpia o de error ajeno). El contador `playerRescues` en el
estado de carrier hace el rescate visible en telemetría.

**Verificación del artefacto real (`vm`):** player con muro → 2 rescates de `dQw4w9WgXcQ`, contador
en 2, ciclo detenido cuando la respuesta amaneció limpia; player limpio → 0 rescates. Suite 112 en
verde, `check:ci` 0.

**Queda abierto:** la corrida 1 (audio solo) nunca tuvo telemetría; la hipótesis del stream
castigado explica lo visto pero no está medida. El rescate es el primer mecanismo que esquiva el
stream del carrier por completo — es el experimento que discrimina: si `loadVideoById` tras el
muro juega con imagen, el carrier nunca fue suficiente.

**Cierre de §21 (corrección del rescate).** La primera build del rescate tenía un freno que la sesión
de Paul desactivó: dejaba de interrogar ante la primera respuesta del player sin muro. El carrier de
esa sesión amaneció limpio (`carrierPruned: true`, `wallRewritten: false`), el player arrancó de esa
respuesta limpia y el ciclo se frenó en el primer tick; el muro flagueado llegó recién después —
`playerRescues: 0` con `errorScreen: enforcementMessageViewModel` vivo en la respuesta del player.
Corrección: el ciclo vigila los 15 s completos porque **el muro puede llegar tarde**, con 2 s de
espera entre intentos para no pisar la respuesta fresca de un rescate anterior. Verificado en vm con
el escenario exacto: limpio al arranque + muro a los 2 s → rescate; muro temprano → 2 rescates
separados; limpio todo el plazo → 0.

## §22. La vigía de 8 segundos y el muro que llega tarde por un camino invisible (2025-10-12)

Primera corrida con la telemetría de etapa (13e0673): `rescueTicks: 16` (8 s a 500 ms),
`rescuePlayerSeen: true`, `rescueWallSeen: false`, `rescueErrors: 0` — y `LIVE` minutos después con
el muro en la respuesta del player (`estadoPlayer 5`, `errorScreen enforcementMessageViewModel`,
`loadDisponible "function"`).

Dos hechos medidos:

1. **El muro llega tarde.** Durante los 8 s que la vigía vivió, `getPlayerResponse()` estuvo limpia
   en cada tick. El muro apareció después — mientras el tab estaba en segundo plano, donde el plazo
de 30 s de reloj real venció y la vigía se rindió (Chrome estrangula los timers encadenados a
~1/min en tabs ocultos; cada tick de fondo hubiera visto el muro si la ventana no hubiera vencido).
2. **El camino del muro es invisible para las tres capas.** Transporte: `enforcement: 0` — ninguna
   respuesta flagueada cruzó el fetch/XHR envuelto (RED: 21 vistas, 1 match en `/youtubei/v1/player`
   con `neutralized: 1`, sin muro). Carrier: `wallRewritten: false`. Player durante la vigía: limpio.
   Conclusión: el muro **materializa del lado del cliente** (o entra por un transporte que no
   envolvemos — worker, iframe, `CacheStorage`) — nunca cruza la capa que observamos.

Corrección (e4dd88f): la vigía vive minutos, no segundos — `watchMs` 10 min desde el primer
avistamiento del player (los ticks de fondo a ~1/min alcanzan para ver el muro), `absoluteMs`
15 min de techo, intervalo de 1 s, máximo 2 rescates con 2 s de espera. El humo de vm replica la
sesión medida (escenario E: 19 ticks limpios, muro a los 20 s, rescate inmediato).

Pregunta abierta: si el muro es fabricado por el cliente tras una señal (¿`pagead/id`?), bloquear la
señal con DNR podría impedirlo de raíz; eso queda para la próxima decisión con evidencia.
