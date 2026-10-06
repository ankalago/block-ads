export const ResourceType = [
  "script",
  "stylesheet",
  "image",
  "media",
  "font",
  "xmlhttprequest",
  "subdocument",
  "document",
  "ping",
  "websocket",
  "other",
] as const;
export type ResourceType = (typeof ResourceType)[number];

export const UnsupportedReason = [
  "comment",
  "empty",
  "unknown-option",
  "procedural-cosmetic",
  "unsupported-option",
  "malformed",
] as const;
export type UnsupportedReason = (typeof UnsupportedReason)[number];

/**
 * Patrón de una regla de red:
 * - `domainAnchor`: `||host^`, guarda el hostname sin anclas.
 * - `substring`: filtro plano (admite `*`), guarda el valor original tal cual.
 * - `regex`: `/re/`, guarda la fuente sin las barras.
 */
export type HostPattern =
  | { kind: "domainAnchor"; hostname: string }
  | { kind: "substring"; value: string }
  | { kind: "regex"; source: string };

export type NetworkFilter = {
  type: "network";
  /** Línea original sin `\r` y con trim exterior, para reproducirla en DNR. */
  source: string;
  exception: boolean;
  pattern: HostPattern;
  /** Vacío significa sin restricción de tipo de recurso. */
  resourceTypes: readonly ResourceType[];
  /** `undefined` significa sin restricción de terceros/primera parte. */
  thirdParty: boolean | undefined;
  /** Términos de `$domain=`; cada término conserva el prefijo `~` literal. */
  initiatorDomains: readonly string[];
  /** Términos de `$denyallow=`. */
  denyAllow: readonly string[];
};

export type CosmeticFilter = {
  type: "cosmetic";
  source: string;
  exception: boolean;
  /** Vacío significa regla global. */
  hostnames: readonly string[];
  selector: string;
};

export type ScriptletFilter = {
  type: "scriptlet";
  source: string;
  /** `#@#` marca la exclusión de un scriptlet. */
  exception: boolean;
  hostnames: readonly string[];
  scriptlet: string;
  args: readonly string[];
};

export type Filter = NetworkFilter | CosmeticFilter | ScriptletFilter;

export type ParsedLine = {
  line: number;
  text: string;
  reason: UnsupportedReason;
};

export type FilterList = {
  filters: readonly Filter[];
  unsupported: readonly ParsedLine[];
  totalLines: number;
};
