import type {
  Filter,
  FilterList,
  HostPattern,
  NetworkFilter,
  ParsedLine,
  ResourceType,
  UnsupportedReason,
} from "./rules.ts";

type ParseOutcome = { ok: true; filter: Filter } | { ok: false; reason: UnsupportedReason };

type OptionState = {
  readonly resourceTypes: readonly ResourceType[];
  readonly thirdParty: boolean | undefined;
  readonly initiatorDomains: readonly string[];
  readonly denyAllow: readonly string[];
};

type OptionsOutcome =
  | { readonly ok: true; readonly state: OptionState }
  | { readonly ok: false; readonly reason: UnsupportedReason };

type Separator = {
  readonly index: number;
  readonly length: number;
  readonly exception: boolean;
};

type ScriptletOutcome = { ok: true; scriptlet: string; args: readonly string[] } | { ok: false };

const LINE_BREAK = "\n";
const CARRIAGE_RETURN = /\r/g;
const OPTION_SEPARATOR = ",";
const DOMAIN_ANCHOR_PATTERN = /^\|\|[^*/^]+\^$/;
const REGEX_PATTERN = /^\/(.+)\/$/s;
const SCRIPTLET_PATTERN = /^\+js\((.*)\)$/s;

const COMMENT_PREFIXES: readonly string[] = ["!", "["];

const PROCEDURAL_SELECTOR_MARKERS: readonly string[] = [":has(", ":upward(", ":style("];

/** Separadores de cosmética procedural de uBO que el IR no compila. */
const PROCEDURAL_SEPARATORS: readonly string[] = ["#?#", "#$?#", "#%#", "#@?#", "#@$?#", "#@%#"];

const THIRD_PARTY_OPTIONS: readonly string[] = ["third-party", "3p"];
const FIRST_PARTY_OPTIONS: readonly string[] = ["1p", "~third-party", "~3p"];

/** Opciones ABP/EasyList reconocidas pero fuera del subconjunto soportado. */
const UNSUPPORTED_OPTION_NAMES: ReadonlySet<string> = new Set([
  "all",
  "badfilter",
  "csp",
  "doc",
  "ehide",
  "elemhide",
  "empty",
  "generichide",
  "genericblock",
  "ghide",
  "important",
  "inline-font",
  "inline-script",
  "popup",
  "queryprune",
  "redirect",
  "removeparam",
  "replace",
  "rewrite",
  "shide",
  "speculative",
  "urltransform",
]);

const RESOURCE_TYPE_OPTIONS = [
  ["script", "script"],
  ["stylesheet", "stylesheet"],
  ["css", "stylesheet"],
  ["image", "image"],
  ["media", "media"],
  ["font", "font"],
  ["xmlhttprequest", "xmlhttprequest"],
  ["xhr", "xmlhttprequest"],
  ["subdocument", "subdocument"],
  ["document", "document"],
  ["ping", "ping"],
  ["websocket", "websocket"],
  ["other", "other"],
] as const satisfies readonly (readonly [string, ResourceType])[];

const RESOURCE_TYPE_BY_OPTION: ReadonlyMap<string, ResourceType> = new Map(RESOURCE_TYPE_OPTIONS);

const EMPTY_OPTION_STATE: OptionState = {
  resourceTypes: [],
  thirdParty: undefined,
  initiatorDomains: [],
  denyAllow: [],
};

const stripCarriageReturns = (text: string): string => text.replace(CARRIAGE_RETURN, "");

const normalizeSource = (text: string): string => stripCarriageReturns(text).trim();

const isComment = (source: string): boolean => COMMENT_PREFIXES.some((prefix) => source.startsWith(prefix));

const isProceduralSelector = (selector: string): boolean =>
  PROCEDURAL_SELECTOR_MARKERS.some((marker) => selector.includes(marker));

const hasProceduralSeparator = (body: string): boolean =>
  PROCEDURAL_SEPARATORS.some((separator) => body.includes(separator));

const addUnique = <T>(values: readonly T[], value: T): readonly T[] =>
  values.includes(value) ? values : [...values, value];

const splitList = (text: string): readonly string[] => {
  if (text === "") return [];
  const body = text.endsWith(LINE_BREAK) ? text.slice(0, -1) : text;
  return body.split(LINE_BREAK);
};

const classifyPattern = (pattern: string): HostPattern => {
  if (DOMAIN_ANCHOR_PATTERN.test(pattern)) return { kind: "domainAnchor", hostname: pattern.slice(2, -1) };
  if (REGEX_PATTERN.test(pattern)) return { kind: "regex", source: pattern.slice(1, -1) };
  return { kind: "substring", value: pattern };
};

const splitTrimmed = (text: string, separator: string): readonly string[] =>
  text
    .split(separator)
    .map((token) => token.trim())
    .filter((token) => token !== "");

const parseDomains = (value: string): readonly string[] => splitTrimmed(value, "|");

const parseHostnames = (text: string): readonly string[] => splitTrimmed(text, OPTION_SEPARATOR);

const isOptionShaped = (token: string): boolean => {
  if (token.includes("=")) return true;
  if (THIRD_PARTY_OPTIONS.includes(token) || FIRST_PARTY_OPTIONS.includes(token)) return true;
  const name = token.startsWith("~") ? token.slice(1) : token;
  return RESOURCE_TYPE_BY_OPTION.has(name) || UNSUPPORTED_OPTION_NAMES.has(name);
};

/** Nombre base de una opción: sin `~` inicial y sin el valor tras `=`. */
const optionName = (token: string): string => {
  const withoutNegation = token.startsWith("~") ? token.slice(1) : token;
  const equalsIndex = withoutNegation.indexOf("=");
  return equalsIndex === -1 ? withoutNegation : withoutNegation.slice(0, equalsIndex);
};

const findSeparator = (body: string): Separator | undefined => {
  const hashIndex = body.indexOf("##");
  const exceptionIndex = body.indexOf("#@#");

  if (exceptionIndex === -1) {
    return hashIndex === -1 ? undefined : { index: hashIndex, length: 2, exception: false };
  }
  if (hashIndex === -1 || exceptionIndex < hashIndex) {
    return { index: exceptionIndex, length: 3, exception: true };
  }
  return { index: hashIndex, length: 2, exception: false };
};

const applyOption = (outcome: OptionsOutcome, token: string): OptionsOutcome => {
  if (!outcome.ok) return outcome;
  const { state } = outcome;
  if (THIRD_PARTY_OPTIONS.includes(token)) return { ok: true, state: { ...state, thirdParty: true } };
  if (FIRST_PARTY_OPTIONS.includes(token)) return { ok: true, state: { ...state, thirdParty: false } };
  if (token.startsWith("domain="))
    return { ok: true, state: { ...state, initiatorDomains: parseDomains(token.slice("domain=".length)) } };
  if (token.startsWith("denyallow="))
    return { ok: true, state: { ...state, denyAllow: parseDomains(token.slice("denyallow=".length)) } };

  const negated = token.startsWith("~");
  const resourceType = RESOURCE_TYPE_BY_OPTION.get(negated ? token.slice(1) : token);
  if (resourceType !== undefined && !negated) {
    return { ok: true, state: { ...state, resourceTypes: addUnique(state.resourceTypes, resourceType) } };
  }
  if (resourceType !== undefined) return { ok: false, reason: "unsupported-option" };
  if (UNSUPPORTED_OPTION_NAMES.has(optionName(token))) return { ok: false, reason: "unsupported-option" };
  return { ok: false, reason: "unknown-option" };
};

const parseOptions = (tail: string): OptionsOutcome | undefined => {
  const tokens = tail.split(OPTION_SEPARATOR).map((token) => token.trim());
  if (!tokens.some(isOptionShaped)) return undefined;
  return tokens.reduce(applyOption, { ok: true, state: EMPTY_OPTION_STATE } satisfies OptionsOutcome);
};

const parseScriptletSelector = (selector: string): ScriptletOutcome | undefined => {
  const match = SCRIPTLET_PATTERN.exec(selector);
  if (match === null) return undefined;

  const tokens = splitTrimmed(match[1] ?? "", OPTION_SEPARATOR);
  const [scriptlet, ...args] = tokens;
  if (scriptlet === undefined) return { ok: false };

  return { ok: true, scriptlet, args };
};

const parseCosmetic = (body: string, source: string, markedException: boolean): ParseOutcome | undefined => {
  if (hasProceduralSeparator(body)) return { ok: false, reason: "procedural-cosmetic" };

  const separator = findSeparator(body);
  if (separator === undefined) return undefined;

  const hostnames = parseHostnames(body.slice(0, separator.index));
  const selector = body.slice(separator.index + separator.length).trim();
  if (selector === "") return { ok: false, reason: "malformed" };
  if (isProceduralSelector(selector)) return { ok: false, reason: "procedural-cosmetic" };

  const scriptlet = parseScriptletSelector(selector);
  if (scriptlet === undefined) {
    const exception = markedException || separator.exception;
    return { ok: true, filter: { type: "cosmetic", source, exception, hostnames, selector } };
  }
  if (!scriptlet.ok) return { ok: false, reason: "malformed" };

  return {
    ok: true,
    filter: {
      type: "scriptlet",
      source,
      exception: markedException || separator.exception,
      hostnames,
      scriptlet: scriptlet.scriptlet,
      args: scriptlet.args,
    },
  };
};

const toNetworkFilter = (
  source: string,
  exception: boolean,
  pattern: string,
  options: OptionState | undefined,
): NetworkFilter => ({
  type: "network",
  source,
  exception,
  pattern: classifyPattern(pattern),
  resourceTypes: options?.resourceTypes ?? [],
  thirdParty: options?.thirdParty,
  initiatorDomains: options?.initiatorDomains ?? [],
  denyAllow: options?.denyAllow ?? [],
});

const parseNetwork = (body: string, source: string, exception: boolean): ParseOutcome => {
  const dollarIndex = body.indexOf("$");
  const options = dollarIndex === -1 ? undefined : parseOptions(body.slice(dollarIndex + 1));
  const pattern = options === undefined ? body : body.slice(0, dollarIndex);

  if (pattern === "") return { ok: false, reason: "malformed" };
  if (options === undefined) return { ok: true, filter: toNetworkFilter(source, exception, pattern, undefined) };
  if (!options.ok) return { ok: false, reason: options.reason };

  return { ok: true, filter: toNetworkFilter(source, exception, pattern, options.state) };
};

const parseLine = (text: string): ParseOutcome => {
  const source = normalizeSource(text);
  if (source === "") return { ok: false, reason: "empty" };
  if (isComment(source)) return { ok: false, reason: "comment" };

  const exception = source.startsWith("@@");
  const body = (exception ? source.slice(2) : source).trim();
  if (body === "") return { ok: false, reason: "malformed" };

  return parseCosmetic(body, source, exception) ?? parseNetwork(body, source, exception);
};

type LineEntry = { readonly line: number; readonly text: string };
type LineOutcome = LineEntry & { readonly outcome: ParseOutcome };

const isSupported = (entry: LineOutcome): entry is LineEntry & { outcome: { ok: true; filter: Filter } } =>
  entry.outcome.ok;

const toUnsupported = (entry: LineOutcome): ParsedLine | undefined =>
  entry.outcome.ok ? undefined : { line: entry.line, text: entry.text, reason: entry.outcome.reason };

const isDefined = (line: ParsedLine | undefined): line is ParsedLine => line !== undefined;

export const parseFilterLine = (text: string): Filter | undefined => {
  const outcome = parseLine(text);
  return outcome.ok ? outcome.filter : undefined;
};

export const parseFilterList = (source: string): FilterList => {
  const outcomes = splitList(source).map((text, index) => {
    const line = stripCarriageReturns(text);
    return { line: index + 1, text: line, outcome: parseLine(line) };
  });

  return {
    filters: outcomes.filter(isSupported).map((entry) => entry.outcome.filter),
    unsupported: outcomes.map(toUnsupported).filter(isDefined),
    totalLines: outcomes.length,
  };
};
