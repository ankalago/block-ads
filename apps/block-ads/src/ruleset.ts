/** Estado compartido por el service worker y el popup; `chrome.storage` es el canal. */
export const RULESET_CORE_STORAGE_KEY = "rulesetCoreEnabled";

export const RULESET_CORE_DEFAULT_ENABLED = true;

export const RULESET_CORE_ID = "core";

export type RulesetUpdate = {
  readonly enableRulesetIds: string[];
  readonly disableRulesetIds: string[];
};

export const rulesetUpdate = (enabled: boolean): RulesetUpdate =>
  enabled
    ? { enableRulesetIds: [RULESET_CORE_ID], disableRulesetIds: [] }
    : { enableRulesetIds: [], disableRulesetIds: [RULESET_CORE_ID] };

/** Solo un `false` guardado apaga el bloqueo; sin valor, el default es activo. */
export const storedRulesetEnabled = (value: unknown): boolean => value !== false;
