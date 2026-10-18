#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import * as esbuild from "esbuild";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const USAGE = "uso: node build.mjs [--filters <archivo ABP>...] [--out <directorio>]";

const JS_BUNDLES = [
  { entry: "src/background.ts", outfile: "background.js" },
  { entry: "src/innertube.ts", outfile: "innertube.js" },
  { entry: "src/popup/popup.ts", outfile: "popup.js" },
];

const COPIED_FILES = [{ from: "src/popup/popup.html", to: "popup.html" }];

const ICON_SIZES = [16, 32, 48, 128];

const CRC_TABLE = Array.from({ length: 256 }, (_, index) =>
  Array.from({ length: 8 }).reduce(
    (crc) => (crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1),
    index,
  ) >>> 0,
);

const crc32 = (buffer) =>
  (buffer.reduce((crc, byte) => (CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0, 0xffffffff) ^ 0xffffffff) >>> 0;

const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
};

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const pointInShield = (nx, ny) => {
  const dx = Math.abs(nx);
  if (ny < -0.78 || ny > 0.84) return false;
  const maxWidth =
    ny < 0.05
      ? 0.74 - (ny + 0.78) * 0.04
      : 0.71 * Math.pow(Math.max(0, (0.84 - ny) / 0.79), 0.62);
  return dx <= maxWidth;
};

const shieldDistance = (nx, ny) => {
  const dx = Math.abs(nx);
  if (ny < -0.78) return -0.78 - ny;
  if (ny > 0.84) return ny - 0.84;
  const maxWidth =
    ny < 0.05
      ? 0.74 - (ny + 0.78) * 0.04
      : 0.71 * Math.pow(Math.max(0, (0.84 - ny) / 0.79), 0.62);
  return dx - maxWidth;
};

const pointInPlayTriangle = (nx, ny) => {
  const tx = nx + 0.04;
  const ty = ny + 0.02;
  if (tx < -0.22 || tx > 0.34) return false;
  const halfHeight = 0.30 * (1 - (tx + 0.22) / 0.56);
  return Math.abs(ty) <= halfHeight;
};

const sampleSubpixel = (nx, ny) => {
  if (!pointInShield(nx, ny)) return [0, 0, 0, 0];
  const distToEdge = Math.abs(shieldDistance(nx, ny));
  const slashDist = Math.abs(nx * 0.72 + ny * 0.69 - 0.02);

  if (distToEdge < 0.085) {
    return [239, 68, 68, 255];
  }
  if (slashDist < 0.058 && nx * 0.69 - ny * 0.72 > -0.36 && nx * 0.69 - ny * 0.72 < 0.36) {
    return [248, 113, 113, 255];
  }
  if (pointInPlayTriangle(nx, ny) && slashDist >= 0.088) {
    return [255, 255, 255, 255];
  }
  const grad = clamp01((ny + 0.78) / 1.62);
  const r = Math.round(18 + (1 - grad) * 24);
  const g = Math.round(20 + (1 - grad) * 10);
  const b = Math.round(38 + (1 - grad) * 28);
  return [r, g, b, 255];
};

const sampleIconPixel = (x, y, size) => {
  const offsets = [0.25, 0.75];
  const samples = offsets.flatMap((ox) =>
    offsets.map((oy) => {
      const nx = ((x + ox) / size) * 2 - 1;
      const ny = ((y + oy) / size) * 2 - 1;
      return sampleSubpixel(nx, ny);
    }),
  );
  const alphaSum = samples.reduce((acc, sample) => acc + sample[3], 0);
  if (alphaSum === 0) return [0, 0, 0, 0];
  const visible = samples.filter((sample) => sample[3] > 0);
  const avg = (channel) => Math.round(visible.reduce((acc, sample) => acc + sample[channel], 0) / visible.length);
  return [avg(0), avg(1), avg(2), Math.round(alphaSum / samples.length)];
};

const renderIconPng = (size) => {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  Array.from({ length: size }).forEach((_, y) => {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    Array.from({ length: size }).forEach((__, x) => {
      const [r, g, b, a] = sampleIconPixel(x, y, size);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    });
  });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

/** Listas consumidas cuando no se pasa `--filters`; `--filters` sigue teniendo prioridad. */
const DEFAULT_FILTER_FILES = ["youtube.txt"];

const defaultFilterFiles = () =>
  DEFAULT_FILTER_FILES.map((name) => fileURLToPath(import.meta.resolve(`@block-ads/rules/lists/${name}`)));

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

  const icons = ICON_SIZES.map((size) =>
    writeFile(path.join(outDir, `icon-${size}.png`), renderIconPng(size)),
  );

  await Promise.all([
    writeFile(path.join(outDir, "rules.json"), artifacts.rulesJson),
    writeFile(path.join(outDir, "cosmetics.css"), artifacts.cosmeticsCss),
    writeFile(path.join(outDir, "manifest.json"), artifacts.manifestJson),
    ...copies,
    ...icons,
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
  const filterFiles = args.filters.length > 0 ? args.filters : defaultFilterFiles();
  if (args.filters.length === 0) {
    process.stdout.write(`build: sin --filters; uso las listas de @block-ads/rules: ${filterFiles.join(", ")}\n`);
  }

  const [pipeline, sources] = await Promise.all([loadPipeline(), readFilterSources(filterFiles)]);
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
