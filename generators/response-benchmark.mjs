import { clone, digest } from '../engine/determinism.mjs';

/** An evaluator-installed information-gap cohort, never a candidate controller.
 * Physical demand precedes both public reports and the delayed formal channel.
 * Every arm gets the same public bytes, source availability and field tools.
 * Returned gold and state.responseBenchmark are observer-only; actorView and
 * publicFeed do not expose them. Delays are experimental parameters, not an
 * empirically validated estimate of humanitarian reporting or human reading.
 */
const DEFAULTS = {
  count: 12,
  noise: 48,
  reposts: 2,
  formalDelayMs: 1800000,
  silentFraction: 0,
  reportAt: 15000,
  staggerMs: 2000,
  explicitFraction: 1 / 3,
  replaceDefaultNeed: true,
};

function configuration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Benchmark options must be an object');
  for (const key of Object.keys(input))
    if (!(key in DEFAULTS)) throw Error('Unknown response benchmark option: ' + key);
  const c = { ...DEFAULTS, ...input };
  for (const [key, min, max] of [
    ['count', 1, 2000],
    ['noise', 0, 20000],
    ['reposts', 0, 20],
    ['formalDelayMs', 0, 604800000],
    ['reportAt', 0, 604800000],
    ['staggerMs', 0, 3600000],
  ])
    if (!Number.isSafeInteger(c[key]) || c[key] < min || c[key] > max)
      throw Error('Invalid response benchmark option: ' + key);
  for (const key of ['silentFraction', 'explicitFraction'])
    if (!Number.isFinite(c[key]) || c[key] < 0 || c[key] > 1)
      throw Error('Invalid response benchmark fraction: ' + key);
  if (typeof c.replaceDefaultNeed !== 'boolean') throw Error('replaceDefaultNeed must be boolean');
  return c;
}

function currentText(row) {
  if (row.style === 'explicit')
    return `CURRENT REQUEST at ${row.building}: ${row.quantity} ${row.unit} of ${row.type} are still needed. Please coordinate with a response team.`;
  if (row.type === 'water') {
    const remaining = row.quantity / 10,
      arrived = 2;
    return `${row.building} | We asked for ${remaining + arrived} ten-litre water containers. ${arrived} ten-litre containers are already here; the others have not arrived. Families remain on site. We need the missing containers, not another copy of the original request.`;
  }
  if (row.type === 'food')
    return `${row.building} | There are ${row.quantity + 15} people waiting for lunch and only 15 meal portions left. That is not enough to feed everyone. The group has not been evacuated. Can a response team cover the shortfall?`;
  return `${row.building} | ${row.quantity + 12} people will sleep here tonight. We have twelve blankets, one per person. The remaining people have nothing to cover them. Please help with the shortfall; the old video about an empty shelter is from a different incident.`;
}

function installHandlers(w) {
  const previousReport = w.handlers.get('initial_report');
  if (!w.handlers.has('response_benchmark_report_guard')) {
    // Leave the ordinary scheduled event intact. This cohort explicitly retires
    // its demand before time advances instead of deleting arbitrary events.
    w.on('initial_report', (p, event) => {
      if (p.need === 'need-water-main' && w.state.responseBenchmark?.config.replaceDefaultNeed) {
        w.record('benchmark_default_report_retired', { need: p.need });
        return;
      }
      return previousReport(p, event);
    });
    w.on('response_benchmark_report_guard', () => {});
  }
  w.on('response_benchmark_social', ({ index }) => {
    const cohort = w.state.responseBenchmark,
      row = cohort.gold[index];
    if (row.silent) return;
    const original = w.generateSignal('P01', {
      building: row.building,
      need: row.needId,
      causeEvent: row.sourceKey,
      text: currentText(row),
      type: ['tweet', 'text', 'audio', 'photo', 'video'][index % 5],
      false: false,
      truthCategory: 'observed',
      mediaDescription:
        'A resident describes the current request. The wording is reproduced in the post; no real media bytes are supplied by this benchmark.',
    });
    if (!original) return;
    // Contextual posts have no location tag. The readable location in their
    // text must be resolved against the same received map as every other arm.
    if (row.style !== 'explicit') original.public.location = null;
    w.state.posts.persist?.(original);
    for (let j = 0; j < cohort.config.reposts; j++) {
      const copy = w.generateSignal('P17', {
        building: row.building,
        need: row.needId,
        causeEvent: row.sourceKey + '-repost-' + j,
        text: original.public.text,
        type: original.public.format,
        false: false,
        truthCategory: 'observed',
        repostOf: original.public.id,
        references: [original.public.id],
        original: original.public.id,
        mediaDescription: original.public.attachments[0]?.description,
      });
      if (copy) {
        copy.public.location = original.public.location;
        w.state.posts.persist?.(copy);
      }
    }
  });
  w.on('response_benchmark_noise', ({ index, building, style }) => {
    const key = `response-benchmark-noise-${index}`,
      rows = {
        support: `Thinking of the families at ${building}. Please keep sharing original updates, not private contact details.`,
        historical: `ARCHIVE at ${building}: the request for 200 litres of water was fulfilled last year. This photograph is historical; it is not a request from the current emergency.`,
        rumour: `Forwarded, unverified: somebody says every family at ${building} has already been evacuated and all supplies are complete. I am not there; can a local response team check this?`,
        context: `Supplies and transport around ${building} are being discussed online. This post has no quantity, first-hand assessment or confirmation of delivery. Please link a current field report.`,
      },
      post = w.generateSignal(style === 'rumour' ? 'P18' : style === 'historical' ? 'P13' : 'P25', {
        building,
        causeEvent: key,
        text: rows[style],
        type: style === 'historical' ? 'photo' : ['tweet', 'text', 'audio'][index % 3],
        false: style === 'rumour',
        truthCategory: style === 'rumour' ? 'incorrect' : 'non_operational',
        ...(style === 'historical' ? { claimedAt: -86400000 } : {}),
        mediaDescription:
          style === 'historical'
            ? 'An explicitly labelled photograph from a prior incident.'
            : 'A community message, not a verified field assessment.',
      });
    if (post) {
      post.public.location = null;
      w.state.posts.persist?.(post);
    }
  });
  w.on('response_benchmark_formal', ({ index }) => {
    const row = w.state.responseBenchmark.gold[index],
      need = w.need(row.needId),
      building = w.building(need.building);
    w.record('benchmark_formal_report_created', {
      need: need.id,
      physicalCreatedAt: need.createdAt,
      reportAt: row.formalAt,
    });
    for (const org of w.state.map.organizations)
      w.send({ kind: 'need_observation', need: clone(need), observedAt: w.now }, org.id, {
        sector: building.sector,
      });
  });
}

export function installResponseBenchmark(w, input = {}) {
  installHandlers(w);
  if (w.state.responseBenchmark) {
    const { config, manifest, gold } = w.state.responseBenchmark;
    return clone({ config, manifest, gold });
  }
  if (w.now !== 0) throw Error('Install the information-gap cohort before time advances');
  const config = configuration(input),
    places = w.state.map.buildings
      .filter((b) => b.use === 'residential')
      .map((b) => ({ b, order: w.random('response_benchmark', b.id, 'location') }))
      .sort((a, b) => a.order - b.order || a.b.id.localeCompare(b.b.id));
  if (places.length < config.count)
    throw Error('The benchmark needs a distinct residential building per physical need');
  const lastReportAt = config.reportAt + (config.count - 1) * config.staggerMs;
  if (lastReportAt + config.formalDelayMs >= w.config.durationMs)
    throw Error('The formal channel must become available within the declared horizon');
  const gold = [];
  for (let index = 0; index < config.count; index++) {
    const building = places[index].b,
      type = ['water', 'food', 'blankets'][index % 3],
      quantity =
        type === 'water'
          ? (2 + Math.floor(w.random('response_benchmark', building.id, 'quantity') * 7)) * 10
          : 10 + Math.floor(w.random('response_benchmark', building.id, 'quantity') * 21),
      reportAt = config.reportAt + index * config.staggerMs,
      style =
        w.random('response_benchmark', building.id, 'explicit') < config.explicitFraction
          ? 'explicit'
          : 'contextual',
      silent = w.random('response_benchmark', building.id, 'silent') < config.silentFraction,
      sourceKey = 'response-benchmark-request-' + index,
      needId = w.publicId('benchmark-need', building.id + '-' + type),
      need = w.addNeed({
        id: needId,
        building: building.id,
        node: building.node,
        type,
        quantity,
        unit: type === 'water' ? 'L' : type === 'food' ? 'portions' : 'unit',
        deadline: Math.min(
          w.config.durationMs,
          3600000 + Math.floor(w.random('response_benchmark', building.id, 'deadline') * 3600000),
        ),
        priority: 3 + Math.floor(w.random('response_benchmark', building.id, 'priority') * 8),
        population: w.sector(building.sector).population,
        silent,
      });
    gold.push({
      index,
      needId: need.id,
      building: building.id,
      type,
      quantity,
      unit: need.unit,
      createdAt: need.createdAt,
      reportAt,
      formalAt: reportAt + config.formalDelayMs,
      silent,
      style,
      sourceKey,
      sourceId: silent ? null : w.publicId('post', sourceKey + '-P01'),
    });
  }
  if (config.replaceDefaultNeed) {
    const ordinary = w.need('need-water-main');
    if (ordinary.served || ordinary.createdAt !== 0)
      throw Error('The ordinary pilot demand cannot be retired after it has received service');
    w.updateNeed(ordinary.id, { quantity: 0 });
    ordinary.completedAt = 0;
    // S23 preloads the small ordinary pilot need. Publish its retirement in
    // that same formal view; a stale 600 L observation would create a phantom
    // operational task even though the physical benchmark demand is zero.
    for (const org of w.state.map.organizations) w.observeNeed(org.id, ordinary);
    w.record('benchmark_default_need_retired', {
      need: ordinary.id,
      reason:
        'The explicit benchmark cohort defines physical demand before any observations exist.',
    });
  }
  const manifest = {
    version: 'response-information-gap-v1',
    seed: w.config.seed,
    mapHash: w.state.map.hash,
    config,
    corpusHash: digest(gold),
    reportingPolicy:
      'Physical need at time zero; public source followed by the same delayed formal report for every arm. Source interpretation alone does not authorize a dispatch.',
    limitation:
      'Internally authored synthetic cohort. Formal delay and human throughput require sensitivity tests; they are not field measurements.',
  };
  w.state.responseBenchmark = { config, manifest, gold };
  for (const row of gold) {
    w.schedule(row.reportAt, 'response_benchmark_social', { index: row.index }, 2, row.sourceKey);
    w.schedule(
      row.formalAt,
      'response_benchmark_formal',
      { index: row.index },
      2,
      'response-benchmark-formal-' + row.index,
    );
  }
  for (let index = 0; index < config.noise; index++) {
    const building =
        places[Math.floor(w.random('response_benchmark', index, 'noise-location') * places.length)]
          .b,
      style = ['support', 'historical', 'rumour', 'context'][index % 4],
      span = Math.max(config.staggerMs, (config.count - 1) * config.staggerMs),
      at = config.reportAt + Math.floor(w.random('response_benchmark', index, 'noise-time') * span);
    w.schedule(
      at,
      'response_benchmark_noise',
      { index, building: building.id, style },
      2,
      'response-benchmark-noise-' + index,
    );
  }
  w.record('response_benchmark_installed', { ...manifest, corpusHash: manifest.corpusHash });
  return clone({ config, manifest, gold });
}
