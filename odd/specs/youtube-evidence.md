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
