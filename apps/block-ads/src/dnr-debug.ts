export type BlockedHit = {
  readonly ruleId: number;
  readonly url: string;
  readonly resourceType: string;
  readonly filter: string;
  readonly hits: number;
  readonly at: number;
};

export const DNR_BLOCKED_KEY = "dnrBlocked";

export const MAX_BLOCKED_HITS = 60;

type HitIdentity = { readonly ruleId: number; readonly url: string; readonly resourceType: string };

type IncomingHit = HitIdentity & { readonly filter: string };

type DnrRule = {
  readonly id: number;
  readonly condition: { readonly urlFilter?: string; readonly regexFilter?: string };
};

export const hitKey = (hit: HitIdentity): string => `${hit.ruleId}|${hit.url}|${hit.resourceType}`;

export const recordHit = (buffer: readonly BlockedHit[], incoming: IncomingHit, now: number): readonly BlockedHit[] => {
  const key = hitKey(incoming);
  const existing = buffer.find((hit) => hitKey(hit) === key);
  const rest = buffer.filter((hit) => hitKey(hit) !== key);
  const next: BlockedHit =
    existing === undefined
      ? {
          ruleId: incoming.ruleId,
          url: incoming.url,
          resourceType: incoming.resourceType,
          filter: incoming.filter,
          hits: 1,
          at: now,
        }
      : { ...existing, filter: incoming.filter, hits: existing.hits + 1, at: now };

  return [...rest, next].slice(-MAX_BLOCKED_HITS);
};

export const filterMapFromRules = (rules: readonly DnrRule[]): Map<number, string> =>
  new Map<number, string>(
    rules.map((rule): readonly [number, string] => [
      rule.id,
      rule.condition.urlFilter ?? rule.condition.regexFilter ?? "",
    ]),
  );

export const filterForId = (map: Map<number, string>, id: number): string => map.get(id) ?? "";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === "string";

const isDnrRule = (value: unknown): value is DnrRule =>
  isRecord(value) &&
  typeof value.id === "number" &&
  isRecord(value.condition) &&
  isOptionalString(value.condition.urlFilter) &&
  isOptionalString(value.condition.regexFilter);

const parseRules = (raw: unknown): readonly DnrRule[] => (Array.isArray(raw) ? raw.filter(isDnrRule) : []);

const isBlockedHit = (value: unknown): value is BlockedHit =>
  isRecord(value) &&
  typeof value.ruleId === "number" &&
  typeof value.url === "string" &&
  typeof value.resourceType === "string" &&
  typeof value.filter === "string" &&
  typeof value.hits === "number" &&
  typeof value.at === "number";

const readBuffer = (value: unknown): readonly BlockedHit[] => (Array.isArray(value) ? value.filter(isBlockedHit) : []);

/**
 * Registra en `chrome.storage.session` los impactos que las reglas DNR bloquean de verdad.
 * `onRuleMatchedDebug` solo existe en extensiones sin empaquetar con `declarativeNetRequestFeedback`;
 * si no está, no hay nada que registrar.
 */
export const installMatchedDebugRecorder = (): void => {
  const matchedDebug = chrome.declarativeNetRequest.onRuleMatchedDebug;
  if (matchedDebug === undefined) return;

  const state = { loaded: false, filters: new Map<number, string>(), tail: Promise.resolve() };

  const loadFilters = async (): Promise<void> => {
    state.loaded = true;
    try {
      const response = await fetch(chrome.runtime.getURL("rules.json"));
      const raw: unknown = await response.json();
      state.filters = filterMapFromRules(parseRules(raw));
    } catch {
      state.filters = new Map<number, string>();
    }
  };

  const record = async (info: chrome.declarativeNetRequest.MatchedRuleInfoDebug): Promise<void> => {
    if (!state.loaded) await loadFilters();

    const stored = await chrome.storage.session.get(DNR_BLOCKED_KEY);
    const next = recordHit(
      readBuffer(stored[DNR_BLOCKED_KEY]),
      {
        ruleId: info.rule.ruleId,
        url: info.request.url,
        resourceType: info.request.type,
        filter: filterForId(state.filters, info.rule.ruleId),
      },
      Date.now(),
    );

    await chrome.storage.session.set({ [DNR_BLOCKED_KEY]: next });
  };

  matchedDebug.addListener((info) => {
    // Encadenada: dos bloqueos concurrentes leerían el mismo buffer y uno perdería su impacto.
    state.tail = state.tail.then(() => record(info)).catch(() => {});
  });
};
