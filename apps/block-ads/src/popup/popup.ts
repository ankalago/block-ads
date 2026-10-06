import { RULESET_CORE_STORAGE_KEY, storedRulesetEnabled } from "../ruleset.ts";

const CHECKBOX_ID = "ruleset-enabled";
const STATE_ID = "state";

const renderState = (element: Element | null, enabled: boolean): void => {
  if (element === null) return;

  element.textContent = enabled ? "Activado" : "Desactivado";
};

const persist = async (enabled: boolean): Promise<void> => {
  await chrome.storage.local.set({ [RULESET_CORE_STORAGE_KEY]: enabled });
};

const initPopup = async (): Promise<void> => {
  const checkbox = document.querySelector(`#${CHECKBOX_ID}`);
  if (!(checkbox instanceof HTMLInputElement)) return;

  const state = document.querySelector(`#${STATE_ID}`);
  const stored = await chrome.storage.local.get(RULESET_CORE_STORAGE_KEY);
  const enabled = storedRulesetEnabled(stored[RULESET_CORE_STORAGE_KEY]);

  checkbox.checked = enabled;
  renderState(state, enabled);

  checkbox.addEventListener("change", () => {
    void persist(checkbox.checked);
    renderState(state, checkbox.checked);
  });
};

void initPopup();
