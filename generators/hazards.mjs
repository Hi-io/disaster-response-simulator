export function installHazards(w) {
  w.on('hazard_start', () => {
    if (w.config.hazard === 'none') return;
    const candidates = w.state.map.buildings.filter((b) => b.use === 'residential');
    for (const b of candidates)
      if (w.random('hazard', b.id, 'initial') < 0.13) {
        w.schedule(
          w.now,
          'damage',
          {
            building: b.id,
            severity: Math.ceil(w.random('hazard', b.id, 'severity') * 3),
            cause: w.config.hazard,
          },
          0,
          `damage-${b.id}`,
        );
      }
    if (['wildfire', 'compound'].includes(w.config.hazard))
      w.schedule(
        w.now + 60000,
        'fire_front',
        { generation: 0, x: 0, z: Math.round(w.state.map.extentM * 0.5) },
        0,
        'fire-0',
      );
    if (['flood', 'compound'].includes(w.config.hazard))
      w.schedule(w.now + 60000, 'flood_level', { generation: 0, depth: 0.45 }, 0, 'flood-0');
    if (w.config.hazard === 'earthquake')
      w.schedule(w.now + 2700000, 'aftershock', {}, 0, 'aftershock');
  });
  w.on('damage', ({ building: id, severity, cause }) => {
    const b = w.building(id);
    if (!b) return;
    b.damage = Math.max(b.damage, severity);
    b.state = severity >= 3 ? 'collapsed' : 'unsafe';
    b.assessed = false;
    b.version++;
    const sector = w.sector(b.sector);
    sector.energy = severity < 3;
    if (severity >= 2) sector.coverage = 0;
    const needId = `need-${id}-water`;
    if (!w.need(needId))
      w.addNeed({
        id: needId,
        building: id,
        type: 'water',
        quantity: sector.population * 2,
        unit: 'L',
        population: sector.population,
        deadline: w.now + 4 * 3600000,
        priority: severity + 3,
        silent: w.random('population', id, 'silent') > 0.8,
      });
    const refugeNeed = `need-${id}-shelter`;
    if (!w.need(refugeNeed))
      w.addNeed({
        id: refugeNeed,
        building: id,
        type: 'shelter',
        quantity: sector.population,
        unit: 'place',
        population: sector.population,
        deadline: w.now + 6 * 3600000,
        priority: severity + 2,
      });
    w.record('building_damaged', { severity, cause, sector: sector.id }, id);
    w.generateSignal('P12', {
      building: id,
      sector: sector.id,
      quantity: sector.population,
      type: 'video',
      text: `A building has fallen near ${id}. Families are outside.`,
      causeEvent: `damage-${id}-${w.now}`,
    });
    w.schedule(w.now + 120000, 'initial_report', { need: needId }, 1, `need-report-${id}-${w.now}`);
    if (severity >= 3) {
      const e = w.state.map.edges.find((e) => e.from === b.node);
      if (e)
        w.schedule(
          w.now,
          'road_change',
          { edge: e.id, open: false, reason: 'debris' },
          0,
          `debris-${e.id}`,
        );
    }
    w.schedule(
      w.now + 1800000,
      'restore_sector',
      { sector: sector.id },
      0,
      `restore-${sector.id}-${w.now}`,
    );
  });
  w.on('restore_sector', ({ sector: id }) => {
    const s = w.sector(id);
    if (s) {
      s.coverage = 1;
      s.energy = true;
      w.record('connectivity_restored', {}, id);
    }
  });
  w.on('road_change', ({ edge: id, open, depth, reason }) => {
    const e = w.edge(id);
    if (!e) return;
    e.open = open ?? e.open;
    e.waterDepth = depth ?? e.waterDepth;
    e.version++;
    w.record('road_changed', { open: e.open, depth: e.waterDepth, reason }, id);
    w.generateSignal(open ? 'P08' : 'P07', {
      node: e.from,
      sector: w.sectorForNode(e.from),
      text: `${open ? 'Some traffic is passing' : 'Access is interrupted'} near ${e.from}.`,
      causeEvent: `road-${id}-${w.now}`,
    });
  });
  w.on('aftershock', () => {
    const b =
      w.state.map.buildings.filter((x) => x.use === 'school')[0] ??
      w.building(w.state.map.shelterId);
    w.schedule(
      w.now,
      'damage',
      { building: b.id, severity: 2, cause: 'aftershock' },
      0,
      `aftershock-${b.id}`,
    );
    w.record('aftershock', {}, b.id);
  });
  w.on('fire_front', ({ generation, x, z }) => {
    const radius = w.state.map.extentM / w.config.grid;
    w.state.hazards ??= [];
    w.state.hazards.push({ id: `fire-${generation}`, kind: 'fire', x, z, radius, at: w.now });
    for (const b of w.state.map.buildings)
      if (Math.hypot(b.x - x, b.z - z) < radius)
        w.schedule(
          w.now,
          'damage',
          { building: b.id, severity: 2, cause: 'fire' },
          0,
          `fire-damage-${generation}-${b.id}`,
        );
    for (const e of w.state.map.edges) {
      const n = w.node(e.from);
      if (Math.hypot(n.x - x, n.z - z) < radius)
        w.schedule(
          w.now,
          'road_change',
          { edge: e.id, open: false, reason: 'fire_exposure' },
          0,
          `fire-road-${generation}-${e.id}`,
        );
    }
    w.record('fire_front_changed', { generation, x, z, radius });
    if (generation < Math.min(8, w.config.grid - 1))
      w.schedule(
        w.now + 300000,
        'fire_front',
        {
          generation: generation + 1,
          x: x + radius * 0.8,
          z: z + (w.random('hazard', 'wind', String(generation)) - 0.5) * radius,
        },
        0,
        `fire-${generation + 1}`,
      );
  });
  w.on('flood_level', ({ generation, depth }) => {
    const strip = w.state.map.extentM * 0.18;
    w.state.hazards ??= [];
    w.state.hazards.push({
      id: `flood-${generation}`,
      kind: 'flood',
      x: w.state.map.extentM * 0.5,
      z: w.state.map.extentM * 0.5,
      radius: strip,
      depth,
      at: w.now,
    });
    for (const e of w.state.map.edges)
      if (Math.abs(w.node(e.from).x - w.state.map.extentM * 0.5) < strip)
        w.schedule(
          w.now,
          'road_change',
          { edge: e.id, open: depth < 0.2, depth, reason: 'flood' },
          0,
          `water-${generation}-${e.id}`,
        );
    w.record('flood_level_changed', { depth });
    if (generation < 3)
      w.schedule(
        w.now + 600000,
        'flood_level',
        { generation: generation + 1, depth: generation >= 1 ? 0.1 : depth + 0.2 },
        0,
        `flood-${generation + 1}`,
      );
  });
}
