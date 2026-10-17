/**
 * Regla de enforcement y guardia contra `onAbnormalityDetected`:
 *
 * 1. Cuando el servidor devuelve `playabilityStatus.status === "ERROR"` con
 *    `errorScreen.enforcementMessageViewModel` (o `bkaEnforcementMessageViewModel`), el stream SABR
 *    de esa respuesta viene vacío/castigado (§21). Reescribir `ERROR` → `OK` en esa respuesta deja
 *    el reproductor en pantalla negra sin vídeo ni audio y además oculta el muro a `player-rescue`.
 *    Por eso `hasEnforcementWall` detecta el muro pero `neutralizeEnforcement` NO miente sobre
 *    `playabilityStatus`: deja que `player-rescue` dispare `loadVideoById` para obtener una
 *    respuesta fresca y reproducible.
 * 2. En respuestas reproducibles (`status === "OK"`), YouTube puede adjuntar el popup de aviso en
 *    `auxiliaryUi.messageRenderers.bkaEnforcementMessageViewModel` o `enforcementMessageViewModel`.
 *    `neutralizeEnforcement` poda únicamente esos view models de `auxiliaryUi`.
 * 3. Del lado cliente, el detector de YouTube ejecuta un callback en `Promise.prototype.then` cuya
 *    fuente contiene `"onAbnormalityDetected"`, mutando `playabilityStatus` a los ~55 s de vida de
 *    la página. `installAbnormalityGuard` intercepta `Promise.prototype.then` y reemplaza ese
 *    callback por un no-op antes de que pueda disparar el muro.
 */

export const PLAYABILITY_KEY = "playabilityStatus";
export const ENFORCEMENT_STATUS = "ERROR";
export const PLAYABLE_STATUS = "OK";
export const ABNORMALITY_MARKER = "onAbnormalityDetected";

const ERROR_SCREEN_KEY = "errorScreen";
const AUXILIARY_UI_KEY = "auxiliaryUi";
const MESSAGE_RENDERERS_KEY = "messageRenderers";
const ENFORCEMENT_VIEW_MODELS: readonly string[] = ["enforcementMessageViewModel", "bkaEnforcementMessageViewModel"];

type JsonObject = { readonly [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasEnforcementModel = (container: JsonObject): boolean =>
  ENFORCEMENT_VIEW_MODELS.some((modelKey) => modelKey in container);

/** true solo si el payload trae el muro de bloqueo en playabilityStatus.errorScreen. */
export const hasEnforcementWall = (payload: unknown): boolean => {
  if (!isJsonObject(payload)) return false;

  const playability = payload[PLAYABILITY_KEY];
  if (!isJsonObject(playability) || playability.status !== ENFORCEMENT_STATUS) return false;

  const screen = playability[ERROR_SCREEN_KEY];

  return isJsonObject(screen) && hasEnforcementModel(screen);
};

/**
 * Elimina los view models de enforcement dentro de `auxiliaryUi.messageRenderers` en respuestas
 * reproducibles. Conserva intacto `playabilityStatus` (un ERROR real debe llegar a `player-rescue`
 * para recargar un stream sano) y devuelve la misma referencia cuando no hay nada que podar.
 */
export const neutralizeEnforcement = (payload: JsonValue | undefined): JsonValue | undefined => {
  if (!isJsonObject(payload)) return payload;

  const auxiliary = payload[AUXILIARY_UI_KEY];
  if (!isJsonObject(auxiliary)) return payload;

  const renderers = auxiliary[MESSAGE_RENDERERS_KEY];
  if (!isJsonObject(renderers) || !hasEnforcementModel(renderers)) return payload;

  const cleanedRenderers = Object.fromEntries(
    Object.entries(renderers).filter(([entryKey]) => !ENFORCEMENT_VIEW_MODELS.includes(entryKey)),
  );

  return {
    ...payload,
    [AUXILIARY_UI_KEY]: {
      ...auxiliary,
      [MESSAGE_RENDERERS_KEY]: cleanedRenderers,
    },
  };
};

const noopAbnormalityHandler = (): undefined => undefined;

/** Detecta el callback de `onAbnormalityDetected` que YouTube agenda en `Promise.prototype.then`. */
export const isAbnormalityCallback = (callback: unknown): boolean => {
  if (typeof callback !== "function") return false;
  try {
    return Function.prototype.toString.call(callback).includes(ABNORMALITY_MARKER);
  } catch {
    return false;
  }
};

type PromiseThen = typeof Promise.prototype.then;

const THEN_METHOD = "then";

/**
 * Envuelve `Promise.prototype.then` para sustituir cualquier callback de
 * `onAbnormalityDetected` por un no-op, impidiendo que el cliente fabrique el muro en vivo.
 */
export const installAbnormalityGuard = (onBlocked?: () => void): void => {
  const originalThen: PromiseThen = Promise.prototype.then;
  const guardedThen: PromiseThen = new Proxy(originalThen, {
    apply: (target, thisArg: Promise<unknown>, argArray: Parameters<PromiseThen>) => {
      const [onFulfilled, onRejected] = argArray;
      if (!isAbnormalityCallback(onFulfilled)) {
        return target.call(thisArg, onFulfilled, onRejected);
      }
      onBlocked?.();
      return target.call(thisArg, noopAbnormalityHandler, onRejected);
    },
  });

  Object.defineProperty(Promise.prototype, THEN_METHOD, {
    configurable: true,
    writable: true,
    value: guardedThen,
  });
};
