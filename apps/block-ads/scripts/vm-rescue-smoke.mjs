// Smoke vm del rescate endurecido: telemetría por etapa + supervivencia a excepciones.
// El pump solo retira los timers que vencen en cada paso; jamás limpia los futuros.
// La location NO lleva token: la telemetría se publica siempre, sin opt-in por URL.
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

const run = (name, { wallFromStart, lateWall, wallAfter, throwingUntil, neverSeen, freezeAt, nudgeAt, nudgeType }) => {
  const pending = [];
  let t = 0;
  const rescues = [];
  const broken = { until: throwingUntil ?? 0 };

  // El reloj del sandbox sigue el tiempo virtual del pump: coherente con los timers falsos.
  const epochBase = 1_700_000_000_000;
  const VirtualDate = (ms) => new Date(ms);
  VirtualDate.now = () => epochBase + t;
  VirtualDate.prototype = Date.prototype;

  // El muro real puede llegar después de la última lectura posible: los nudges (foco, play)
  // tienen que rescatarlo aunque los timers estén congelados o la ventana vencida. El muro está
  // activo desde el arranque (wallFromStart) o cuando llega junto con el player tardío (lateWall);
  // wallAfter lo enciende más tarde sobre un player ya visible y limpio.
  const wall = { on: Boolean(wallFromStart) || lateWall !== undefined };
  const nudges = [];

  const cleanPlayer = makePlayer(false);
  cleanPlayer.loadVideoById = (id) => rescues.push({ at: t, id });
  const walledPlayer = makePlayer(true);
  walledPlayer.loadVideoById = (id) => rescues.push({ at: t, id });
  const throwingPlayer = {
    getPlayerResponse: () => {
      if (t <= broken.until) throw new Error("boom en el player");
      return (wall.on ? walledPlayer : cleanPlayer).getPlayerResponse();
    },
    loadVideoById: (id) => rescues.push({ at: t, id }),
  };

  const document = {
    getElementById: (id) => {
      if (id !== "movie_player" || neverSeen) return null;
      if (lateWall && t < lateWall) return null;
      if (broken.until > 0 && t <= broken.until) return throwingPlayer;
      if (wallAfter !== undefined) return wall.on ? throwingPlayer : cleanPlayer;
      return wallFromStart || lateWall ? throwingPlayer : cleanPlayer;
    },
    visibilityState: "visible",
    addEventListener: (type, handler) => {
      nudges.push({ type, handler });
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
  sandbox.location = { search: "" };
  sandbox.XMLHttpRequest = class {
    open() {}
    send() {}
    addEventListener() {}
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  for (t = 0; t <= 120000; t += 250) {
    if (wallAfter !== undefined && t >= wallAfter) wall.on = true;
    if (freezeAt !== undefined && t === freezeAt) {
      pending.length = 0; // el tab congeló los timers: no vuelve a dispararse ninguno
    }
    if (nudgeAt !== undefined && t === nudgeAt) {
      const nudge = nudges.find((n) => n.type === (nudgeType ?? "visibilitychange"));
      nudge?.handler(); // nudge fuera de la cadena de timers
    }
    const due = pending.filter((p) => p.at <= t);
    for (const p of due) {
      pending.splice(pending.indexOf(p), 1);
      p.fn();
    }
  }

  const s = sandbox.window.__blockAdsInnerTube;
  if (s === undefined) throw new Error(`${name}: la telemetría no se publicó sin token`);
  console.log(`${name}: ${JSON.stringify(s)} rescates=${JSON.stringify(rescues)}`);
};

run("A muro desde el arranque", { wallFromStart: true });
run("B player que tira excepciones y luego amanece con muro", { throwingUntil: 1500, lateWall: 1 });
run("C player limpio toda la ventana", { wallFromStart: false });
run("D player que nunca aparece", { neverSeen: true });
// El paste real de Paul (13e0673): respuesta limpia durante la primera vigía, muro minutos
// después. La vigía de minutos tiene que cazarlo.
run("E muro que llega a los 20 s tras una respuesta limpia", { lateWall: 20000 });
// El paste de Paul con la vigía de minutos: la vigía hizo 5 lecturas limpias y los timers
// congelaron para siempre; el muro llegó después y el usuario volvió al tab. El nudge de foco
// tiene que rescatarlo aunque la cadena de timers esté muerta.
run("F timers congelados a los 5 s, muro a los 10 s, foco a los 30 s", {
  wallFromStart: false,
  wallAfter: 10000,
  freezeAt: 5000,
  nudgeAt: 30000,
  nudgeType: "visibilitychange",
});
// El gesto del usuario también interroga: un tab puede estar oculto (timers congelados) mientras
// el usuario toca la página; el pointerdown en captura rescata aunque el foco nunca vuelva.
run("G timers congelados a los 5 s, muro a los 10 s, toque a los 30 s", {
  wallFromStart: false,
  wallAfter: 10000,
  freezeAt: 5000,
  nudgeAt: 30000,
  nudgeType: "pointerdown",
});
