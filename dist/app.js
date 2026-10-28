import { runComparison } from './simulation.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#simulation-form');
const controls = {
  origin: $('#origin'),
  transmission: $('#transmission'),
  vaccines: $('#vaccines'),
  seed: $('#seed'),
};
const formatter = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 1 });
let latestResult = null;
let running = false;

// All essential content remains visible when JavaScript is unavailable.
document.documentElement.classList.add('js');
if ('IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -18px 0px' });
  document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

  const navigationObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      document.querySelectorAll('.desktop-nav a').forEach((link) => {
        const active = link.hash === `#${entry.target.id}`;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }
  }, { rootMargin: '-15% 0px -65% 0px', threshold: 0 });
  ['mision', 'modelo', 'simulador'].forEach((id) => navigationObserver.observe(document.getElementById(id)));
} else {
  document.querySelectorAll('.reveal').forEach((element) => element.classList.add('is-visible'));
}

const menuButton = $('.menu-toggle');
const mobileNavigation = $('#mobile-nav');
function closeMenu() {
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Abrir menú');
  mobileNavigation.hidden = true;
}
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  mobileNavigation.hidden = !open;
});
mobileNavigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !mobileNavigation.hidden) {
    closeMenu();
    menuButton.focus();
  }
});
window.matchMedia('(min-width: 701px)').addEventListener('change', (event) => { if (event.matches) closeMenu(); });

function setStatus(message, pending = false) {
  const status = $('#result-status');
  status.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  status.append(dot, document.createTextNode(message));
  status.classList.toggle('is-pending', pending);
}

function syncRanges(markPending = true) {
  for (const name of ['transmission', 'vaccines']) {
    const input = controls[name];
    const percent = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100;
    input.style.setProperty('--value', `${percent}%`);
    const output = $(`#${name}-value`);
    output.textContent = input.value;
    input.setAttribute('aria-valuetext', name === 'transmission' ? `${input.value} por ciento por contacto y día` : `${input.value} dosis`);
    if (name === 'transmission') {
      const unit = document.createElement('span');
      unit.textContent = '%';
      output.append(unit);
    }
  }
  if (markPending && latestResult) setStatus('Cambios sin ejecutar', true);
}

function drawChart(result) {
  const chart = $('#simulation-chart');
  const width = 740;
  const height = 290;
  const margin = { left: 35, right: 20, top: 14, bottom: 30 };
  const x = (day) => margin.left + day / result.days * (width - margin.left - margin.right);
  const y = (count) => height - margin.bottom - count / result.population * (height - margin.top - margin.bottom);
  const path = (series) => series.map((point, index) => `${index ? 'L' : 'M'}${x(point.day).toFixed(2)},${y(point.cumulative).toFixed(2)}`).join(' ');
  const ticks = [0, 60, 120, 180, 240];
  const grid = ticks.map((value) => `<line class="chart-grid" x1="${margin.left}" y1="${y(value)}" x2="${width - margin.right}" y2="${y(value)}"/><text class="chart-tick" x="23" y="${y(value) + 3}" text-anchor="end">${value}</text>`).join('');
  const xTicks = [0, 5, 10, 15, 20, 25, 30].map((day) => `<text class="chart-tick" x="${x(day)}" y="${height - 8}" text-anchor="middle">${day}</text>`).join('');
  const strategicPath = path(result.strategic.series);
  const area = `${strategicPath} L${x(result.days)},${y(0)} L${x(0)},${y(0)} Z`;
  const seriesMarkup = ['baseline', 'random', 'strategic'].map((strategy) => {
    const last = result[strategy].series.at(-1);
    const color = { baseline: '#a497a5', random: '#a18bd1', strategic: '#ff7518' }[strategy];
    return `<path class="chart-path ${strategy}" d="${path(result[strategy].series)}"/><circle cx="${x(result.days)}" cy="${y(last.cumulative)}" r="3" fill="${color}" stroke="#101013" stroke-width="2"/>`;
  }).join('');
  chart.innerHTML = `<title id="chart-title">Comparación de contagios acumulados durante ${result.days} días</title><desc id="chart-description">Promedios de ${result.runs} réplicas: ${formatter.format(result.strategic.totalInfected)} contagios con estrategia, ${formatter.format(result.random.totalInfected)} al azar y ${formatter.format(result.baseline.totalInfected)} sin intervención.</desc><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#ff7518" stop-opacity=".12"/><stop offset="100%" stop-color="#ff7518" stop-opacity=".005"/></linearGradient></defs>${grid}${xTicks}<path d="${area}" fill="url(#chart-fill)" stroke="none"/>${seriesMarkup}`;
}

async function executeSimulation() {
  if (running || !form.reportValidity()) return;
  running = true;
  const results = $('#results');
  const runButton = $('#run-button');
  const downloadButton = $('#download-results');
  results.setAttribute('aria-busy', 'true');
  results.classList.add('is-loading');
  runButton.disabled = true;
  downloadButton.disabled = true;
  runButton.querySelector('span').textContent = 'Simulando…';
  setStatus('Calculando');
  try {
    // Yield one frame so the busy state can be painted before computation.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const result = runComparison({
      origin: controls.origin.value,
      transmission: Number(controls.transmission.value) / 100,
      vaccines: Number(controls.vaccines.value),
      seed: Number(controls.seed.value),
    });
    latestResult = result;
    drawChart(result);
    $('#saved-value').textContent = formatter.format(result.saved);
    $('#reduction-value').textContent = `${formatter.format(result.reduction)}%`;
    $('#range-value').textContent = `${result.strategic.range[0]}–${result.strategic.range[1]}`;
    setStatus('Simulación completa');
    $('#simulation-announcement').textContent = `Simulación completada con semilla ${result.seed}. ${formatter.format(result.saved)} contagios evitados frente a no intervenir; ${formatter.format(result.reduction)} por ciento de reducción. Promedio de ${result.runs} réplicas.`;
    downloadButton.disabled = false;
  } catch (error) {
    setStatus('Revisa la configuración', true);
    $('#simulation-announcement').textContent = 'No se pudo ejecutar la simulación. Revisa los parámetros e inténtalo de nuevo.';
    console.error('Simulation failed:', error);
  } finally {
    results.setAttribute('aria-busy', 'false');
    results.classList.remove('is-loading');
    runButton.disabled = false;
    runButton.querySelector('span').textContent = 'Ejecutar simulación';
    running = false;
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); executeSimulation(); });
form.addEventListener('input', () => syncRanges());
form.addEventListener('change', () => syncRanges());
$('#shuffle-seed').addEventListener('click', () => {
  const seed = new Uint32Array(1);
  crypto.getRandomValues(seed);
  controls.seed.value = seed[0] % 1000000000;
  syncRanges();
});
$('#reset-button').addEventListener('click', () => {
  form.reset();
  syncRanges(false);
  executeSimulation();
});
$('#download-results').addEventListener('click', () => {
  if (!latestResult) return;
  const exportData = {
    project: 'UMBRA',
    model: 'SEIR sobre red sintética; no calibrado con datos reales',
    assumptions: {
      exposedDays: 2,
      infectiousDays: 4,
      vaccineEfficacy: 1,
      vaccinationTiming: 'antes del día 1, sólo personas susceptibles',
      strategy: 'grado descendente en el grafo de contactos',
      range: 'mínimo y máximo observados, no intervalo de confianza',
      saved: 'diferencia de contagios acumulados medios frente a no intervenir',
    },
    ...latestResult,
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `umbra-semilla-${latestResult.seed}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// Decorative schematic: the plotted nodes are not geographic Manta data.
function drawContactNetwork() {
  const svg = $('#contact-network');
  let seed = 31;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const clusters = [
    { x: 230, y: 115, color: '#a18bd1', count: 24 },
    { x: 520, y: 160, color: '#ff7518', count: 27 },
    { x: 185, y: 285, color: '#a4b0c5', count: 22 },
    { x: 480, y: 300, color: '#a18bd1', count: 23 },
  ];
  const nodes = [];
  clusters.forEach((cluster, index) => {
    for (let i = 0; i < cluster.count; i++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random());
      nodes.push({ x: cluster.x + Math.cos(angle) * radius * 112, y: cluster.y + Math.sin(angle) * radius * 67, group: index, size: 1.5 + random() * 1.8, color: cluster.color });
    }
  });
  let edges = '';
  nodes.forEach((node, index) => {
    const neighbors = nodes.map((other, target) => ({ other, target, distance: Math.hypot(node.x - other.x, node.y - other.y) })).filter(({ target, distance }) => target > index && distance < 65).sort((a, b) => a.distance - b.distance).slice(0, 3);
    neighbors.forEach(({ other }) => { edges += `<line x1="${node.x.toFixed(1)}" y1="${node.y.toFixed(1)}" x2="${other.x.toFixed(1)}" y2="${other.y.toFixed(1)}" stroke="${node.color}" stroke-width=".65" opacity=".22"/>`; });
    if (index % 7 === 0) {
      const other = nodes[(index + 27) % nodes.length];
      edges += `<path d="M${node.x.toFixed(1)} ${node.y.toFixed(1)} Q360 195 ${other.x.toFixed(1)} ${other.y.toFixed(1)}" stroke="#a18bd1" stroke-width=".55" opacity=".13" fill="none"/>`;
    }
  });
  const dots = nodes.map((node, index) => {
    const glow = index % 11 === 0;
    return `${glow ? `<circle cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="10" fill="${node.color}" opacity=".07" stroke="none"/><circle class="network-pulse" style="animation-delay:-${index % 4}s" cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="7" fill="none" stroke="${node.color}" stroke-width=".5"/>` : ''}<circle cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="${node.size.toFixed(1)}" fill="${node.color}" stroke="none" opacity="${glow ? '.95' : '.55'}"/>`;
  }).join('');
  svg.innerHTML = `<defs><radialGradient id="net-glow"><stop stop-color="#ff7518" stop-opacity=".07"/><stop offset="1" stop-color="#ff7518" stop-opacity="0"/></radialGradient><pattern id="net-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#a18bd1" opacity=".12" stroke="none"/></pattern></defs><rect width="720" height="410" fill="url(#net-grid)" stroke="none"/><ellipse cx="520" cy="160" rx="175" ry="140" fill="url(#net-glow)" stroke="none"/>${edges}${dots}`;
}

drawContactNetwork();
syncRanges(false);
executeSimulation();
