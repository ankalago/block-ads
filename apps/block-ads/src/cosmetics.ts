import type { CosmeticFilter } from "@block-ads/core/rules";

export type CosmeticEntry = {
  readonly source: string;
  readonly selector: string;
  readonly hostnames: readonly string[];
};

export const CosmeticBucket = ["emitted", "exceptions", "outOfScope"] as const;
export type CosmeticBucket = (typeof CosmeticBucket)[number];

export type CosmeticsReport = {
  readonly total: number;
  readonly emitted: number;
  readonly deduped: number;
  readonly exceptions: readonly CosmeticEntry[];
  readonly outOfScope: readonly CosmeticEntry[];
  readonly entries: readonly CosmeticEntry[];
};

export type CosmeticsResult = {
  readonly css: string;
  readonly report: CosmeticsReport;
};

const NEGATED_HOST_PREFIX = "~";
const WILDCARD_HOST_PREFIX = "*.";
const DISPLAY_NONE = "display: none !important;";

const toEntry = (filter: CosmeticFilter): CosmeticEntry => ({
  source: filter.source,
  selector: filter.selector,
  hostnames: filter.hostnames,
});

/** Host del filtro sin `~` ni `*.`, en minúsculas y sin puntos sobrantes. */
const normalizeHost = (host: string): string => {
  const withoutNegation = host.startsWith(NEGATED_HOST_PREFIX) ? host.slice(NEGATED_HOST_PREFIX.length) : host;
  const withoutWildcard = withoutNegation.startsWith(WILDCARD_HOST_PREFIX)
    ? withoutNegation.slice(WILDCARD_HOST_PREFIX.length)
    : withoutNegation;

  return withoutWildcard.replace(/^\.|\.$/g, "").toLowerCase();
};

const isNegated = (host: string): boolean => host.startsWith(NEGATED_HOST_PREFIX);

/** `pattern` cubre a `host` cuando son iguales o cuando es su dominio padre. */
const coversHost = (pattern: string, host: string): boolean => host === pattern || host.endsWith(`.${pattern}`);

const overlaps = (filterHost: string, injectedHost: string): boolean =>
  coversHost(normalizeHost(filterHost), normalizeHost(injectedHost)) ||
  coversHost(normalizeHost(injectedHost), normalizeHost(filterHost));

export const CosmeticScope = ["inScope", "outOfScope", "global"] as const;
export type CosmeticScope = (typeof CosmeticScope)[number];

/**
 * El CSS declarativo no puede casar el host del documento: el alcance real lo da el `matches`
 * del content script, que inyecta la hoja solo en `injectedHostnames`. Por eso aquí solo se
 * decide si el filtro pertenece a esos hosts; las reglas ajenas se reportan, nunca se emiten
 * sin scoping. Un filtro con `~host` queda fuera si el host negado es uno de los inyectados.
 */
export const hostScope = (filter: CosmeticFilter, injectedHostnames: readonly string[]): CosmeticScope => {
  const negated = filter.hostnames.filter(isNegated);
  if (injectedHostnames.some((host) => negated.some((pattern) => coversHost(normalizeHost(pattern), host)))) {
    return "outOfScope";
  }

  const positive = filter.hostnames.filter((host) => !isNegated(host));
  if (positive.length === 0) return "global";

  return injectedHostnames.some((host) => positive.some((pattern) => overlaps(pattern, host)))
    ? "inScope"
    : "outOfScope";
};

type Classification = {
  readonly bucket: CosmeticBucket;
  readonly entry: CosmeticEntry;
};

const classify = (filter: CosmeticFilter, injectedHostnames: readonly string[]): Classification => {
  const entry = toEntry(filter);
  if (filter.exception) return { bucket: "exceptions", entry };
  return hostScope(filter, injectedHostnames) === "outOfScope"
    ? { bucket: "outOfScope", entry }
    : { bucket: "emitted", entry };
};

const entriesOf = (classifications: readonly Classification[], bucket: CosmeticBucket): readonly CosmeticEntry[] =>
  classifications
    .filter((classification) => classification.bucket === bucket)
    .map((classification) => classification.entry);

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const sortBySource = (entries: readonly CosmeticEntry[]): readonly CosmeticEntry[] =>
  [...entries].sort((left, right) => compareText(left.source, right.source));

const toCssRule = (entry: CosmeticEntry): string => `${entry.selector} { ${DISPLAY_NONE} }`;

type UniqueSelectors = {
  readonly entries: readonly CosmeticEntry[];
  readonly deduped: number;
};

const uniqueSelectors = (entries: readonly CosmeticEntry[]): UniqueSelectors => {
  const sorted = [...entries].sort(
    (left, right) => compareText(left.selector, right.selector) || compareText(left.source, right.source),
  );
  const kept = sorted.filter((entry, index) => sorted[index - 1]?.selector !== entry.selector);

  return { entries: kept, deduped: sorted.length - kept.length };
};

const cssHeader = (injectedHostnames: readonly string[]): string =>
  `/* Block Ads: cosméticos; la hoja solo se inyecta en ${injectedHostnames.join(", ")} */`;

export const compileCosmetics = (
  filters: readonly CosmeticFilter[],
  injectedHostnames: readonly string[],
): CosmeticsResult => {
  const classifications = filters.map((filter) => classify(filter, injectedHostnames));
  const { entries, deduped } = uniqueSelectors(entriesOf(classifications, "emitted"));
  const css = entries.length === 0 ? "" : `${[cssHeader(injectedHostnames), ...entries.map(toCssRule)].join("\n")}\n`;

  return {
    css,
    report: {
      total: filters.length,
      emitted: entries.length,
      deduped,
      exceptions: sortBySource(entriesOf(classifications, "exceptions")),
      outOfScope: sortBySource(entriesOf(classifications, "outOfScope")),
      entries,
    },
  };
};
