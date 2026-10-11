import { route } from '../generators/map.mjs';

export function installTraffic(w) {
  w.startTrip = (v, destination, operation = null) => {
    const known = operation ? w.state.observations[operation.org]?.edges : null;
    const path = route(w.state.map, v.node, destination, v, known);
    if (!path) {
      v.state = 'blocked';
      if (operation) {
        operation.state = 'failed';
        operation.failure = 'no_known_route';
      }
      w.record('trip_failed', { vehicle: v.id, reason: 'no_known_route' }, operation?.id);
      return false;
    }
    v.route = path.edges;
    v.routeIndex = 0;
    v.destination = destination;
    v.operation = operation?.id ?? null;
    v.state = 'en_route';
    v.version++;
    v.eta = w.now + path.freeTimeMs;
    if (operation) {
      operation.state = 'dispatched';
      operation.times[operation.phase === 'pickup' ? 'pickupDispatched' : 'dispatched'] = w.now;
      operation.eta = v.eta;
      w.reportOperation(operation);
    }
    w.record('vehicle_dispatched', { destination, distanceM: path.distanceM, eta: v.eta }, v.id);
    w.schedule(w.now, 'vehicle_enter', { vehicle: v.id }, 3, `enter-${v.id}-${v.version}`);
    return true;
  };
  w.on('vehicle_enter', ({ vehicle: id }) => {
    const v = w.vehicle(id);
    if (!v || ['idle', 'arrived', 'failed', 'cancelled'].includes(v.state)) return;
    if (v.edge) return;
    if (v.pendingDestination) {
      const path = route(
        w.state.map,
        v.node,
        v.pendingDestination,
        v,
        w.state.observations[v.owner]?.edges,
      );
      if (!path) {
        v.state = 'blocked';
        w.record('trip_failed', { vehicle: v.id, reason: 'no_known_reroute' }, v.operation);
        return;
      }
      v.route = path.edges;
      v.routeIndex = 0;
      v.destination = v.pendingDestination;
      delete v.pendingDestination;
    }
    if (v.routeIndex >= v.route.length) {
      v.state = 'arrived';
      w.record('vehicle_arrived', { node: v.node }, v.id);
      if (v.operation) {
        const op = w.state.operations.find((o) => o.id === v.operation);
        if (op && !['cancelled', 'failed'].includes(op.state)) {
          op.state = 'arrived';
          if (op.phase === 'pickup' && ['delivery', 'transfer'].includes(op.type)) {
            op.times.pickupArrived = w.now;
            op.phase = null;
            w.schedule(
              w.now + w.config.loadMs,
              'load',
              { operation: op.id },
              4,
              `pickup-load-${op.id}`,
            );
          } else {
            op.times.arrived = w.now;
            w.schedule(
              w.now,
              ['delivery', 'transfer'].includes(op.type) ? 'request_unload' : 'task_arrival',
              { operation: op.id },
              4,
              `arrival-${op.id}-${w.now}`,
            );
          }
          w.reportOperation(op);
        }
      } else if (v.background) {
        v.state = 'idle';
      }
      return;
    }
    const e = w.edge(v.route[v.routeIndex]);
    const grossWeight =
      v.weightKg +
      (v.load ?? 0) * (v.resourceType === 'energy' ? 150 : 1) +
      (v.passengers ?? 0) * 75;
    if (!e?.open || e.waterDepth > v.maxWaterDepth || grossWeight > e.maxWeight) {
      v.state = 'blocked';
      const op = w.state.operations.find((o) => o.id === v.operation);
      if (op) {
        op.state = 'blocked';
        w.reportOperation(op);
      }
      w.record('vehicle_blocked', { edge: e?.id ?? null }, v.id);
      w.reportRoad?.(e, v.owner);
      return;
    }
    const fuelCost = Math.ceil((e.lengthM * (v.fuelMlPerKm ?? 180)) / 1000);
    if (w.now >= v.shiftEnd || v.fuel < fuelCost) {
      v.state = 'failed';
      const op = w.state.operations.find((o) => o.id === v.operation);
      if (op) {
        op.state = 'failed';
        op.failure = 'fuel_or_shift';
      }
      w.record('trip_failed', { reason: 'fuel_or_shift' }, v.id);
      if (op) w.reportOperation(op);
      return;
    }
    if (e.occupants.length >= e.storage || w.now < e.nextEntryAt) {
      v.state = 'queued';
      if (!e.waiting.includes(v.id)) e.waiting.push(v.id);
      w.schedule(
        Math.max(w.now + 5000, e.nextEntryAt),
        'vehicle_enter',
        { vehicle: id },
        3,
        `queue-${id}-${w.now}`,
      );
      return;
    }
    e.waiting = e.waiting.filter((x) => x !== v.id);
    e.occupants.push(v.id);
    e.nextEntryAt = w.now + e.headwayMs;
    v.edge = e.id;
    v.edgeStart = w.now;
    v.edgeEnd =
      w.now +
      Math.ceil((e.lengthM / Math.min(v.speedMps, e.speedMps)) * 1000) *
        (1 + Math.max(0, e.occupants.length - e.capacity) / e.capacity);
    v.edgeEnd = Math.ceil(v.edgeEnd);
    v.state = 'en_route';
    w.schedule(v.edgeEnd, 'vehicle_exit', { vehicle: id, edge: e.id }, 3, `exit-${id}-${w.now}`);
  });
  w.on('vehicle_exit', ({ vehicle: id, edge: idEdge }) => {
    const v = w.vehicle(id),
      e = w.edge(idEdge);
    if (!v || v.edge !== idEdge) return;
    const downstream = w.edge(v.route[v.routeIndex + 1]);
    if (
      downstream?.open &&
      downstream.occupants.length >= downstream.storage &&
      !v.pendingCancel &&
      !v.pendingDestination
    ) {
      v.state = 'spillback';
      w.record('traffic_spillback', { edge: e.id, downstream: downstream.id }, v.id);
      w.schedule(
        w.now + 5000,
        'vehicle_exit',
        { vehicle: id, edge: idEdge },
        3,
        `spillback-${id}-${w.now}`,
      );
      return;
    }
    e.occupants = e.occupants.filter((x) => x !== id);
    v.node = e.to;
    v.routeIndex++;
    const fuelCost = Math.ceil((e.lengthM * (v.fuelMlPerKm ?? 180)) / 1000);
    v.fuel -= fuelCost;
    v.fuelUsed += fuelCost;
    v.distanceM = (v.distanceM ?? 0) + e.lengthM;
    v.edge = null;
    v.edgeStart = null;
    v.edgeEnd = null;
    w.send(
      {
        kind: 'telemetry',
        vehicle: id,
        node: v.node,
        observedAt: w.now,
        view: { ...w.vehicleView(v), node: v.node, at: w.now, fuel: v.fuel, state: v.state },
      },
      v.owner,
      { sector: w.sectorForNode(v.node), target: id },
    );
    if (v.pendingCancel) {
      v.state = 'idle';
      v.operation = null;
      w.record('vehicle_stopped', { node: v.node }, id);
      delete v.pendingCancel;
      return;
    }
    w.schedule(w.now, 'vehicle_enter', { vehicle: id }, 3, `continue-${id}-${w.now}`);
  });
  w.on('background_trip', ({ index }) => {
    const id = `traffic-${index}`;
    let v = w.vehicle(id);
    const nodes = w.state.map.nodes;
    if (!v) {
      v = {
        id,
        owner: 'org0',
        node: nodes[Math.floor(w.random('traffic', id, 'origin') * nodes.length)].id,
        capacity: 1,
        weightKg: 1500,
        speedMps: 10,
        maxWaterDepth: 0.15,
        fuel: 100000,
        fuelUsed: 0,
        shiftEnd: w.config.durationMs,
        load: 0,
        state: 'idle',
        edge: null,
        lastGPS: { node: '', at: 0 },
        version: 1,
        background: true,
      };
      w.state.vehicles.push(v);
    }
    if (['idle', 'arrived'].includes(v.state)) {
      const target =
        nodes[Math.floor(w.random('traffic', id, `target-${w.now}`) * nodes.length)].id;
      w.startTrip(v, target);
    }
    if (w.now + 120000 < w.config.durationMs)
      w.schedule(w.now + 120000, 'background_trip', { index }, 3, `background-${index}-${w.now}`);
  });
  w.vehiclePosition = (v) => {
    const n = w.node(v.node);
    if (!v.edge) return { x: n.x, z: n.z };
    const e = w.edge(v.edge),
      to = w.node(e.to),
      f = Math.max(0, Math.min(1, (w.now - v.edgeStart) / (v.edgeEnd - v.edgeStart)));
    return { x: n.x + (to.x - n.x) * f, z: n.z + (to.z - n.z) * f };
  };
}
