import { describe, expect, it } from "vitest";
import { INJECTED_HOSTNAMES, manifest, referencedFiles } from "./manifest.ts";

describe("manifest MV3", () => {
  it("publica el parche de InnerTube como content script estático en MAIN al document_start", () => {
    const first = manifest.content_scripts[0];

    expect(first.world).toBe("MAIN");
    expect(first.run_at).toBe("document_start");
    expect(first.js).toEqual(["innertube.js"]);
  });

  it("carga las cosméticas como CSS estático, fuera del MAIN world", () => {
    const second = manifest.content_scripts[1];

    expect(second.css).toEqual(["cosmetics.css"]);
    expect(second.run_at).toBe("document_start");
  });

  it("declara el ruleset core habilitado apuntando a rules.json", () => {
    expect(manifest.declarative_net_request.rule_resources).toEqual([
      { id: "core", enabled: true, path: "rules.json" },
    ]);
  });

  it("registra versión 1.0.5, descripción, iconos, service worker, popup y permisos", () => {
    expect(manifest.version).toBe("1.0.5");
    expect(manifest.description.length).toBeGreaterThan(20);
    expect(manifest.icons).toEqual({
      "16": "icon-16.png",
      "32": "icon-32.png",
      "48": "icon-48.png",
      "128": "icon-128.png",
    });
    expect(manifest.background.service_worker).toBe("background.js");
    expect(manifest.action.default_popup).toBe("popup.html");
    expect(manifest.action.default_icon).toEqual(manifest.icons);
    expect(manifest.minimum_chrome_version).toBe("111");
    expect(manifest.permissions).toEqual(["declarativeNetRequest", "storage", "declarativeNetRequestFeedback"]);
    expect(manifest.host_permissions).toEqual(["https://*.youtube.com/*"]);
  });

  it("expone los hosts inyectados que consume el compilador de cosméticos", () => {
    expect(INJECTED_HOSTNAMES).toEqual(["youtube.com"]);
  });

  it("declara todos los archivos que el build debe emitir para cargarla sin empaquetar", () => {
    expect([...referencedFiles(manifest)].sort()).toEqual([
      "background.js",
      "cosmetics.css",
      "icon-128.png",
      "icon-16.png",
      "icon-32.png",
      "icon-48.png",
      "innertube.js",
      "popup.html",
      "rules.json",
    ]);
  });
});
