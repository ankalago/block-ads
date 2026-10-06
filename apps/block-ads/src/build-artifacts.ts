import type { DnrCompileReport } from "@block-ads/core/dnr";
import { compileToDnrRules } from "@block-ads/core/dnr";
import { parseFilterList } from "@block-ads/core/parser";
import type { CosmeticFilter, Filter, FilterList, NetworkFilter, ParsedLine } from "@block-ads/core/rules";
import { UnsupportedReason } from "@block-ads/core/rules";
import type { CosmeticsReport } from "./cosmetics.ts";
import { compileCosmetics } from "./cosmetics.ts";
import { INJECTED_HOSTNAMES, manifest } from "./manifest.ts";

export type CountedReason = {
  readonly reason: UnsupportedReason;
  readonly count: number;
};

export type ParserReport = {
  readonly lists: number;
  readonly lines: number;
  readonly filters: number;
  readonly network: number;
  readonly cosmetics: number;
  readonly scriptlets: number;
  readonly unsupported: number;
  readonly unsupportedByReason: readonly CountedReason[];
};

export type BuildReport = {
  readonly ok: boolean;
  readonly parser: ParserReport;
  readonly dnr: DnrCompileReport;
  readonly cosmetics: CosmeticsReport;
};

export type BuildArtifacts = {
  readonly rulesJson: string;
  readonly cosmeticsCss: string;
  readonly manifestJson: string;
  readonly report: BuildReport;
};

const isNetwork = (filter: Filter): filter is NetworkFilter => filter.type === "network";
const isCosmetic = (filter: Filter): filter is CosmeticFilter => filter.type === "cosmetic";
const isScriptlet = (filter: Filter): boolean => filter.type === "scriptlet";

const filtersOf = (lists: readonly FilterList[]): readonly Filter[] => lists.flatMap((list) => list.filters);

const unsupportedOf = (lists: readonly FilterList[]): readonly ParsedLine[] =>
  lists.flatMap((list) => list.unsupported);

const unsupportedByReason = (lines: readonly ParsedLine[]): readonly CountedReason[] =>
  UnsupportedReason.map((reason) => ({ reason, count: lines.filter((line) => line.reason === reason).length })).filter(
    (item) => item.count > 0,
  );

const summarize = (lists: readonly FilterList[]): ParserReport => {
  const filters = filtersOf(lists);

  return {
    lists: lists.length,
    lines: lists.reduce((total, list) => total + list.totalLines, 0),
    filters: filters.length,
    network: filters.filter(isNetwork).length,
    cosmetics: filters.filter(isCosmetic).length,
    scriptlets: filters.filter(isScriptlet).length,
    unsupported: unsupportedOf(lists).length,
    unsupportedByReason: unsupportedByReason(unsupportedOf(lists)),
  };
};

/** Compila el IR de una o más listas ABP a los artefactos que consume el manifest. */
export const buildArtifacts = (filterSources: readonly string[]): BuildArtifacts => {
  const lists = filterSources.map((source) => parseFilterList(source));
  const filters = filtersOf(lists);
  const { rules, report } = compileToDnrRules(filters.filter(isNetwork));
  const cosmetics = compileCosmetics(filters.filter(isCosmetic), INJECTED_HOSTNAMES);

  return {
    rulesJson: `${JSON.stringify(rules, null, 2)}\n`,
    cosmeticsCss: cosmetics.css,
    manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
    report: { ok: report.ok, parser: summarize(lists), dnr: report, cosmetics: cosmetics.report },
  };
};

const section = (title: string, items: readonly string[]): readonly string[] =>
  items.length === 0 ? [] : [`${title}: ${items.length}`, ...items.map((item) => `  - ${item}`)];

export const formatReport = (report: BuildReport): string => {
  const { parser, dnr, cosmetics } = report;
  const errorLines = dnr.errors.map((error) => `${error.code}: ${error.source} (${error.detail})`);

  return [
    `Listas: ${parser.lists} (${parser.lines} líneas), filtros: ${parser.filters} (red ${parser.network}, cosméticos ${parser.cosmetics}, scriptlets ${parser.scriptlets})`,
    `Red: ${dnr.static} reglas (urlFilter ${dnr.static - dnr.regex}, regex ${dnr.regex}), bloqueos ${dnr.block}, excepciones ${dnr.allow}`,
    ...section("Descartadas por el compiler", errorLines),
    ...section(
      "Duplicadas",
      dnr.duplicates.map((duplicate) => duplicate.source),
    ),
    ...section(
      "Descartadas por el parser",
      parser.unsupportedByReason.map((item) => `${item.reason}: ${item.count}`),
    ),
    `Cosméticos: ${cosmetics.emitted} emitidas, ${cosmetics.exceptions.length} excepciones (#@#), ${cosmetics.outOfScope.length} fuera del alcance de inyección, ${cosmetics.deduped} duplicadas`,
    ...section(
      "Excepciones #@# (no se emiten)",
      cosmetics.exceptions.map((entry) => entry.source),
    ),
    ...section(
      "Cosméticos fuera del alcance de inyección",
      cosmetics.outOfScope.map((entry) => entry.source),
    ),
    report.ok ? "Resultado: ruleset válido" : `Resultado: RULESET INVÁLIDO (${dnr.errors.length} errores)`,
  ].join("\n");
};
