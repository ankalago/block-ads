import { RULESET_CORE_STORAGE_KEY, rulesetUpdate, storedRulesetEnabled } from "./ruleset.ts";

const applyRuleset = async (enabled: boolean): Promise<void> => {
  await chrome.declarativeNetRequest.updateEnabledRulesets(rulesetUpdate(enabled));
};

/** `chrome.storage.local` es la única fuente de verdad del toggle; se reaplica al arrancar. */
const syncRuleset = async (): Promise<void> => {
  const stored = await chrome.storage.local.get(RULESET_CORE_STORAGE_KEY);

  await applyRuleset(storedRulesetEnabled(stored[RULESET_CORE_STORAGE_KEY]));
};

chrome.runtime.onStartup.addListener(() => {
  void syncRuleset();
});

chrome.runtime.onInstalled.addListener(() => {
  void syncRuleset();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  const change = changes[RULESET_CORE_STORAGE_KEY];
  if (change === undefined) return;

  void applyRuleset(storedRulesetEnabled(change.newValue));
});
