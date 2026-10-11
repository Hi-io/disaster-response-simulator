import { clone } from './determinism.mjs';

const HOUR = 3600000,
  DAY = 24 * HOUR;
const CAUSES = ['water', 'food', 'exposure', 'injury'];
// These are explicit experimental response curves, not validated clinical predictions.
// A need deadline never kills people. Only elapsed exposure and unmet intake affect risk.
export function installPopulation(w) {
  const newHealth = (c) => ({
    affected: false,
    waterDisrupted: false,
    foodDisrupted: false,
    unsheltered: false,
    injured: 0,
    injurySeverity: 0,
    careCarry: 0,
    exposureIntensity: Math.max(
      0,
      (10 - w.config.temperatureC) / 10,
      (w.config.temperatureC - 35) / 10,
    ),
    waterMl: Math.floor(
      (c.population * w.config.waterMlPerPersonDay * w.config.initialWaterHours) / 24,
    ),
    foodKcal: Math.floor(
      (c.population * w.config.foodKcalPerPersonDay * w.config.initialFoodHours) / 24,
    ),
    dehydrationMs: 0,
    hungerMs: 0,
    exposureMs: 0,
    untreatedMs: 0,
    integratedAt: w.now,
    waterDeficitPersonMs: 0,
    foodDeficitPersonMs: 0,
    exposurePersonMs: 0,
    injuryPersonMs: 0,
    vulnerability: 0.75 + w.random('population', c.id, 'vulnerability') * 0.75,
    fatalityCarry: { water: 0, food: 0, exposure: 0, injury: 0 },
    deathsByCause: { water: 0, food: 0, exposure: 0, injury: 0 },
    receivedWaterMl: 0,
    receivedFoodKcal: 0,
    version: 1,
  });
  const ensure = (c) => {
    c.deceased ??= 0;
    c.health ??= newHealth(c);
    return c.health;
  };
  w.healthForSector = (sector) =>
    w.state.cohorts.filter((c) => c.sector === sector && c.population > 0);
  w.activatePopulationNeed = (n) => {
    const b = w.building(n.building);
    if (!b) return;
    for (const c of w.healthForSector(b.sector)) {
      const h = ensure(c);
      h.affected = true;
      if (n.type === 'water') h.waterDisrupted = true;
      if (n.type === 'food') h.foodDisrupted = true;
      if (n.type === 'shelter') h.unsheltered = true;
    }
  };
  w.damagePopulation = (sector, severity, cause) => {
    for (const c of w.healthForSector(sector)) {
      const h = ensure(c);
      w.advancePopulation(c, w.now);
      h.affected = h.waterDisrupted = h.foodDisrupted = h.unsheltered = true;
      const fraction = ((w.config.injuryFractionBp / 10000) * severity) / 3;
      h.injured = Math.max(h.injured, Math.floor(c.population * fraction));
      h.injurySeverity = Math.max(h.injurySeverity, severity);
      h.version++;
      if (cause === 'fire' || cause === 'wildfire')
        h.exposureIntensity = Math.max(h.exposureIntensity, severity / 2);
      w.record(
        'community_affected',
        { sector, injured: h.injured, cause, model: 'experimental-v1' },
        c.id,
      );
    }
  };
  w.receivePopulationAid = (need, quantity) => {
    const sector = w.building(need.building)?.sector,
      communities = w.healthForSector(sector),
      total = communities.reduce((n, c) => n + c.population, 0);
    let remaining = quantity;
    for (const [i, c] of communities.entries()) {
      w.advancePopulation(c, w.now);
      const h = ensure(c),
        amount = i === communities.length - 1 ? remaining : (quantity * c.population) / total;
      remaining -= amount;
      if (need.type === 'water') {
        h.waterMl += amount * 1000;
        h.receivedWaterMl += amount * 1000;
      }
      if (need.type === 'food') {
        h.foodKcal += amount * 700;
        h.receivedFoodKcal += amount * 700;
      }
      if (need.type === 'blankets') h.unsheltered = amount < c.population;
      if (need.type === 'rescue') h.injured = Math.max(0, h.injured - Math.floor(amount));
      h.version++;
    }
  };
  w.advancePopulation = (c, at) => {
    const h = ensure(c),
      elapsed = at - h.integratedAt;
    if (elapsed <= 0) return;
    h.integratedAt = at;
    if (!h.affected || !c.population) return;
    const old = {
      water: h.dehydrationMs,
      food: h.hungerMs,
      exposure: h.exposureMs,
      injury: h.untreatedMs,
    };
    const intake = (stock, rate, disrupted, field) => {
      if (!disrupted) {
        h[field] = 0;
        return 0;
      }
      const need = (c.population * rate * elapsed) / DAY,
        supplied = Math.min(h[stock], need),
        missing = need ? 1 - supplied / need : 0;
      h[stock] = Math.max(0, h[stock] - supplied);
      if (missing === 0) h[field] = Math.max(0, h[field] - elapsed * 2);
      else h[field] += elapsed * missing;
      return elapsed * missing;
    };
    const waterMs = intake(
      'waterMl',
      w.config.waterMlPerPersonDay,
      h.waterDisrupted,
      'dehydrationMs',
    );
    const foodMs = intake('foodKcal', w.config.foodKcalPerPersonDay, h.foodDisrupted, 'hungerMs');
    const shelter = w.state.map.buildings.find(
      (b) => b.node === c.node && b.state === 'operating' && b.use === 'shelter',
    );
    const exposureMs = h.unsheltered && !shelter ? elapsed : 0;
    h.exposureMs = exposureMs ? h.exposureMs + exposureMs : Math.max(0, h.exposureMs - elapsed);
    const care = w.state.resources
      .filter((r) => r.node === c.node && r.type === 'staff' && r.quantity - r.reserved > 0)
      .reduce((n, r) => n + r.quantity - r.reserved, 0);
    if (care && h.injured) {
      const budget = (care * 4 * elapsed) / HOUR + h.careCarry,
        treated = Math.min(h.injured, Math.floor(budget));
      h.careCarry = budget - treated;
      h.injured -= treated;
      if (treated) w.record('care_provided', { treated, sector: c.sector }, c.id);
    }
    h.untreatedMs = h.injured ? h.untreatedMs + elapsed : 0;
    h.waterDeficitPersonMs += c.population * waterMs;
    h.foodDeficitPersonMs += c.population * foodMs;
    h.exposurePersonMs += c.population * exposureMs;
    h.injuryPersonMs += h.injured * elapsed;
    let lost = 0;
    for (const cause of CAUSES) {
      const value = {
        water: h.dehydrationMs,
        food: h.hungerMs,
        exposure: h.exposureMs,
        injury: h.untreatedMs,
      }[cause];
      const critical = w.config[`${cause}CriticalHours`] * HOUR;
      const riskMs = Math.max(0, value - critical) - Math.max(0, old[cause] - critical);
      if (riskMs <= 0) continue;
      const exposed = cause === 'injury' ? Math.min(h.injured, c.population) : c.population;
      const probability =
        1 -
        Math.exp(
          (((-w.config[`${cause}FatalityBpPerHour`] / 10000) * riskMs) / HOUR) *
            h.vulnerability *
            (cause === 'exposure' ? h.exposureIntensity : 1),
        );
      const expected = exposed * probability + h.fatalityCarry[cause],
        deaths = Math.min(exposed, Math.floor(expected + 1e-10));
      h.fatalityCarry[cause] = expected - deaths;
      if (deaths) {
        c.population -= deaths;
        c.deceased += deaths;
        lost += deaths;
        h.deathsByCause[cause] += deaths;
        h.injured = Math.min(
          c.population,
          Math.max(0, h.injured - (cause === 'injury' ? deaths : 0)),
        );
        w.record(
          'simulated_fatalities',
          { cause, deaths, sector: c.sector, model: 'experimental-v1' },
          c.id,
        );
      }
    }
    h.version++;
    if (lost)
      w.record(
        'population_changed',
        { alive: c.population, deceased: c.deceased, sector: c.sector },
        c.id,
      );
  };
  w.takePopulationGroup = (c, quantity) => {
    w.advancePopulation(c, w.now);
    const h = ensure(c),
      ratio = quantity / c.population,
      group = clone(h);
    for (const field of [
      'waterMl',
      'foodKcal',
      'receivedWaterMl',
      'receivedFoodKcal',
      'waterDeficitPersonMs',
      'foodDeficitPersonMs',
      'exposurePersonMs',
      'injuryPersonMs',
      'careCarry',
    ]) {
      group[field] = h[field] * ratio;
      h[field] -= group[field];
    }
    group.injured = Math.floor(h.injured * ratio);
    h.injured -= group.injured;
    group.deathsByCause = Object.fromEntries(CAUSES.map((k) => [k, 0]));
    group.fatalityCarry = Object.fromEntries(CAUSES.map((k) => [k, 0]));
    group.unsheltered = false;
    group.integratedAt = w.now;
    return group;
  };
  w.populationSnapshot = (sector) => ({
    sector,
    observedAt: w.now,
    model: 'experimental-v1',
    communities: w.state.cohorts
      .filter((c) => c.sector === sector)
      .map((c) => ({
        id: c.id,
        alive: c.population,
        deceased: c.deceased,
        injured: c.health?.injured ?? 0,
        dehydrationHours: (c.health?.dehydrationMs ?? 0) / HOUR,
        hungerHours: (c.health?.hungerMs ?? 0) / HOUR,
        exposureHours: (c.health?.exposureMs ?? 0) / HOUR,
        waterRemainingL: (c.health?.waterMl ?? 0) / 1000,
        version: c.health?.version ?? 1,
      })),
  });
  w.initializePopulation = () => {
    for (const c of w.state.cohorts) ensure(c);
    for (const n of w.state.needs) w.activatePopulationNeed(n);
    w.schedule(w.now + w.config.healthTickMs, 'population_tick', {}, 0, 'population-initial');
    if (w.config.recurringNeeds)
      w.schedule(
        w.now + w.config.resupplyReviewHours * HOUR,
        'population_resupply',
        {},
        1,
        'resupply-initial',
      );
  };
  w.on('population_resupply', () => {
    for (const sector of w.state.map.sectors) {
      const cohorts = w.healthForSector(sector.id).filter((c) => c.health?.affected);
      if (!cohorts.length) continue;
      const population = cohorts.reduce((n, c) => n + c.population, 0);
      const building = w.state.map.buildings.find((b) => b.sector === sector.id);
      for (const type of ['water', 'food']) {
        if (!cohorts.some((c) => c.health[`${type}Disrupted`])) continue;
        if (
          w.state.needs.some(
            (n) =>
              w.building(n.building)?.sector === sector.id &&
              n.type === type &&
              n.served < n.quantity,
          )
        )
          continue;
        const stock = cohorts.reduce(
          (n, c) => n + c.health[type === 'water' ? 'waterMl' : 'foodKcal'],
          0,
        );
        const rate =
          type === 'water' ? w.config.waterMlPerPersonDay : w.config.foodKcalPerPersonDay;
        // A fresh request is generated only if supplies cannot last to the next review.
        if (stock > (population * rate * w.config.resupplyReviewHours) / 24) continue;
        const target = (population * rate * w.config.resupplyHorizonHours) / 24;
        const n = w.addNeed({
          id: w.nextId(`recurring-${type}`),
          building: building.id,
          type,
          quantity: Math.max(1, Math.ceil((target - stock) / (type === 'water' ? 1000 : 700))),
          unit: type === 'water' ? 'L' : 'portion',
          population,
          recurring: true,
          priority: type === 'water' ? 7 : 5,
          deadline: w.now + w.config.resupplyReviewHours * HOUR,
          silent:
            w.random('population', sector.id, `resupply-report-${type}-${w.now}`) >=
            w.config.observationRate,
        });
        if (!n.silent)
          w.generateSignal('P01', {
            sector: sector.id,
            building: building.id,
            need: n.id,
            text: `${w.sector(sector.id).name}: ${population} people need another ${n.quantity} ${n.unit} of ${type}. Earlier supplies are being used up. Please verify.`,
            causeEvent: n.id,
          });
      }
    }
    const next = w.now + w.config.resupplyReviewHours * HOUR;
    if (next <= w.config.durationMs)
      w.schedule(next, 'population_resupply', {}, 1, `resupply-${next}`);
  });
  w.on('population_tick', () => {
    for (const c of w.state.cohorts) {
      w.advancePopulation(c, w.now);
      if (c.health?.affected)
        w.record(
          'community_health',
          {
            sector: c.sector,
            alive: c.population,
            deceased: c.deceased,
            injured: c.health.injured,
            dehydrationHours: c.health.dehydrationMs / HOUR,
            hungerHours: c.health.hungerMs / HOUR,
            exposureHours: c.health.exposureMs / HOUR,
          },
          c.id,
        );
      if (
        c.health?.affected &&
        w.config.healthReports &&
        w.now % (6 * HOUR) === 0 &&
        c.population &&
        w.random('population', c.id, `health-report-${w.now}`) < c.reportProbability
      ) {
        w.generateSignal('P01', {
          sector: c.sector,
          building: w.state.map.buildings.find((b) => b.sector === c.sector)?.id,
          text: `Update from ${w.sector(c.sector).name}: ${c.population} people remain here. ${c.health.injured ? 'Injured people need care. ' : ''}${c.health.dehydrationMs ? 'Water is running out. ' : ''}${c.health.hungerMs ? 'Food is running out. ' : ''}Please verify access and supplies.`,
          causeEvent: `health-${c.id}-${w.now}`,
        });
      }
    }
    for (const t of w.state.evacuations ?? [])
      if (t.health && !['completed', 'failed', 'cancelled'].includes(t.state)) {
        const v = w.vehicle(t.vehicle),
          origin = w.state.cohorts.find((c) => c.id === t.cohort);
        if (!origin) continue;
        const group = {
          id: `transit-${t.id}`,
          sector: origin.sector,
          node: v.node,
          population: v.passengers,
          deceased: 0,
          health: t.health,
        };
        w.advancePopulation(group, w.now);
        const lost = v.passengers - group.population;
        if (lost) {
          v.passengers = group.population;
          origin.inTransit -= lost;
          origin.deceased += lost;
          t.transportDeaths = (t.transportDeaths ?? 0) + lost;
          for (const cause of CAUSES) {
            origin.health.deathsByCause[cause] += t.health.deathsByCause[cause];
            t.health.deathsByCause[cause] = 0;
          }
        }
      }
    if (w.now + w.config.healthTickMs <= w.config.durationMs)
      w.schedule(w.now + w.config.healthTickMs, 'population_tick', {}, 0, `population-${w.now}`);
  });
  w.populationMetrics = () => {
    const rows = w.state.cohorts.map((c) => ({
      id: c.id,
      sector: c.sector,
      population: c.population,
      inTransit: c.inTransit,
      deceased: c.deceased ?? 0,
      affected: !!c.health?.affected,
      injured: c.health?.injured ?? 0,
      dehydrationHours: (c.health?.dehydrationMs ?? 0) / HOUR,
      hungerHours: (c.health?.hungerMs ?? 0) / HOUR,
      exposureHours: (c.health?.exposureMs ?? 0) / HOUR,
      waterDeficitPersonHours: (c.health?.waterDeficitPersonMs ?? 0) / HOUR,
      foodDeficitPersonHours: (c.health?.foodDeficitPersonMs ?? 0) / HOUR,
      exposurePersonHours: (c.health?.exposurePersonMs ?? 0) / HOUR,
      untreatedInjuryPersonHours: (c.health?.injuryPersonMs ?? 0) / HOUR,
      deathsByCause: clone(c.health?.deathsByCause ?? {}),
    }));
    for (const t of w.state.evacuations ?? []) {
      if (!t.health || ['completed', 'failed', 'cancelled'].includes(t.state)) continue;
      const row = rows.find((r) => r.id === t.cohort);
      if (!row) continue;
      row.injured += t.health.injured;
      row.waterDeficitPersonHours += t.health.waterDeficitPersonMs / HOUR;
      row.foodDeficitPersonHours += t.health.foodDeficitPersonMs / HOUR;
      row.exposurePersonHours += t.health.exposurePersonMs / HOUR;
      row.untreatedInjuryPersonHours += t.health.injuryPersonMs / HOUR;
    }
    return {
      model: 'experimental-v1',
      clinicallyValidated: false,
      alive: rows.reduce((s, c) => s + c.population + c.inTransit, 0),
      deceased: rows.reduce((s, c) => s + c.deceased, 0),
      injured: rows.reduce((s, c) => s + c.injured, 0),
      waterDeficitPersonHours: rows.reduce((s, c) => s + c.waterDeficitPersonHours, 0),
      foodDeficitPersonHours: rows.reduce((s, c) => s + c.foodDeficitPersonHours, 0),
      exposurePersonHours: rows.reduce((s, c) => s + c.exposurePersonHours, 0),
      untreatedInjuryPersonHours: rows.reduce((s, c) => s + c.untreatedInjuryPersonHours, 0),
      communities: rows,
    };
  };
}
