// Smoke vm del rescate endurecido: telemetría por etapa + supervivencia a excepciones.
// El pump solo retira los timers que vencen en cada paso; jamás limpia los futuros.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("./dist/innertube.js", `file://${import.meta.dirname}/../`), "utf8");

const makePlayer = (wall, videoId = "dQw4w9WgXcQ") => ({
  getPlayerResponse: () =>
    wall
      ? {
          videoDetails: { videoId },
          playabilityStatus: { status: "ERROR", errorScreen: { enforcementMessageViewModel: { title: "x" } } },
        }
      : { playabilityStatus: { status: "OK" }, videoDetails: { videoId } },
  loadVideoById: undefined,
});

const run = (name, { wallFromStart, lateWall, throwingUntil, neverSeen }) => {
  const pending = [];
  let t = 0;
  const rescues = [];
  const broken = { until: throwingUntil ?? 0 };

  // El reloj del sandbox sigue el tiempo virtual del pump: coherente con los timers falsos.
  const epochBase = 1_700_000_000_000;
  const VirtualDate = (ms) => new Date(ms);
  VirtualDate.now = () => epochBase + t;
  VirtualDate.prototype = Date.prototype;

  const cleanPlayer = makePlayer(false);
  cleanPlayer.loadVideoById = (id) => rescues.push({ at: t, id });
  const throwingPlayer = {
    getPlayerResponse: () => {
      if (t <= broken.until) throw new Error("boom en el player");
      return makePlayer(true).getPlayerResponse();
    },
    loadVideoById: (id) => rescues.push({ at: t, id }),
  };

  const document = {
    getElementById: (id) => {
      if (id !== "movie_player" || neverSeen) return null;
      if (lateWall && t < lateWall) return null;
      if (broken.until > 0 && t <= broken.until) return throwingPlayer;
      return wallFromStart || lateWall ? throwingPlayer : cleanPlayer;
    },
  };

  const sandbox = {
    console,
    URL,
    Headers,
    Response,
    Date: VirtualDate,
    setTimeout: (fn, ms) => {
      pending.push({ fn, at: t + ms });
      return pending.length;
    },
    clearTimeout: () => {},
    document,
    fetch: async () => new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } }),
  };
  sandbox.window = sandbox;
  sandbox.location = { search: "?blockadsdebug" };
  sandbox.XMLHttpRequest = class {
    open() {}
    send() {}
    addEventListener() {}
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  for (t = 0; t <= 80000; t += 250) {
    const due = pending.filter((p) => p.at <= t);
    for (const p of due) {
      pending.splice(pending.indexOf(p), 1);
      p.fn();
    }
  }

  const s = sandbox.window.__blockAdsInnerTube;
  console.log(`${name}: ${JSON.stringify(s)} rescates=${JSON.stringify(rescues)}`);
};

run("A muro desde el arranque", { wallFromStart: true });
run("B player que tira excepciones y luego amanece con muro", { throwingUntil: 1500, lateWall: 1 });
run("C player limpio toda la ventana", { wallFromStart: false });
run("D player que nunca aparece", { neverSeen: true });
