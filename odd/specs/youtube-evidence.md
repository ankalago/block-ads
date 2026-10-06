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
