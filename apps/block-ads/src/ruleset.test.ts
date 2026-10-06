import { describe, expect, it } from "vitest";
import { RULESET_CORE_ID, RULESET_CORE_STORAGE_KEY, rulesetUpdate, storedRulesetEnabled } from "./ruleset.ts";

describe("estado del ruleset core", () => {
  it("habilita el ruleset core cuando el flag está activo", () => {
    expect(rulesetUpdate(true)).toEqual({ enableRulesetIds: [RULESET_CORE_ID], disableRulesetIds: [] });
  });

  it("deshabilita el ruleset core cuando el flag está apagado", () => {
    expect(rulesetUpdate(false)).toEqual({ enableRulesetIds: [], disableRulesetIds: [RULESET_CORE_ID] });
  });

  it("trata como activo todo lo que no sea un false explícito guardado", () => {
    expect(storedRulesetEnabled(undefined)).toBe(true);
    expect(storedRulesetEnabled(true)).toBe(true);
    expect(storedRulesetEnabled(false)).toBe(false);
  });

  it("usa la clave de storage que comparten el service worker y el popup", () => {
    expect(RULESET_CORE_STORAGE_KEY).toBe("rulesetCoreEnabled");
  });

  it("produce la forma exacta de UpdateRulesetOptions que acepta Chrome 87+", () => {
    expect(Object.keys(rulesetUpdate(true)).sort()).toEqual(["disableRulesetIds", "enableRulesetIds"]);
  });
});
