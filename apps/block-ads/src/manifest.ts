import { RULESET_CORE_ID } from "./ruleset.ts";

export const ExecutionWorld = ["ISOLATED", "MAIN"] as const;
export type ExecutionWorld = (typeof ExecutionWorld)[number];

export const RunAt = ["document_start", "document_end", "document_idle"] as const;
export type RunAt = (typeof RunAt)[number];

export type ManifestContentScript = {
  readonly matches: readonly string[];
  readonly js?: readonly string[];
  readonly css?: readonly string[];
  readonly run_at: RunAt;
  readonly world?: ExecutionWorld;
};

export type RuleResource = {
  readonly id: string;
  readonly enabled: boolean;
  readonly path: string;
};

export type ExtensionManifest = {
  readonly manifest_version: 3;
  readonly name: string;
  readonly version: string;
  readonly minimum_chrome_version: string;
  readonly permissions: readonly string[];
  readonly host_permissions: readonly string[];
  readonly background: { readonly service_worker: string };
  readonly action: { readonly default_popup: string; readonly default_title: string };
  readonly declarative_net_request: { readonly rule_resources: readonly RuleResource[] };
  readonly content_scripts: readonly ManifestContentScript[];
};

/** Hosts sobre los que se inyectan los content scripts; los consume el compilador de cosméticos. */
export const INJECTED_HOSTNAMES: readonly string[] = ["youtube.com"];

export const YOUTUBE_MATCHES: readonly string[] = ["https://*.youtube.com/*"];

export const RULESET_CORE_PATH = "rules.json";

/**
 * Fonte única del manifiesto: el build emite `dist/manifest.json` serializando este objeto.
 * El parche de InnerTube va como content script estático en MAIN world y `document_start`
 * (único vehículo con garantía de inyectarse antes del player); las cosméticas van por CSS.
 */
export const manifest = {
  manifest_version: 3,
  name: "Block Ads",
  version: "0.1.0",
  minimum_chrome_version: "111",
  permissions: ["declarativeNetRequest", "storage", "declarativeNetRequestFeedback"],
  host_permissions: YOUTUBE_MATCHES,
  background: { service_worker: "background.js" },
  action: { default_popup: "popup.html", default_title: "Block Ads" },
  declarative_net_request: {
    rule_resources: [{ id: RULESET_CORE_ID, enabled: true, path: RULESET_CORE_PATH }],
  },
  content_scripts: [
    { matches: YOUTUBE_MATCHES, js: ["innertube.js"], run_at: "document_start", world: "MAIN" },
    { matches: YOUTUBE_MATCHES, css: ["cosmetics.css"], run_at: "document_start" },
  ],
} as const satisfies ExtensionManifest;

/** Archivos del paquete que el manifest referencia: el build debe emitir todos. */
export const referencedFiles = (value: ExtensionManifest): readonly string[] => [
  value.background.service_worker,
  value.action.default_popup,
  ...value.declarative_net_request.rule_resources.map((resource) => resource.path),
  ...value.content_scripts.flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])]),
];
