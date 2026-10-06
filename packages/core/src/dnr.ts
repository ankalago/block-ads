import type { HostPattern, NetworkFilter, ResourceType } from "./rules.ts";

export const DnrResourceType = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "webtransport",
  "webbundle",
  "other",
] as const;
export type DnrResourceType = (typeof DnrResourceType)[number];

export const DnrErrorCode = [
  "non-ascii-regex",
  "empty-regex-filter",
  "regex-too-long",
  "regex-unsupported-construct",
  "empty-url-filter",
  "non-ascii-url-filter",
  "url-filter-||*-prefix",
  "invalid-initiator-domain",
  "regex-budget-exceeded",
  "static-rules-budget-exceeded",
] as const;
export type DnrErrorCode = (typeof DnrErrorCode)[number];

export type DnrCondition = {
  readonly urlFilter?: string;
  readonly regexFilter?: string;
  readonly resourceTypes?: readonly DnrResourceType[];
  readonly domainType?: "firstParty" | "thirdParty";
  readonly initiatorDomains?: readonly string[];
  readonly excludedInitiatorDomains?: readonly string[];
};

export type DnrRule = {
  readonly id: number;
  readonly priority: number;
  readonly action: { readonly type: "block" | "allow" };
  readonly condition: DnrCondition;
};

export type DnrCompileError = {
  readonly id?: number;
  readonly source: string;
  readonly code: DnrErrorCode;
  readonly detail: string;
};

export type DnrDroppedItem = {
  readonly filter: NetworkFilter;
  readonly error: DnrCompileError;
};

export type DnrDuplicate = {
  readonly source: string;
};

export type DnrCompileReport = {
  readonly total: number;
  readonly block: number;
  readonly allow: number;
  readonly regex: number;
  readonly static: number;
  readonly ok: boolean;
  readonly errors: readonly DnrCompileError[];
  readonly dropped: readonly DnrDroppedItem[];
  readonly duplicates: readonly DnrDuplicate[];
};

export type DnrCompileResult = {
  readonly rules: readonly DnrRule[];
  readonly report: DnrCompileReport;
};

/** `GUARANTEED_MINIMUM_STATIC_RULES` de Chrome. */
const MAX_STATIC_RULES = 30_000;
/** `MAX_NUMBER_OF_REGEX_RULES` de Chrome. */
const MAX_REGEX_RULES = 1_000;
/** Presupuesto propio, conservador frente a los 2 KB compilados de Chrome. */
const MAX_REGEX_LENGTH = 1_000;
const BLOCK_PRIORITY = 1;
const ALLOW_PRIORITY = 2;

const NON_ASCII_PATTERN = /[\u0080-\uFFFF]/;
const BACKREFERENCE_PATTERN = /\\[1-9]|\\k[<{]/;
const FORBIDDEN_DOMAIN_CHARACTER = /[\s/*\u0080-\uFFFF]/;

const UNSUPPORTED_REGEX_CONSTRUCTS = ["(?=", "(?!", "(?<=", "(?<!", "(?>", "(?("] as const;

const RESOURCE_TYPE_MAP = [
  ["document", ["main_frame", "sub_frame"]],
  ["subdocument", ["sub_frame"]],
  ["script", ["script"]],
  ["stylesheet", ["stylesheet"]],
  ["image", ["image"]],
  ["media", ["media"]],
  ["font", ["font"]],
  ["xmlhttprequest", ["xmlhttprequest"]],
  ["ping", ["ping"]],
  ["websocket", ["websocket"]],
  ["other", ["other"]],
] as const satisfies readonly (readonly [ResourceType, readonly DnrResourceType[]])[];

const DNR_RESOURCE_TYPES_BY_IR: ReadonlyMap<ResourceType, readonly DnrResourceType[]> = new Map<
  ResourceType,
  readonly DnrResourceType[]
>(RESOURCE_TYPE_MAP);

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const dnrResourceTypes = (types: readonly ResourceType[]): readonly DnrResourceType[] =>
  unique(types.flatMap((type) => DNR_RESOURCE_TYPES_BY_IR.get(type) ?? []));

const stripTilde = (term: string): string => (term.startsWith("~") ? term.slice(1) : term);

const isInvalidDomain = (term: string): boolean => term === "" || FORBIDDEN_DOMAIN_CHARACTER.test(term);

type PatternOutcome =
  | { readonly ok: true; readonly condition: DnrCondition }
  | { readonly ok: false; readonly code: DnrErrorCode; readonly detail: string };

const regexToCondition = (source: string): PatternOutcome => {
  if (source === "") return { ok: false, code: "empty-regex-filter", detail: "regexFilter vacío" };
  if (NON_ASCII_PATTERN.test(source)) {
    return { ok: false, code: "non-ascii-regex", detail: "regexFilter contiene caracteres no ASCII" };
  }
  if (source.length > MAX_REGEX_LENGTH) {
    return {
      ok: false,
      code: "regex-too-long",
      detail: `regexFilter de ${source.length} caracteres supera ${MAX_REGEX_LENGTH}`,
    };
  }
  const construct = UNSUPPORTED_REGEX_CONSTRUCTS.find((token) => source.includes(token));
  if (construct !== undefined) {
    return { ok: false, code: "regex-unsupported-construct", detail: `RE2 no soporta ${construct}` };
  }
  if (BACKREFERENCE_PATTERN.test(source)) {
    return { ok: false, code: "regex-unsupported-construct", detail: "RE2 no soporta backreferences" };
  }
  return { ok: true, condition: { regexFilter: source } };
};

const urlFilterToCondition = (urlFilter: string): PatternOutcome => {
  if (urlFilter === "") return { ok: false, code: "empty-url-filter", detail: "urlFilter vacío" };
  if (NON_ASCII_PATTERN.test(urlFilter)) {
    return {
      ok: false,
      code: "non-ascii-url-filter",
      detail: "urlFilter contiene caracteres no ASCII; el host debe ir en punycode",
    };
  }
  if (urlFilter.startsWith("||*")) {
    return { ok: false, code: "url-filter-||*-prefix", detail: "urlFilter no puede empezar por ||*" };
  }
  return { ok: true, condition: { urlFilter } };
};

const patternToCondition = (pattern: HostPattern): PatternOutcome => {
  if (pattern.kind === "regex") return regexToCondition(pattern.source);
  if (pattern.kind === "domainAnchor") return urlFilterToCondition(`||${pattern.hostname}^`);
  return urlFilterToCondition(pattern.value);
};

type InitiatorTerms = {
  readonly included: readonly string[];
  readonly excluded: readonly string[];
};

const EMPTY_INITIATOR_TERMS: InitiatorTerms = { included: [], excluded: [] };

const splitInitiatorTerms = (terms: readonly string[]): InitiatorTerms =>
  terms.reduce<InitiatorTerms>(
    (acc, term) =>
      term.startsWith("~")
        ? { included: acc.included, excluded: [...acc.excluded, stripTilde(term)] }
        : { included: [...acc.included, term], excluded: acc.excluded },
    EMPTY_INITIATOR_TERMS,
  );

const withResourceTypes = (condition: DnrCondition, filter: NetworkFilter): DnrCondition => {
  const resourceTypes = dnrResourceTypes(filter.resourceTypes);
  return resourceTypes.length === 0 ? condition : { ...condition, resourceTypes };
};

const withDomainType = (condition: DnrCondition, filter: NetworkFilter): DnrCondition => {
  if (filter.thirdParty === undefined) return condition;
  return { ...condition, domainType: filter.thirdParty ? "thirdParty" : "firstParty" };
};

const withInitiatorDomains = (condition: DnrCondition, filter: NetworkFilter): DnrCondition => {
  const initiators = splitInitiatorTerms(filter.initiatorDomains);
  const denyAllow = filter.denyAllow.map(stripTilde);
  const included = unique(initiators.included);
  const excluded = unique([...initiators.excluded, ...denyAllow]);
  const withIncluded = included.length === 0 ? condition : { ...condition, initiatorDomains: included };
  return excluded.length === 0 ? withIncluded : { ...withIncluded, excludedInitiatorDomains: excluded };
};

const buildCondition = (base: DnrCondition, filter: NetworkFilter): DnrCondition =>
  withInitiatorDomains(withDomainType(withResourceTypes(base, filter), filter), filter);

const buildRule = (id: number, filter: NetworkFilter, base: DnrCondition): DnrRule => ({
  id,
  priority: filter.exception ? ALLOW_PRIORITY : BLOCK_PRIORITY,
  action: { type: filter.exception ? "allow" : "block" },
  condition: buildCondition(base, filter),
});

type FilterValidation =
  | { readonly ok: true; readonly condition: DnrCondition }
  | { readonly ok: false; readonly code: DnrErrorCode; readonly detail: string };

const validateFilter = (filter: NetworkFilter): FilterValidation => {
  const pattern = patternToCondition(filter.pattern);
  if (!pattern.ok) return pattern;

  const invalidDomain = [...filter.initiatorDomains, ...filter.denyAllow].map(stripTilde).find(isInvalidDomain);
  if (invalidDomain !== undefined) {
    return { ok: false, code: "invalid-initiator-domain", detail: `hostname inválido: '${invalidDomain}'` };
  }
  return { ok: true, condition: pattern.condition };
};

const sameActionAndSource = (a: NetworkFilter, b: NetworkFilter): boolean =>
  a.source === b.source && a.exception === b.exception;

const compareForDedupe = (a: NetworkFilter, b: NetworkFilter): number => {
  const bySource = a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
  if (bySource !== 0) return bySource;
  if (a.exception === b.exception) return 0;
  return a.exception ? -1 : 1;
};

type FilterOrder = {
  readonly ordered: readonly NetworkFilter[];
  readonly duplicates: readonly DnrDuplicate[];
};

const orderFilters = (filters: readonly NetworkFilter[]): FilterOrder => {
  const sorted = [...filters].sort(compareForDedupe);
  const entries = sorted.map((filter, index) => ({ filter, previous: sorted[index - 1] }));
  const kept = entries
    .filter((entry) => entry.previous === undefined || !sameActionAndSource(entry.previous, entry.filter))
    .map((entry) => entry.filter);
  const duplicates = entries
    .filter((entry) => entry.previous !== undefined && sameActionAndSource(entry.previous, entry.filter))
    .map((entry) => ({ source: entry.filter.source }));
  return {
    ordered: [...kept.filter((filter) => filter.exception), ...kept.filter((filter) => !filter.exception)],
    duplicates,
  };
};

type Candidate = {
  readonly filter: NetworkFilter;
  readonly condition: DnrCondition;
};

const toDropped = (filter: NetworkFilter, error: DnrCompileError): DnrDroppedItem => ({ filter, error });

const budgetDetail = (scope: string, limit: number): string => `${scope}: se supera el máximo de ${limit} reglas`;

export const compileToDnrRules = (filters: readonly NetworkFilter[]): DnrCompileResult => {
  const { ordered, duplicates } = orderFilters(filters);

  const validations = ordered.map((filter) => ({ filter, validation: validateFilter(filter) }));
  const candidates = validations.flatMap<Candidate>((entry) =>
    entry.validation.ok ? [{ filter: entry.filter, condition: entry.validation.condition }] : [],
  );
  const invalidDropped = validations.flatMap<DnrDroppedItem>((entry) =>
    entry.validation.ok
      ? []
      : [
          toDropped(entry.filter, {
            source: entry.filter.source,
            code: entry.validation.code,
            detail: entry.validation.detail,
          }),
        ],
  );

  const regexCandidates = candidates.filter((candidate) => candidate.filter.pattern.kind === "regex");
  const regexOverflow = regexCandidates.slice(MAX_REGEX_RULES);
  const regexOverflowSet: ReadonlySet<Candidate> = new Set(regexOverflow);
  const afterRegex = candidates.filter((candidate) => !regexOverflowSet.has(candidate));

  const numbered = afterRegex.map((candidate, index) => ({ candidate, id: index + 1 }));
  const staticOverflow = numbered.slice(MAX_STATIC_RULES);
  const rules = numbered
    .slice(0, MAX_STATIC_RULES)
    .map((entry) => buildRule(entry.id, entry.candidate.filter, entry.candidate.condition));

  const regexBudgetDropped = regexOverflow.map((candidate) =>
    toDropped(candidate.filter, {
      source: candidate.filter.source,
      code: "regex-budget-exceeded",
      detail: budgetDetail("regex", MAX_REGEX_RULES),
    }),
  );
  const staticBudgetDropped = staticOverflow.map((entry) =>
    toDropped(entry.candidate.filter, {
      id: entry.id,
      source: entry.candidate.filter.source,
      code: "static-rules-budget-exceeded",
      detail: budgetDetail("static", MAX_STATIC_RULES),
    }),
  );

  const dropped = [...invalidDropped, ...regexBudgetDropped, ...staticBudgetDropped];
  const errors = dropped.map((item) => item.error);

  return {
    rules,
    report: {
      total: filters.length,
      block: rules.filter((rule) => rule.action.type === "block").length,
      allow: rules.filter((rule) => rule.action.type === "allow").length,
      regex: rules.filter((rule) => rule.condition.regexFilter !== undefined).length,
      static: rules.length,
      ok: errors.length === 0,
      errors,
      dropped,
      duplicates,
    },
  };
};
