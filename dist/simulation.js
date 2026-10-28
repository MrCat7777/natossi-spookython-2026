/**
 * UMBRA — illustrative, synthetic SEIR experiment. No real Manta data.
 *
 * A person has household contacts (groups of five), one of four social hubs,
 * and occasional contacts between groups. The four hub people are connected.
 * The selected origin determines which hub is patient zero. Two of that
 * hub's ordinary contacts begin exposed. This is a deliberately simple
 * stress test for protecting highly connected susceptible people.
 *
 * Each infectious neighbour contributes `transmission` probability per day;
 * independent exposures combine as 1 - (1 - transmission)^neighbours.
 * Exposure lasts two days; infectiousness lasts four. Recovery and the
 * preventive intervention provide complete immunity for the 30-day default
 * horizon. Vaccination occurs once, before day one, and never targets an
 * already exposed, infectious, or immune person. Vaccine effect is immediate.
 * These are explanatory assumptions, not calibrated medical parameters.
 *
 * All three strategies share each run's graph, initial states, and keyed
 * node/day random draws. No intervention uses zero doses; random and degree
 * strategies have the same dose budget. Replicates use different seeded
 * graphs. `range` is the observed minimum/maximum, not a confidence interval.
 */

const ORIGINS = { mercado: 0, escuela: 1, transporte: 2 };

function randomAt(seed, a = 0, b = 0) {
  let value = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca77)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function integer(value, fallback, min, max, name) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return result;
}

function buildGraph(population, seed) {
  const graph = Array.from({ length: population }, () => new Set());
  const connect = (a, b) => {
    if (a === b) return;
    graph[a].add(b);
    graph[b].add(a);
  };
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) connect(a, b);
  }
  for (let i = 4; i < population; i++) {
    const homeStart = 4 + Math.floor((i - 4) / 5) * 5;
    for (let j = homeStart; j < Math.min(homeStart + 5, population); j++) connect(i, j);
    const sector = Math.floor((i - 4) / 5) % 4;
    connect(i, sector);
    // A minority of residents bridge two social groups.
    if (randomAt(seed, i, 3) < 0.1) {
      connect(i, 4 + Math.floor(randomAt(seed, i, 4) * (population - 4)));
    }
  }
  return graph.map(contacts => [...contacts]);
}

function initialStates(graph, origin) {
  const states = new Uint8Array(graph.length);
  const patientZero = ORIGINS[origin];
  states[patientZero] = 2;
  const exposed = graph[patientZero].filter(node => node >= 4).slice(0, 2);
  for (const node of exposed) states[node] = 1;
  return states;
}

function simulate(graph, initial, config, strategy, seed) {
  const { population, days, transmission, vaccines } = config;
  const states = initial.slice();
  const age = new Uint8Array(population);
  const susceptible = [...states.keys()].filter(node => states[node] === 0);
  if (strategy === 'strategic') {
    susceptible.sort((a, b) => graph[b].length - graph[a].length || a - b);
  } else if (strategy === 'random') {
    susceptible.sort((a, b) => randomAt(seed, a, 991) - randomAt(seed, b, 991) || a - b);
  }
  const vaccinesUsed = strategy === 'baseline' ? 0 : Math.min(vaccines, susceptible.length);
  for (let i = 0; i < vaccinesUsed; i++) states[susceptible[i]] = 3;
  let cumulative = states.reduce((sum, state) => sum + Number(state === 1 || state === 2), 0);
  const series = [];
  const snapshot = day => {
    const counts = [0, 0, 0, 0];
    for (const state of states) counts[state]++;
    series.push({ day, susceptible: counts[0], exposed: counts[1], infected: counts[2], recovered: counts[3], cumulative });
  };
  snapshot(0);
  for (let day = 1; day <= days; day++) {
    const next = states.slice();
    for (let person = 0; person < population; person++) {
      if (states[person] === 0) {
        let infectious = 0;
        for (const neighbour of graph[person]) infectious += Number(states[neighbour] === 2);
        const probability = 1 - (1 - transmission) ** infectious;
        if (randomAt(seed, person, day) < probability) {
          next[person] = 1;
          age[person] = 0;
          cumulative++;
        }
      } else if (states[person] === 1 || states[person] === 2) {
        age[person]++;
        if (age[person] >= (states[person] === 1 ? 2 : 4)) {
          next[person]++;
          age[person] = 0;
        }
      }
    }
    states.set(next);
    snapshot(day);
  }
  return { series, totalInfected: cumulative, peak: Math.max(...series.map(point => point.infected)), vaccinesUsed };
}

function aggregate(results) {
  const count = results.length;
  const series = results[0].series.map(({ day }, index) => {
    const point = { day };
    for (const state of ['susceptible', 'exposed', 'infected', 'recovered', 'cumulative']) {
      point[state] = results.reduce((sum, result) => sum + result.series[index][state], 0) / count;
    }
    return point;
  });
  const totals = results.map(result => result.totalInfected);
  return {
    series,
    totalInfected: totals.reduce((sum, value) => sum + value, 0) / count,
    peak: results.reduce((sum, result) => sum + result.peak, 0) / count,
    range: [Math.min(...totals), Math.max(...totals)],
    vaccinesUsed: results[0].vaccinesUsed,
  };
}

/**
 * Return three paired, reproducible Monte Carlo comparisons.
 * `saved` is baseline minus strategic mean cumulative infections.
 * `reduction` is that difference as a percentage of the baseline mean.
 * `recovered` includes vaccinated people; `cumulative` never does.
 */
export function runComparison(options = {}) {
  const population = integer(options.population, 240, 20, 2000, 'population');
  const days = integer(options.days, 30, 1, 120, 'days');
  const vaccines = integer(options.vaccines, 40, 0, population, 'vaccines');
  const runs = integer(options.runs, 12, 1, 80, 'runs');
  const seed = integer(options.seed, 2026, 0, 4294967295, 'seed');
  const transmission = options.transmission === undefined ? 0.28 : Number(options.transmission);
  if (!Number.isFinite(transmission) || transmission < 0 || transmission > 1) {
    throw new RangeError('transmission must be between 0 and 1.');
  }
  const origin = Object.hasOwn(ORIGINS, options.origin) ? options.origin : 'mercado';
  const config = { population, days, transmission, vaccines };
  const results = { strategic: [], random: [], baseline: [] };
  for (let run = 0; run < runs; run++) {
    const runSeed = (seed + Math.imul(run + 1, 0x9e3779b1)) >>> 0;
    const graph = buildGraph(population, runSeed);
    const initial = initialStates(graph, origin);
    for (const strategy of Object.keys(results)) {
      results[strategy].push(simulate(graph, initial, config, strategy, runSeed));
    }
  }
  const strategic = aggregate(results.strategic);
  const random = aggregate(results.random);
  const baseline = aggregate(results.baseline);
  const saved = baseline.totalInfected - strategic.totalInfected;
  return {
    strategic, random, baseline, saved,
    reduction: baseline.totalInfected ? saved / baseline.totalInfected * 100 : 0,
    population, days, runs, seed, origin, transmission, vaccines,
  };
}
