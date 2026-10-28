import { runComparison } from "./simulation.js";
import { MantaMap } from "./manta-map.js?v=motion-2";
import { initMotion } from "./motion.js?v=motion-2";
import { SimulationClock } from "./playback.js";

const $ = (selector) => document.querySelector(selector);
const form = $("#simulation-form");
const controls = Object.fromEntries(
  [
    "origin",
    "transmission",
    "vaccines",
    "strategy",
    "seed",
    "initial-infected",
    "vaccine-efficacy",
    "response-day",
    "runs",
    "adaptive",
  ].map((id) => [id, document.getElementById(id)]),
);
const number = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 1 });
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let latestResult = null;
let running = false;
let territoryMap = null;
let outbreakMap = null;
let selectedPlace = "mercado";
let day = 0;
let lastRenderedDay = -1;
let lastRenderedStrategy = "";
let playbackRunning = false;
let didAutoPlay = false;
let mapInView = false;
let currentView = "map";
let sceneLive = !reducedMotion.matches;
let sceneZoom = 1;

initMotion();

const menuButton = $(".menu-toggle");
const mobileNavigation = $("#mobile-nav");
function closeMenu() {
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Abrir menú");
  mobileNavigation.hidden = true;
}
menuButton.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
  mobileNavigation.hidden = !open;
});
mobileNavigation
  .querySelectorAll("a")
  .forEach((link) => link.addEventListener("click", closeMenu));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !mobileNavigation.hidden) {
    closeMenu();
    menuButton.focus();
  }
});
window.matchMedia("(min-width: 701px)").addEventListener("change", (event) => {
  if (event.matches) closeMenu();
});

function setStatus(message, pending = false) {
  const status = $("#result-status");
  const dot = document.createElement("i");
  dot.className = `live-dot ${pending ? "" : "green"}`;
  status.replaceChildren(dot, document.createTextNode(message));
}
function syncRanges(markPending = true) {
  for (const name of ["transmission", "vaccines"]) {
    const input = controls[name];
    const percent =
      ((Number(input.value) - Number(input.min)) /
        (Number(input.max) - Number(input.min))) *
      100;
    input.style.setProperty("--value", `${percent}%`);
    const output = $(`#${name}-value`);
    output.textContent = input.value;
    input.setAttribute(
      "aria-valuetext",
      name === "transmission"
        ? `${input.value} por ciento por contacto y día`
        : `${input.value} dosis`,
    );
    if (name === "transmission") {
      const span = document.createElement("span");
      span.textContent = "%";
      output.append(span);
    }
  }
  if (markPending && latestResult) {
    $("#pending-state").textContent = "Hay cambios pendientes de ejecutar.";
    setStatus("Configuración modificada", true);
  }
}
function getConfiguration() {
  return {
    origin: controls.origin.value,
    transmission: Number(controls.transmission.value) / 100,
    vaccines: Number(controls.vaccines.value),
    seed: Number(controls.seed.value),
    initialInfected: Number(controls["initial-infected"].value),
    vaccineEfficacy: Number(controls["vaccine-efficacy"].value) / 100,
    responseDay: Number(controls["response-day"].value),
    runs: Number(controls.runs.value),
    strategy: controls.strategy.value,
    adaptive: controls.adaptive.checked,
  };
}

function drawChart(result) {
  const chart = $("#simulation-chart");
  const width = 740,
    height = 290;
  const margin = { left: 42, right: 18, top: 20, bottom: 32 };
  const x = (d) =>
    margin.left + (d / result.days) * (width - margin.left - margin.right);
  const y = (count) =>
    height -
    margin.bottom -
    (count / result.population) * (height - margin.top - margin.bottom);
  const path = (series) =>
    series
      .map(
        (point, index) =>
          `${index ? "L" : "M"}${x(point.day).toFixed(2)},${y(point.cumulative).toFixed(2)}`,
      )
      .join(" ");
  const grid = [0, 60, 120, 180, 240]
    .map(
      (value) =>
        `<line class="chart-grid" x1="${margin.left}" y1="${y(value)}" x2="${width - margin.right}" y2="${y(value)}"/><text class="chart-tick" x="30" y="${y(value) + 3}" text-anchor="end">${value}</text>`,
    )
    .join("");
  const xTicks = [0, 5, 10, 15, 20, 25, 30]
    .map(
      (d) =>
        `<text class="chart-tick" x="${x(d)}" y="${height - 8}" text-anchor="middle">${d}</text>`,
    )
    .join("");
  const area = `${path(result.strategic.series)} L${x(result.days)},${y(0)} L${x(0)},${y(0)} Z`;
  const curves = ["baseline", "random", "strategic"]
    .map((strategy) => {
      const final = result[strategy].series.at(-1);
      const color = {
        baseline: "#8d9db1",
        random: "#b3a0db",
        strategic: "#ff9254",
      }[strategy];
      return `<path class="chart-path ${strategy}" d="${path(result[strategy].series)}"/><circle cx="${x(result.days)}" cy="${y(final.cumulative)}" r="3" fill="${color}" stroke="#0d1622" stroke-width="2"/>`;
    })
    .join("");
  chart.innerHTML = `<title id="chart-title">Contagios acumulados durante 30 días</title><desc id="chart-description">Promedios de ${result.runs} réplicas: estrategia ${number.format(result.strategic.totalInfected)}, azar ${number.format(result.random.totalInfected)}, sin intervención ${number.format(result.baseline.totalInfected)} contagios.</desc><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#ff9254" stop-opacity=".13"/><stop offset="1" stop-color="#ff9254" stop-opacity="0"/></linearGradient></defs>${grid}${xTicks}<path d="${area}" fill="url(#chart-fill)" stroke="none"/>${curves}`;
  resizeChartLabels();
}
function resizeChartLabels() {
  const chart = $("#simulation-chart");
  const { width, height } = chart.getBoundingClientRect();
  const scale = Math.min(width / 740, height / 290);
  if (scale > 0)
    chart.style.setProperty("--chart-tick-size", `${11 / scale}px`);
}
if ("ResizeObserver" in window)
  new ResizeObserver(resizeChartLabels).observe($("#simulation-chart"));

function renderComparison(result) {
  const colors = {
    strategic: "#ff9254",
    random: "#b3a0db",
    baseline: "#8d9db1",
  };
  const names = {
    strategic: "Con estrategia",
    random: "Al azar",
    baseline: "Sin intervención",
  };
  $("#comparison-body").innerHTML = ["strategic", "random", "baseline"]
    .map(
      (key) =>
        `<tr class="${key === "strategic" ? "strategy-row" : ""}"><td><span class="legend-dot" style="background:${colors[key]}"></span>${names[key]}</td><td><strong>${number.format(result[key].totalInfected)}</strong></td><td>${result[key].range[0]}–${result[key].range[1]}</td><td title="Promedio de dosis asignadas entre las réplicas">${number.format(result[key].vaccinesUsed)} / ${key === "baseline" ? 0 : result.vaccines}</td></tr>`,
    )
    .join("");
  $("#comparison-config").textContent =
    `Semilla ${result.seed} · ${result.runs} réplicas · 30 días`;
  const delta = result.random.totalInfected - result.strategic.totalInfected;
  const target =
    result.strategy === "bridge"
      ? "a quienes conectan distintos grupos"
      : "a las personas con más conexiones";
  let recommendation;
  if (result.saved > 0.05 && delta >= 0) {
    recommendation = `Prioriza ${target}. En este escenario, la estrategia evita ${number.format(result.saved)} contagios medios frente a no intervenir y ${number.format(delta)} frente al azar, con el mismo presupuesto de ${result.vaccines} dosis.`;
  } else if (delta < -0.05) {
    recommendation = `En este escenario, la asignación al azar obtiene ${number.format(-delta)} contagios medios menos que la prioridad elegida. Revisa el punto de inicio, el momento de respuesta y la estrategia antes de decidir.`;
  } else {
    recommendation =
      "Con estas condiciones no se observa una ventaja clara de la estrategia. Revisa las dosis, la eficacia y el tiempo de respuesta, y compara un nuevo escenario.";
  }
  $("#recommendation-text").textContent = recommendation;
  const report = $("#report-configuration");
  const origins = {
    mercado: "Mercado central",
    escuela: "Entorno ULEAM",
    transporte: "Terminal terrestre",
  };
  const configuration = {
    "Punto de inicio": origins[result.origin],
    "Población / horizonte": `${result.population} agentes / ${result.days} días`,
    "Contagio por contacto y día": `${number.format(result.transmission * 100)}%`,
    "Presupuesto de dosis": result.vaccines,
    Eficacia: `${number.format(result.vaccineEfficacy * 100)}%`,
    "Día de respuesta": result.responseDay,
    "Casos infecciosos iniciales": result.initialInfected,
    Estrategia: `${result.strategy === "bridge" ? "Puentes entre grupos" : "Más conexiones"}${result.adaptive ? " · respuesta adaptativa" : ""}`,
    "Semilla / réplicas": `${result.seed} / ${result.runs}`,
  };
  report.replaceChildren();
  for (const [label, value] of Object.entries(configuration)) {
    const group = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = String(value);
    group.append(term, description);
    report.append(group);
  }
}
const clock = new SimulationClock({
  onFrame: renderPlaybackFrame,
  onFinish: () => {
    stopPlayback();
    $("#playback-event").textContent =
      "Recorrido completo. Compara otro futuro.";
  },
});
function animateReadout(element, value) {
  const text = String(value);
  if (element.textContent === text) return;
  element.textContent = text;
  if (!reducedMotion.matches) {
    element.getAnimations?.().forEach((animation) => animation.cancel());
    element.animate(
      [
        { opacity: 0.25, transform: "translateY(9px)", filter: "blur(3px)" },
        { opacity: 1, transform: "translateY(0)", filter: "blur(0px)" },
      ],
      { duration: 480, easing: "cubic-bezier(.22,1,.36,1)" },
    );
  }
}
const numberAnimations = new WeakMap();
function animateMetric(element, target, suffix = "") {
  const previousFrame = numberAnimations.get(element);
  if (previousFrame) cancelAnimationFrame(previousFrame);
  const previous = Number(element.dataset.numericValue ?? 0);
  element.dataset.numericValue = String(target);
  if (reducedMotion.matches) {
    element.textContent = `${number.format(target)}${suffix}`;
    return;
  }
  let started = null;
  function frame(timestamp) {
    started ??= timestamp;
    const progress = Math.min(1, (timestamp - started) / 950);
    const eased = 1 - Math.pow(1 - progress, 4);
    element.textContent = `${number.format(previous + (target - previous) * eased)}${suffix}`;
    if (progress < 1)
      numberAnimations.set(element, requestAnimationFrame(frame));
    else numberAnimations.delete(element);
  }
  numberAnimations.set(element, requestAnimationFrame(frame));
}
function renderPlaybackFrame({ position, day: integerDay, fraction }) {
  day = integerDay;
  const slider = $("#day-slider");
  slider.value = String(position);
  slider.style.setProperty("--value", `${(position / 30) * 100}%`);
  $(".simulation-map").style.setProperty(
    "--day-progress",
    `${fraction * 100}%`,
  );
  $("#day-progress-fill").style.width = `${(position / 30) * 100}%`;
  $("#model-clock").textContent =
    `${String(Math.floor(fraction * 24)).padStart(2, "0")}:${String(Math.floor(fraction * 24 * 60) % 60).padStart(2, "0")}`;
  const strategy = $("#map-strategy").value;
  outbreakMap?.setFrame(integerDay, fraction, strategy);
  if (integerDay === lastRenderedDay && strategy === lastRenderedStrategy)
    return;
  lastRenderedDay = integerDay;
  lastRenderedStrategy = strategy;
  animateReadout($("#map-day"), String(integerDay).padStart(2, "0"));
  $("#day-output").textContent = `Día ${integerDay}`;
  const states = latestResult?.timeline?.[strategy]?.[integerDay];
  if (!states) return;
  const counts = [0, 0, 0, 0];
  states.forEach((state) => counts[state]++);
  animateReadout($("#map-infected-count"), counts[2]);
  ["susceptible", "exposed", "infected", "immune"].forEach((state, index) =>
    animateReadout($(`#live-${state}`), counts[index]),
  );
  const before = latestResult.timeline[strategy][Math.max(0, integerDay - 1)];
  const newlyExposed = states.filter(
    (state, index) => state === 1 && before[index] === 0,
  ).length;
  const recovered = states.filter(
    (state, index) => state === 3 && before[index] !== 3,
  ).length;
  const message =
    integerDay === 0
      ? "Paciente cero detectado. La ciudad sigue en movimiento."
      : newlyExposed > 0
        ? `${newlyExposed} nuevas exposiciones · ${counts[2]} zombies activos`
        : recovered > 0
          ? `${recovered} agentes pasan a inmunes · ${counts[2]} zombies activos`
          : counts[2] === 0
            ? "Sin agentes infecciosos activos en este día."
            : `Observando ${counts[2]} agentes infecciosos activos.`;
  $("#playback-event").textContent = message;
  if (!reducedMotion.matches && playbackRunning)
    $(".day-transition-flash").animate([{ opacity: 0.45 }, { opacity: 0 }], {
      duration: 750,
      easing: "ease-out",
    });
}
function setDay(value) {
  clock.seek(Number(value));
}
function stopPlayback() {
  clock.pause();
  playbackRunning = false;
  $("#play-button").setAttribute("aria-label", "Reproducir evolución");
  $("#play-button use").setAttribute("href", "#i-play");
  $(".map-view").classList.remove("is-playing");
}
function startPlayback() {
  if (!latestResult || clock.playing || currentView !== "map") return;
  playbackRunning = true;
  $("#play-button").setAttribute("aria-label", "Pausar evolución");
  $("#play-button use").setAttribute("href", "#i-pause");
  $(".map-view").classList.add("is-playing");
  clock.play();
}
$("#play-button").addEventListener("click", () =>
  clock.playing ? stopPlayback() : startPlayback(),
);
$("#day-slider").addEventListener("input", (event) => {
  stopPlayback();
  setDay(event.target.value);
});
$("#map-strategy").addEventListener("change", () => {
  lastRenderedStrategy = "";
  renderPlaybackFrame({
    position: clock.position,
    day: Math.floor(clock.position),
    fraction: clock.position % 1,
  });
});
$("#playback-speed").addEventListener("change", (event) =>
  clock.setSpeed(event.target.value),
);
if ("IntersectionObserver" in window)
  new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        mapInView = entry.isIntersecting;
        if (
          mapInView &&
          !didAutoPlay &&
          latestResult &&
          !reducedMotion.matches
        ) {
          didAutoPlay = true;
          startPlayback();
        } else if (!mapInView) stopPlayback();
      }
    },
    { threshold: 0.3 },
  ).observe($("#view-map"));
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) {
    stopPlayback();
    sceneLive = false;
  } else {
    sceneLive = true;
  }
  syncSceneLive();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPlayback();
});

async function executeSimulation({ animatePlayback = false } = {}) {
  if (running || !form.reportValidity()) return;
  running = true;
  stopPlayback();
  const results = $("#results"),
    button = $("#run-button");
  const scenarioControls = [
    ...form.querySelectorAll("input, select, button"),
    ...document.querySelectorAll("[data-surprise]"),
  ];
  scenarioControls.forEach((control) => {
    control.disabled = true;
  });
  results.setAttribute("aria-busy", "true");
  button.disabled = true;
  $("#download-results").disabled = true;
  button.querySelector("span").textContent = "Calculando escenarios…";
  setStatus("Simulando");
  try {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const result = runComparison(getConfiguration());
    latestResult = result;
    drawChart(result);
    renderComparison(result);
    animateMetric($("#saved-value"), result.saved);
    animateMetric($("#reduction-value"), result.reduction, "%");
    $("#range-value").textContent =
      `${result.strategic.range[0]}–${result.strategic.range[1]}`;
    outbreakMap?.setSimulation(result);
    lastRenderedDay = -1;
    lastRenderedStrategy = "";
    setDay(0);
    $("#pending-state").textContent = "";
    setStatus("Simulación completa");
    $("#simulation-announcement").textContent =
      `Simulación completada. Semilla ${result.seed}, ${result.runs} réplicas: ${number.format(result.saved)} contagios evitados y ${number.format(result.reduction)} por ciento de reducción frente a no intervenir.`;
    $("#download-results").disabled = false;
    if (mapInView && animatePlayback && !reducedMotion.matches) startPlayback();
    if (mapInView && !didAutoPlay && !reducedMotion.matches) {
      didAutoPlay = true;
      startPlayback();
    }
  } catch (error) {
    setStatus("Revisa la configuración", true);
    $("#pending-state").textContent =
      "No se pudo ejecutar. Revisa los parámetros.";
    console.error("Simulation failed:", error);
  } finally {
    results.setAttribute("aria-busy", "false");
    scenarioControls.forEach((control) => {
      control.disabled = false;
    });
    button.querySelector("span").textContent = "Ejecutar simulación";
    running = false;
  }
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  executeSimulation({ animatePlayback: true });
});
form.addEventListener("input", () => syncRanges());
form.addEventListener("change", () => syncRanges());
$("#shuffle-seed").addEventListener("click", () => {
  const seed = new Uint32Array(1);
  crypto.getRandomValues(seed);
  controls.seed.value = seed[0] % 1000000000;
  syncRanges();
});
$("#reset-button").addEventListener("click", () => {
  form.reset();
  document
    .querySelectorAll("[data-surprise]")
    .forEach((b) => b.classList.remove("is-active"));
  syncRanges(false);
  executeSimulation();
});
document.querySelectorAll("[data-surprise]").forEach((button) =>
  button.addEventListener("click", () => {
    if (running) return;
    document
      .querySelectorAll("[data-surprise]")
      .forEach((b) => b.classList.toggle("is-active", b === button));
    switch (button.dataset.surprise) {
      case "transmission":
        controls.transmission.value = Math.min(
          100,
          Number(controls.transmission.value) * 2,
        );
        break;
      case "vaccines":
        controls.vaccines.value = Math.floor(
          Number(controls.vaccines.value) / 2,
        );
        break;
      case "origin":
        controls.origin.value = "transporte";
        break;
      case "efficacy":
        controls["vaccine-efficacy"].value = 50;
        break;
    }
    syncRanges(false);
    executeSimulation({ animatePlayback: true });
  }),
);

function showView(view) {
  currentView = view;
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $("#view-map").hidden = view !== "map";
  $("#view-chart").hidden = view !== "chart";
  if (view === "chart") {
    stopPlayback();
    resizeChartLabels();
    if (!reducedMotion.matches) {
      $("#simulation-chart").animate(
        [
          { opacity: 0, transform: "translateY(7px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 600, easing: "cubic-bezier(.22,1,.36,1)" },
      );
      document.querySelectorAll(".chart-path").forEach((path, index) => {
        const length = path.getTotalLength?.();
        if (length)
          path.animate(
            [
              {
                strokeDasharray: `${length} ${length}`,
                strokeDashoffset: length,
              },
              { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 },
            ],
            {
              duration: 1250,
              delay: index * 90,
              easing: "cubic-bezier(.16,1,.3,1)",
            },
          );
      });
    }
  } else {
    outbreakMap?.setDay(day, $("#map-strategy").value);
    if (!reducedMotion.matches)
      $(".simulation-map").animate(
        [
          {
            opacity: 0.2,
            transform: "translateY(12px) scale(.98)",
            filter: "blur(4px)",
          },
          {
            opacity: 1,
            transform: "translateY(0) scale(1)",
            filter: "blur(0px)",
          },
        ],
        { duration: 650, easing: "cubic-bezier(.16,1,.3,1)" },
      );
  }
}
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const view =
      event.key === "Home"
        ? "map"
        : event.key === "End"
          ? "chart"
          : currentView === "map"
            ? "chart"
            : "map";
    showView(view);
    $(`#tab-${view}`).focus();
  });
});

const placeIds = {
  mercado: "mercado",
  escuela: "uleam",
  transporte: "terminal",
};
const placeDescriptions = {
  mercado:
    "Un lugar de encuentro diario. El escenario representa contactos intensos entre grupos y hogares.",
  escuela:
    "El entorno universitario conecta estudiantes, transporte y hogares. La red es una simplificación ilustrativa.",
  transporte:
    "Un punto que conecta desplazamientos de la ciudad. Explora cómo cambia el escenario al iniciar aquí.",
};
fetch("./assets/manta-map.json")
  .then((response) => {
    if (!response.ok) throw new Error("Map unavailable");
    return response.json();
  })
  .then((data) => {
    territoryMap = new MantaMap($("#territory-map"), data, {
      interactive: true,
      labels: true,
    });
    outbreakMap = new MantaMap($("#outbreak-map"), data, { labels: false });
    outbreakMap.setLive(sceneLive);
    if (latestResult) {
      outbreakMap.setSimulation(latestResult);
      setDay(day);
    }
    function focusPlace(origin) {
      selectedPlace = origin;
      territoryMap.setFocus(placeIds[origin]);
      document
        .querySelectorAll("[data-place]")
        .forEach((button) =>
          button.classList.toggle("is-active", button.dataset.place === origin),
        );
      const place = data.landmarks.find(
        (point) => point.id === placeIds[origin],
      );
      $("#map-place-info h3").textContent =
        place?.name ?? "Un punto de encuentro.";
      $("#map-place-info p").textContent = placeDescriptions[origin];
    }
    document
      .querySelectorAll("[data-place]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          focusPlace(button.dataset.place),
        ),
      );
    focusPlace("mercado");
  })
  .catch((error) => {
    $("#map-error").hidden = false;
    console.error("Map failed:", error);
  });
$("#use-place").addEventListener("click", () => {
  controls.origin.value = selectedPlace;
  syncRanges(false);
  executeSimulation({ animatePlayback: true });
  $("#simulador").scrollIntoView({
    behavior: reducedMotion.matches ? "instant" : "smooth",
  });
});

$("#download-results").addEventListener("click", () => {
  if (!latestResult) return;
  const exported = {
    project: "NATOSSI",
    model: "SEIR sobre red sintética, sin calibración clínica",
    cartography:
      "© OpenStreetMap contributors — https://www.openstreetmap.org/copyright",
    assumptions: {
      exposedDays: 2,
      infectiousDays: 4,
      map: "Primera réplica. Posiciones ilustrativas, no personas reales.",
      curves: "Promedio de réplicas.",
      range: "Mínimo y máximo observados; no intervalo de confianza.",
      vaccination:
        "Sólo susceptibles. Eficacia y día de respuesta configurables.",
    },
    ...latestResult,
  };
  const blob = new Blob([JSON.stringify(exported, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `natossi-semilla-${latestResult.seed}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("#print-report").addEventListener("click", () => {
  stopPlayback();
  window.print();
});
window.addEventListener("beforeprint", resizeChartLabels);
syncRanges(false);
setDay(0);
executeSimulation();

function syncSceneLive() {
  outbreakMap?.setLive(sceneLive);
  const button = $("#scene-live-toggle");
  button.setAttribute("aria-pressed", String(sceneLive));
  button.setAttribute(
    "aria-label",
    sceneLive
      ? "Pausar movimiento de personajes"
      : "Activar movimiento de personajes",
  );
  button.innerHTML = sceneLive
    ? "Pausar movimiento <span>Ⅱ</span>"
    : "Activar movimiento <span>▷</span>";
  $(".scene-live-badge").classList.toggle("is-paused", !sceneLive);
}
$("#scene-live-toggle").addEventListener("click", () => {
  sceneLive = !sceneLive;
  syncSceneLive();
});
syncSceneLive();
$("#scene-zoom-toggle").addEventListener("click", () => {
  sceneZoom = sceneZoom === 3 ? 1 : sceneZoom + 1;
  outbreakMap?.setZoom(sceneZoom);
  if (!reducedMotion.matches)
    $("#outbreak-map").animate(
      [
        { opacity: 0.4, transform: "scale(1.035)", filter: "blur(3px)" },
        { opacity: 1, transform: "scale(1)", filter: "blur(0px)" },
      ],
      { duration: 700, easing: "cubic-bezier(.16,1,.3,1)" },
    );
  const button = $("#scene-zoom-toggle");
  button.innerHTML = `${sceneZoom === 3 ? "Ver toda la ciudad" : "Acercar al foco"} <span>${sceneZoom === 1 ? "1" : sceneZoom === 2 ? "1,8" : "2,8"}×</span>`;
  button.setAttribute(
    "aria-label",
    sceneZoom === 3
      ? "Volver a la vista completa"
      : "Acercar al foco del brote",
  );
});

const bioStates = [
  [
    "ESTADO 01 / SUSCEPTIBLE",
    "Todavía sano. Puede contagiarse al entrar en contacto con una persona infecciosa. Protegerlo a tiempo puede interrumpir una cadena.",
  ],
  [
    "ESTADO 02 / EXPUESTO",
    "El contagio ya ocurrió, pero todavía no transmite. En el modelo, esta etapa dura dos días antes de convertirse en infeccioso.",
  ],
  [
    "ESTADO 03 / ZOMBIE",
    "La infección está activa. Cada conexión susceptible puede abrir una nueva cadena de contagio. El periodo infeccioso del modelo dura cuatro días.",
  ],
  [
    "ESTADO 04 / INMUNE",
    "Se recuperó o recibió una dosis eficaz. Durante esta simulación ya no se contagia: una conexión protegida puede cambiar todo el recorrido.",
  ],
];
document.querySelectorAll("[data-bio]").forEach((button) =>
  button.addEventListener("click", () => {
    const index = Number(button.dataset.bio);
    document.querySelectorAll("[data-bio]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    $("#bio-state-index").textContent = bioStates[index][0];
    $("#bio-state-description").textContent = bioStates[index][1];
    $(".threat-section").dataset.state = String(index);
    if (!reducedMotion.matches)
      $(".bio-description").animate(
        [
          { opacity: 0.25, transform: "translateY(6px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 450, easing: "cubic-bezier(.22,1,.36,1)" },
      );
  }),
);
