/**
 * Regla de enforcement: el server marca la respuesta de player con `playabilityStatus.status:
 * "ERROR"` y `errorScreen.enforcementMessageViewModel` cuando detecta el bloqueo de anuncios
 * (odd/specs/youtube-evidence.md §19). El material de stream llega intacto (era SABR: formats sin
 * `url`, con `serverAbrStreamingUrl`; test en vivo con reproducción sobre una respuesta OK), así
 * que la única diferencia jugable es ese estado.
 *
 * El disparador es estrecho a propósito: solo el view model de enforcement convierte un ERROR en
 * OK. Un video caído o restringido usa otros renderers de errorScreen y conserva su mensaje.
 */

export const PLAYABILITY_KEY = "playabilityStatus";
export const ENFORCEMENT_STATUS = "ERROR";
export const PLAYABLE_STATUS = "OK";

const ERROR_SCREEN_KEY = "errorScreen";
const ENFORCEMENT_VIEW_MODEL = "enforcementMessageViewModel";

type JsonObject = { readonly [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** true solo si el payload trae el muro tal como lo observamos: ERROR + view model de enforcement. */
export const hasEnforcementWall = (payload: unknown): boolean => {
  if (!isJsonObject(payload)) return false;

  const playability = payload[PLAYABILITY_KEY];
  if (!isJsonObject(playability) || playability.status !== ENFORCEMENT_STATUS) return false;

  const screen = playability[ERROR_SCREEN_KEY];

  return isJsonObject(screen) && ENFORCEMENT_VIEW_MODEL in screen;
};

/**
 * Reescribe el estado del muro a OK y saca errorScreen, conservando todo lo demás. Devuelve la
 * misma referencia cuando no hay muro: una respuesta limpia no se reconstruye (invariante del
 * commit a6cb126).
 */
export const neutralizeEnforcement = (payload: JsonValue | undefined): JsonValue | undefined => {
  if (!isJsonObject(payload) || !hasEnforcementWall(payload)) return payload;

  const playability = payload[PLAYABILITY_KEY];
  if (!isJsonObject(playability)) return payload;

  const screenless = Object.fromEntries(
    Object.entries(playability).filter(([entryKey]) => entryKey !== ERROR_SCREEN_KEY),
  );

  return { ...payload, [PLAYABILITY_KEY]: { ...screenless, status: PLAYABLE_STATUS } };
};
