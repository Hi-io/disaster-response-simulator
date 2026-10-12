import { digest } from './determinism.mjs';

export function installCommunications(w) {
  w.sectorForNode = (node) => w.state.map.sectors.find((s) => s.node === node)?.id;
  w.connected = (sector, channel = 'internet') => {
    if (!sector) return true;
    const s = w.sector(sector);
    if (!s) return false;
    if (s.channels?.[channel] === false) return false;
    if (channel === 'radio') return s.battery > 0;
    if (channel === 'landline') return s.energy;
    return s.coverage > 0 && s.energy && s.battery > 0;
  };
  w.send = (
    payload,
    to,
    { channel = 'internet', sector = null, target = null, ttlMs = 3600000, bytes = 1000 } = {},
  ) => {
    const id = w.nextId('message');
    const m = {
      id,
      payload: structuredClone(payload),
      to,
      channel,
      sector,
      target,
      bytes,
      createdAt: w.now,
      expiresAt: w.now + ttlMs,
      attempt: 0,
      state: 'queued',
      times: { created: w.now },
    };
    if ((w.state.messagePending ?? 0) >= w.config.networkCapacity * 100) {
      m.state = 'dropped';
      w.record('message_dropped', { kind: payload.kind, reason: 'finite_outbox' }, id);
    } else {
      w.state.messagePending = (w.state.messagePending ?? 0) + 1;
      m.pending = true;
    }
    w.state.messages.push(m);
    if (m.state !== 'dropped') w.schedule(w.now, 'transmit', { id }, 2, `transmit-${id}`);
    return m;
  };
  w.on('transmit', ({ id }) => {
    const m = w.lookup('messages', w.state.messages, id);
    if (!m || ['delivered', 'expired', 'failed', 'dropped'].includes(m.state)) return;
    if (w.now > m.expiresAt) {
      m.state = 'expired';
      m.expired = true;
      if (m.pending) {
        w.state.messagePending--;
        m.pending = false;
      }
      w.record('message_expired', { kind: m.payload.kind, target: m.target }, id);
      return;
    }
    const currentSector =
      m.target && w.vehicle(m.target) ? w.sectorForNode(w.vehicle(m.target).node) : m.sector;
    if (
      !w.connected(currentSector, m.channel) ||
      (w.organization(m.to)?.connected === false && m.channel !== 'radio')
    ) {
      m.state = 'offline';
      w.schedule(w.now + 30000, 'transmit', { id }, 2, `retry-offline-${id}-${w.now}`);
      return;
    }
    m.attempt++;
    m.state = 'transmitting';
    m.times.transmitted = w.now;
    const active = (w.state.networkInFlight ?? 0) + 1;
    const congestion = Math.floor(active / w.config.networkCapacity) * 5000;
    const latency =
      w.config.networkLatencyMs +
      (m.channel === 'radio' ? 10000 : 0) +
      Math.ceil((m.bytes / w.config.bandwidthBytesPerSecond) * 1000) +
      congestion;
    if (w.random('communications', id, 'loss', m.attempt) < w.config.packetLoss) {
      m.state = 'retrying';
      w.record('packet_lost', { attempt: m.attempt }, id);
      w.schedule(w.now + latency + 5000, 'transmit', { id }, 2, `loss-retry-${id}-${m.attempt}`);
      return;
    }
    w.state.networkInFlight = active;
    m.inFlight = true;
    w.schedule(w.now + latency, 'message_deliver', { id }, 2, `deliver-${id}-${m.attempt}`);
  });
  w.on('message_deliver', ({ id }) => {
    const m = w.lookup('messages', w.state.messages, id);
    if (!m || m.state === 'delivered') return;
    if (m.inFlight) {
      w.state.networkInFlight--;
      m.inFlight = false;
    }
    const currentSector =
      m.target && w.vehicle(m.target) ? w.sectorForNode(w.vehicle(m.target).node) : m.sector;
    if (
      !w.connected(currentSector, m.channel) ||
      (w.organization(m.to)?.connected === false && m.channel !== 'radio')
    ) {
      m.state = 'offline';
      w.schedule(w.now + 30000, 'transmit', { id }, 2, `retry-receive-${id}-${w.now}`);
      return;
    }
    if (w.now > m.expiresAt) {
      m.state = 'expired';
      m.expired = true;
      if (m.pending) {
        w.state.messagePending--;
        m.pending = false;
      }
      w.record('message_expired', { kind: m.payload.kind, to: m.to }, id);
      return;
    }
    m.state = 'delivered';
    if (m.pending) {
      w.state.messagePending--;
      m.pending = false;
    }
    m.times.delivered = w.now;
    w.record('message_delivered', { kind: m.payload.kind, to: m.to, target: m.target }, id);
    const p = m.payload;
    if (w.state.observations[m.to])
      w.state.observations[m.to].lastContact[m.target ?? m.sector ?? m.id] = w.now;
    if (p.kind === 'post') w.publishPost(p.post);
    else if (p.kind === 'telemetry') {
      const v = w.vehicle(p.vehicle),
        prior = w.state.observations[m.to]?.vehicles[p.vehicle],
        priorAt = Math.max(v?.lastGPS.at ?? -1, prior?.at ?? -1);
      // Equal-time lifecycle reports have monotonically increasing versions.
      // A delayed retry from the last road edge cannot overwrite a newer idle
      // receipt and make an available truck appear busy again.
      if (v && (p.observedAt > priorAt ||
        p.observedAt === priorAt && (p.view?.version ?? 0) >= (prior?.version ?? 0))) {
        v.lastGPS = { node: p.node, at: p.observedAt };
        w.state.observations[m.to].vehicles[v.id] = p.view ?? {
          ...w.vehicleView(v),
          node: p.node,
          at: p.observedAt,
        };
      }
    } else if (p.kind === 'road') {
      const e = w.edge(p.edge),
        old = w.state.observations[m.to]?.edges[p.edge];
      if (
        e &&
        (!old || p.version > old.version || (p.version === old.version && p.observedAt >= old.at))
      )
        w.state.observations[m.to].edges[e.id] = {
          open: p.open,
          waterDepth: p.waterDepth,
          version: p.version,
          at: p.observedAt,
        };
    } else if (p.kind === 'command') {
      const op = w.state.operations.find((o) => o.id === p.operation);
      if (op && !['failed', 'cancelled'].includes(op.state)) {
        op.times.orderReceived = w.now;
        op.times.accepted = w.now;
        const v = w.vehicle(op.vehicle),
          r = w.resource(op.resource);
        if (v.node !== r.node) {
          op.phase = 'pickup';
          w.startTrip(v, r.node, op);
        } else
          w.schedule(w.now + w.config.loadMs, 'load', { operation: op.id }, 4, `load-${op.id}`);
      }
    } else if (p.kind === 'reroute') {
      const v = w.vehicle(p.vehicle);
      if (v) w.applyReroute(v, p);
    } else if (p.kind === 'cancel') {
      const v = w.vehicle(p.vehicle);
      if (v) w.cancelVehicle(v, p);
    } else if (p.kind === 'task_command') {
      const op = w.state.operations.find((o) => o.id === p.operation);
      if (op && !['failed', 'cancelled'].includes(op.state)) {
        op.times.orderReceived = w.now;
        w.startTrip(w.vehicle(op.vehicle), op.destination, op);
      }
    } else if (p.kind === 'need_observation') {
      const n = p.need,
        old = w.state.observations[m.to].needs[n.id];
      if (!old || p.observedAt >= old.at)
        w.state.observations[m.to].needs[n.id] = {
          id: n.id,
          building: n.building,
          type: n.type,
          quantity: n.quantity,
          served: n.served,
          unit: n.unit,
          deadline: n.deadline,
          population: n.population,
          version: n.version,
          at: p.observedAt,
        };
    } else if (p.kind === 'population_observation') {
      const value = p.snapshot,
        old = w.state.observations[m.to].population[value.sector];
      if (!old || value.observedAt >= old.observedAt)
        w.state.observations[m.to].population[value.sector] = value;
    } else if (p.kind === 'share') {
      w.receiveShare(m.to, p);
    } else if (p.kind === 'verification') {
      w.completeVerification(p);
    } else if (p.kind === 'transfer_offer') {
      w.state.partnerOffers ??= {};
      (w.state.partnerOffers[m.to] ??= []).push(p.transfer);
      w.record('transfer_offer_received', { from: p.transfer.from, to: m.to, id: p.transfer.id });
    } else if (p.kind === 'resource_status') {
      const old = w.state.observations[m.to].resources[p.resource.id];
      if (!old || p.resource.version > old.version ||
        p.resource.version === old.version && p.observedAt >= (old.at ?? -1))
        w.state.observations[m.to].resources[p.resource.id] = { ...p.resource, at: p.observedAt };
    } else if (p.kind === 'operation_status') {
      const old = w.state.observations[m.to].operations[p.operation.id];
      if (!old || p.observedAt > (old.observedAt ?? -1) ||
        p.observedAt === (old.observedAt ?? -1) && (p.operation.version ?? 0) >= (old.version ?? 0))
        w.state.observations[m.to].operations[p.operation.id] = {
          ...p.operation,
          observedAt: p.observedAt,
        };
    } else if(p.kind === 'facility_status') {
      const prior=w.state.observations[m.to].buildings[p.building.id];
      if(!prior || (prior.statusObservedAt??-1)<=p.observedAt)
        w.state.observations[m.to].buildings[p.building.id]={...prior,...p.building,statusObservedAt:p.observedAt};
    } else if (p.kind === 'query_result') w.completeQuery(p);
  });
  w.reportResource = (resource, org) => w.send({ kind: 'resource_status',
    resource: w.resourceView(resource), observedAt: w.now }, org,
    { sector: w.sectorForNode(resource.node) });
  w.reportRoad = (edge, org) => {
    if (edge)
      w.send(
        {
          kind: 'road',
          edge: edge.id,
          open: edge.open,
          waterDepth: edge.waterDepth,
          version: edge.version,
          observedAt: w.now,
        },
        org,
        { sector: w.sectorForNode(edge.from) },
      );
  };
  w.reportOperation = (op) => {
    // Version the material lifecycle, never the number of polls. Tracking is
    // private simulator state and is not included in any actor observation.
    const material = structuredClone(op);
    delete material.version;
    delete material.observedAt;
    const signature = digest(material);
    w.state.operationReportVersions ??= {};
    const previous = w.state.operationReportVersions[op.id];
    const version = previous?.signature === signature
      ? previous.version
      : Math.max(previous?.version ?? 0, op.version ?? 0) + 1;
    op.version = version;
    w.state.operationReportVersions[op.id] = { signature, version };
    const v = w.vehicle(op.vehicle);
    return w.send(
      { kind: 'operation_status', operation: structuredClone(op), observedAt: w.now },
      op.org,
      { sector: v ? w.sectorForNode(v.node) : null },
    );
  };
}
