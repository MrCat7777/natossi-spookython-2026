import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Data URL import also works when this buildless project has no package.json.
const source = await readFile(
  new URL("../dist/simulation.js", import.meta.url),
  "utf8",
);
const { runComparison } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("same configuration and seed reproduce every result", () => {
  assert.deepEqual(runComparison(), runComparison());
  assert.notDeepEqual(runComparison({ seed: 45 }), runComparison({ seed: 46 }));
});

test("all people remain accounted for, and cumulative infections never decrease", () => {
  const result = runComparison();
  for (const strategy of ["strategic", "random", "baseline"]) {
    const run = result[strategy];
    let previous = 0;
    for (const point of run.series) {
      assert.ok(
        Math.abs(
          point.susceptible +
            point.exposed +
            point.infected +
            point.recovered -
            result.population,
        ) < 1e-9,
      );
      assert.ok(point.cumulative >= previous);
      assert.ok(point.cumulative <= result.population - run.vaccinesUsed);
      for (const state of ["susceptible", "exposed", "infected", "recovered"])
        assert.ok(point[state] >= 0);
      previous = point.cumulative;
    }
    assert.equal(run.totalInfected, run.series.at(-1).cumulative);
    assert.ok(
      run.range[0] <= run.totalInfected && run.totalInfected <= run.range[1],
    );
  }
});

test("zero doses give identical paired outcomes for all strategies", () => {
  const result = runComparison({ vaccines: 0 });
  assert.deepEqual(result.strategic, result.random);
  assert.deepEqual(result.strategic, result.baseline);
  assert.equal(result.saved, 0);
  assert.equal(result.reduction, 0);
});

test("vaccination excludes the initially infected and exposed people", () => {
  const result = runComparison({ vaccines: 240 });
  for (const strategy of ["strategic", "random"]) {
    assert.equal(result[strategy].vaccinesUsed, 237);
    assert.equal(result[strategy].series[0].infected, 1);
    assert.equal(result[strategy].series[0].exposed, 2);
    assert.equal(result[strategy].series[0].recovered, 237);
    assert.equal(result[strategy].totalInfected, 3);
  }
});

test("zero transmission produces only the three initial cases", () => {
  const result = runComparison({ transmission: 0 });
  for (const strategy of ["strategic", "random", "baseline"]) {
    assert.equal(result[strategy].totalInfected, 3);
    assert.equal(result[strategy].series.at(-1).infected, 0);
    assert.equal(result[strategy].series.at(-1).exposed, 0);
  }
});

test("default degree strategy reduces mean infections against both controls", () => {
  const result = runComparison();
  assert.ok(result.strategic.totalInfected < result.random.totalInfected);
  assert.ok(result.strategic.totalInfected < result.baseline.totalInfected);
  assert.equal(result.strategic.vaccinesUsed, result.random.vaccinesUsed);
  assert.equal(
    result.saved,
    result.baseline.totalInfected - result.strategic.totalInfected,
  );
});

test("origins change the seeded outbreak and invalid numeric inputs are rejected", () => {
  const mercado = runComparison({ origin: "mercado" });
  const escuela = runComparison({ origin: "escuela" });
  assert.notDeepEqual(mercado.strategic.series, escuela.strategic.series);
  for (const options of [
    { population: 0 },
    { vaccines: -1 },
    { transmission: 2 },
    { days: 0 },
    { runs: 0 },
    { seed: -1 },
  ]) {
    assert.throws(() => runComparison(options), RangeError);
  }
});

test("zero vaccine efficacy leaves every transmission trajectory unchanged", () => {
  const result = runComparison({ vaccineEfficacy: 0, responseDay: 3 });
  for (const strategy of ["strategic", "random"]) {
    assert.deepEqual(result[strategy].series, result.baseline.series);
    assert.deepEqual(result.timeline[strategy], result.timeline.baseline);
    assert.equal(result[strategy].vaccinesEffective, 0);
    assert.equal(result[strategy].vaccinesUsed, 40);
  }
  assert.equal(result.saved, 0);
});

test("delayed response starts on the requested day and excludes existing cases", () => {
  const responseDay = 5;
  const result = runComparison({ responseDay, vaccines: 240, runs: 1 });
  for (const comparator of ["strategic", "random"]) {
    assert.deepEqual(
      result.timeline[comparator].slice(0, responseDay),
      result.timeline.baseline.slice(0, responseDay),
    );
    const before = result.timeline.baseline[responseDay - 1];
    const selected = result.interventions[comparator].vaccinations;
    assert.equal(selected.length, before.filter((state) => state === 0).length);
    assert.ok(
      selected.every(
        ({ node, stateBefore }) => before[node] === 0 && stateBefore === 0,
      ),
    );
    assert.ok(
      selected.every(
        ({ node }) => result.timeline[comparator][responseDay][node] === 3,
      ),
    );
  }
  assert.equal(result.strategic.vaccinesUsed, result.random.vaccinesUsed);
});

test("network and first-replicate timelines agree with the SEIR population", () => {
  const result = runComparison({ runs: 1, initialInfected: 6, responseDay: 2 });
  assert.equal(result.network.nodes.length, result.population);
  const degree = Array(result.population).fill(0);
  const edges = new Set();
  for (const [a, b] of result.network.edges) {
    assert.ok(a < b && a >= 0 && b < result.population);
    assert.ok(!edges.has(`${a}-${b}`));
    edges.add(`${a}-${b}`);
    degree[a]++;
    degree[b]++;
  }
  result.network.nodes.forEach((node, id) => {
    assert.equal(node.id, id);
    assert.equal(node.degree, degree[id]);
    assert.ok(node.sector >= 0 && node.sector <= 3);
  });
  for (const comparator of ["strategic", "random", "baseline"]) {
    const timeline = result.timeline[comparator];
    assert.equal(timeline.length, result.days + 1);
    for (const [day, states] of timeline.entries()) {
      assert.equal(states.length, result.population);
      const counts = [0, 0, 0, 0];
      for (const state of states) {
        assert.ok(Number.isInteger(state) && state >= 0 && state <= 3);
        counts[state]++;
      }
      const point = result[comparator].series[day];
      assert.deepEqual(counts, [
        point.susceptible,
        point.exposed,
        point.infected,
        point.recovered,
      ]);
    }
    assert.equal(timeline[0].filter((state) => state === 2).length, 6);
    assert.equal(timeline[0].filter((state) => state === 1).length, 2);
  }
});

test("partial vaccine efficacy and bridge response remain reproducible and budget matched", () => {
  const config = {
    vaccineEfficacy: 0.5,
    initialInfected: 4,
    responseDay: 2,
    strategy: "bridge",
    adaptive: true,
  };
  const first = runComparison(config);
  assert.deepEqual(first, runComparison(config));
  assert.equal(first.strategy, "bridge");
  assert.equal(first.adaptive, true);
  assert.equal(first.strategic.vaccinesUsed, first.random.vaccinesUsed);
  for (const comparator of ["strategic", "random"]) {
    assert.ok(first[comparator].vaccinesEffective > 0);
    assert.ok(
      first[comparator].vaccinesEffective < first[comparator].vaccinesUsed,
    );
    assert.equal(first[comparator].iterationTotals.length, first.runs);
    assert.equal(
      Math.min(...first[comparator].iterationTotals),
      first[comparator].range[0],
    );
    assert.equal(
      Math.max(...first[comparator].iterationTotals),
      first[comparator].range[1],
    );
  }
});

test("surprise outbreak inputs are honored and invalid response controls are rejected", () => {
  const surprise = runComparison({
    initialInfected: 12,
    transmission: 0.56,
    vaccines: 20,
    vaccineEfficacy: 0.5,
    origin: "transporte",
  });
  assert.equal(surprise.baseline.series[0].infected, 12);
  assert.equal(surprise.baseline.series[0].exposed, 2);
  assert.equal(surprise.transmission, 0.56);
  assert.equal(surprise.vaccines, 20);
  assert.equal(surprise.origin, "transporte");
  for (const config of [
    { initialInfected: 0 },
    { initialInfected: 239 },
    { initialInfected: 1.5 },
    { responseDay: -1 },
    { responseDay: 31 },
    { vaccineEfficacy: -0.1 },
    { vaccineEfficacy: 1.1 },
    { vaccineEfficacy: NaN },
    { strategy: "unknown" },
  ])
    assert.throws(() => runComparison(config), RangeError);
  assert.throws(() => runComparison({ adaptive: "yes" }), TypeError);
});
