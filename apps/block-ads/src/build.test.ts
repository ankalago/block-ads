import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { manifest, referencedFiles } from "./manifest.ts";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const buildScript = path.join(appRoot, "build.mjs");

const fixture = (name: string): string => path.join(appRoot, "test", "fixtures", name);

type BuildRun = {
  readonly status: number | null;
  readonly output: string;
  readonly outDir: string;
};

const runBuild = (filterFiles: readonly string[]): BuildRun => {
  const outDir = mkdtempSync(path.join(tmpdir(), "block-ads-build-"));
  const args = [...filterFiles.flatMap((file) => ["--filters", file]), "--out", outDir];
  const result = spawnSync(process.execPath, [buildScript, ...args], { cwd: appRoot, encoding: "utf8" });

  return { status: result.status, output: `${result.stdout}${result.stderr}`, outDir };
};

const readDist = (outDir: string, file: string): string => readFileSync(path.join(outDir, file), "utf8");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ruleIds = (rules: unknown): readonly unknown[] =>
  Array.isArray(rules) ? rules.map((rule) => (isRecord(rule) ? rule.id : undefined)) : [];

describe("pipeline de build", () => {
  it("emite todos los archivos que referencia el manifest", () => {
    const build = runBuild([fixture("youtube-sample.txt")]);

    expect(build.status).toBe(0);
    expect(referencedFiles(manifest).filter((file) => !existsSync(path.join(build.outDir, file)))).toEqual([]);
    expect(existsSync(path.join(build.outDir, "popup.js"))).toBe(true);
  });

  it("escribe el manifest desde src/manifest.ts, no desde un JSON a mano", () => {
    const build = runBuild([fixture("youtube-sample.txt")]);
    const written: unknown = JSON.parse(readDist(build.outDir, "manifest.json"));

    expect(written).toEqual(manifest);
  });

  it("emite las reglas de red con ids contiguos y las cosméticas como CSS", () => {
    const build = runBuild([fixture("youtube-sample.txt")]);
    const rules: unknown = JSON.parse(readDist(build.outDir, "rules.json"));

    expect(ruleIds(rules)).toEqual([1, 2, 3]);
    expect(readDist(build.outDir, "cosmetics.css")).toContain(".ad-banner { display: none !important; }");
  });

  it("deja el bundle de MAIN world sin APIs de chrome", () => {
    const build = runBuild([fixture("youtube-sample.txt")]);

    expect(readDist(build.outDir, "innertube.js")).not.toContain("chrome.");
  });

  it("sale con código distinto de cero cuando el compilador rechaza un filtro", () => {
    const build = runBuild([fixture("non-ascii-url-filter.txt")]);

    expect(build.status).not.toBe(0);
    expect(build.output).toContain("non-ascii-url-filter");
    expect(build.output).toContain("||canción.example^");
  });
});
