import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Data URL import also works when this buildless project has no package.json.
const source = await readFile(new URL('../dist/simulation.js', import.meta.url), 'utf8');
const { runComparison } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('same configuration and seed reproduce every result', () => {
  assert.deepEqual(runComparison(), runComparison());
  assert.notDeepEqual(runComparison({ seed: 45 }), runComparison({ seed: 46 }));
});

test('all people remain accounted for, and cumulative infections never decrease', () => {
  const result = runComparison();
  for (const strategy of ['strategic', 'random', 'baseline']) {
    const run = result[strategy];
    let previous = 0;
    for (const point of run.series) {
      assert.ok(Math.abs(point.susceptible + point.exposed + point.infected + point.recovered - result.population) < 1e-9);
      assert.ok(point.cumulative >= previous);
      assert.ok(point.cumulative <= result.population - run.vaccinesUsed);
      for (const state of ['susceptible', 'exposed', 'infected', 'recovered']) assert.ok(point[state] >= 0);
      previous = point.cumulative;
    }
    assert.equal(run.totalInfected, run.series.at(-1).cumulative);
    assert.ok(run.range[0] <= run.totalInfected && run.totalInfected <= run.range[1]);
  }
});

test('zero doses give identical paired outcomes for all strategies', () => {
  const result = runComparison({ vaccines: 0 });
  assert.deepEqual(result.strategic, result.random);
  assert.deepEqual(result.strategic, result.baseline);
  assert.equal(result.saved, 0);
  assert.equal(result.reduction, 0);
});

test('vaccination excludes the initially infected and exposed people', () => {
  const result = runComparison({ vaccines: 240 });
  for (const strategy of ['strategic', 'random']) {
    assert.equal(result[strategy].vaccinesUsed, 237);
    assert.equal(result[strategy].series[0].infected, 1);
    assert.equal(result[strategy].series[0].exposed, 2);
    assert.equal(result[strategy].series[0].recovered, 237);
    assert.equal(result[strategy].totalInfected, 3);
  }
});

test('zero transmission produces only the three initial cases', () => {
  const result = runComparison({ transmission: 0 });
  for (const strategy of ['strategic', 'random', 'baseline']) {
    assert.equal(result[strategy].totalInfected, 3);
    assert.equal(result[strategy].series.at(-1).infected, 0);
    assert.equal(result[strategy].series.at(-1).exposed, 0);
  }
});

test('default degree strategy reduces mean infections against both controls', () => {
  const result = runComparison();
  assert.ok(result.strategic.totalInfected < result.random.totalInfected);
  assert.ok(result.strategic.totalInfected < result.baseline.totalInfected);
  assert.equal(result.strategic.vaccinesUsed, result.random.vaccinesUsed);
  assert.equal(result.saved, result.baseline.totalInfected - result.strategic.totalInfected);
});

test('origins change the seeded outbreak and invalid numeric inputs are rejected', () => {
  const mercado = runComparison({ origin: 'mercado' });
  const escuela = runComparison({ origin: 'escuela' });
  assert.notDeepEqual(mercado.strategic.series, escuela.strategic.series);
  for (const options of [{ population: 0 }, { vaccines: -1 }, { transmission: 2 }, { days: 0 }, { runs: 0 }, { seed: -1 }]) {
    assert.throws(() => runComparison(options), RangeError);
  }
});
