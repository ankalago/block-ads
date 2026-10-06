#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const USAGE = "uso: node build.mjs [--filters <archivo ABP>...] [--out <directorio>]";

const JS_BUNDLES = [
  { entry: "src/background.ts", outfile: "background.js" },
  { entry: "src/innertube.ts", outfile: "innertube.js" },
  { entry: "src/popup/popup.ts", outfile: "popup.js" },
];

const COPIED_FILES = [{ from: "src/popup/popup.html", to: "popup.html" }];

const EMPTY_ARGS = { filters: [], out: undefined, reading: undefined, help: false };

const parseArgs = (argv) =>
  argv.reduce((state, arg) => {
    if (arg === "--help" || arg === "-h") return { ...state, help: true };
    if (arg === "--filters") return { ...state, reading: "filters" };
    if (arg === "--out") return { ...state, reading: "out" };
    if (arg.startsWith("--")) throw new Error(`argumento no reconocido: ${arg}`);
    if (state.reading === "out") return { ...state, out: arg, reading: undefined };
    if (state.reading === "filters") return { ...state, filters: [...state.filters, arg] };
    throw new Error(`falta --filters o --out antes de: ${arg}`);
  }, EMPTY_ARGS);

/**
 * Carga el pipeline TypeScript en este proceso: esbuild lo bundlea a un único módulo ESM y se
 * importa como data URL, sin ficheros temporales ni `node --experimental-strip-types`.
 */
const loadPipeline = async () => {
  const bundle = await esbuild.build({
    entryPoints: [path.join(appRoot, "src", "build-artifacts.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
    logLevel: "silent",
  });
  const code = bundle.outputFiles[0].text;

  return import(`data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`);
};

const readFilterSources = async (filterFiles) =>
  Promise.all(filterFiles.map((file) => readFile(path.resolve(appRoot, file), "utf8")));

const writeStaticArtifacts = async (outDir, artifacts) => {
  const copies = COPIED_FILES.map(async (file) => {
    const content = await readFile(path.join(appRoot, file.from), "utf8");

    return writeFile(path.join(outDir, file.to), content);
  });

  await Promise.all([
    writeFile(path.join(outDir, "rules.json"), artifacts.rulesJson),
    writeFile(path.join(outDir, "cosmetics.css"), artifacts.cosmeticsCss),
    writeFile(path.join(outDir, "manifest.json"), artifacts.manifestJson),
    ...copies,
  ]);
};

const bundleScripts = async (outDir) => {
  const minify = process.env.NODE_ENV === "production";

  await Promise.all(
    JS_BUNDLES.map((bundle) =>
      esbuild.build({
        entryPoints: [path.join(appRoot, bundle.entry)],
        outfile: path.join(outDir, bundle.outfile),
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "chrome111",
        minify,
        legalComments: "none",
        logLevel: "warning",
      }),
    ),
  );
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const outDir = path.resolve(appRoot, args.out ?? "dist");
  if (args.filters.length === 0) {
    process.stderr.write("build: sin --filters; se emite un ruleset vacío\n");
  }

  const [pipeline, sources] = await Promise.all([loadPipeline(), readFilterSources(args.filters)]);
  const artifacts = pipeline.buildArtifacts(sources);

  process.stdout.write(`${pipeline.formatReport(artifacts.report)}\n`);

  if (!artifacts.report.ok) {
    process.stderr.write("build: el ruleset tiene errores; no se emite dist\n");
    process.exit(1);
  }

  await mkdir(outDir, { recursive: true });
  await writeStaticArtifacts(outDir, artifacts);
  await bundleScripts(outDir);

  process.stdout.write(`build: artefactos escritos en ${outDir}\n`);
};

await main();
