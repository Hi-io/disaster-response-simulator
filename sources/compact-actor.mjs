import { digest } from '../engine/determinism.mjs';
import { SimError } from '../contracts/actions.mjs';

// Source-side read projection shared by the inline laboratory and isolated
// runtime. Result documents are immutable source receipts, scoped by owner and
// content revision. Rehydrating them reproduces the legacy actor JSON exactly.
export function createCompactActorProjector(getWorld) {
  let world, queryDigests, sentResults;
  function reset() {
    world = getWorld();
    queryDigests = new WeakMap();
    sentResults = new Map();
  }
  function current() {
    if (world !== getWorld()) reset();
  }
  function revision(query) {
    const result = query.result;
    if (!result || typeof result !== 'object') return digest(result);
    const stamp = `${query.version ?? ''}:${query.state ?? ''}:${query.completedAt ?? ''}`;
    let previous = queryDigests.get(result);
    if (previous?.has(stamp)) return previous.get(stamp);
    const version = digest(result);
    if (!previous) {
      previous = new Map();
      queryDigests.set(result, previous);
    }
    previous.set(stamp, version);
    return version;
  }

  function project(org, { onlyNewResults = false } = {}) {
    const o = world.organization(org);
    if (!o) throw new SimError('AUTHENTICATION', 'Unknown organization', 401);
    if (world.state.integrations.revokedOrgs.includes(org))
      throw new SimError('ACCESS_REVOKED', 'Actor access has been revoked', 403);
    const source = world.state.observations[org],
      { map: knownMap, ...known } = source;
    const sent = sentResults.get(org) ?? new Set(),
      retained = new Set();
    let mapQueryId = null;
    const results = [],
      queries = (world.state.queries ?? [])
        .filter((q) => q.org === org)
        .slice(-100)
        .map((q) => {
          if (!Object.hasOwn(q, 'result') || q.result === undefined) return q;
          const { result, ...rest } = q,
            version = revision(q);
          if (Object.hasOwn(source, 'map') && result === knownMap) mapQueryId = q.id;
          retained.add(version);
          if (!onlyNewResults || !sent.has(version)) {
            results.push({ id: q.id, version, result });
            if (onlyNewResults) sent.add(version);
          }
          return { ...rest, resultRef: { id: q.id, version } };
        });
    if (onlyNewResults) {
      // Match the consumer's 100-query retention. If an evicted version appears
      // in a later query, its immutable document must be published again.
      for (const version of sent) if (!retained.has(version)) sent.delete(version);
      sentResults.set(org, sent);
    }
    // Completed map queries normally own the received map by reference. Restored
    // checkpoints detach aliases, so compare a digest only when that alias was
    // actually lost, then cache its result revision for subsequent frames.
    if (Object.hasOwn(source, 'map') && knownMap !== undefined && mapQueryId === null) {
      const maps = (world.state.queries ?? [])
        .filter((q) => q.org === org && q.target === 'map' && q.result !== undefined)
        .slice(-100);
      const mapVersion = revision({ result: knownMap, state: 'known-map' });
      mapQueryId = maps.findLast((q) => revision(q) === mapVersion)?.id ?? null;
      if (mapQueryId && !queries.some((q) => q.id === mapQueryId)) mapQueryId = null;
      // Unusual legacy observations without a matching retained map query must
      // remain observable; they cannot be represented by an invented reference.
      if (!mapQueryId) known.map = knownMap;
    }
    const humanCapacity = world.humanCapacityView(org);
    const state = {
      runId: world.runId,
      now: world.now,
      organization: { id: o.id, name: o.name, sharing: o.sharing, funds: o.funds },
      known,
      operations: Object.values(source.operations),
      proposals: world.state.proposals.filter((p) => p.org === org),
      commitments: world.state.commitments.filter((p) => p.owner === org),
      offers: world.state.partnerOffers?.[org] ?? [],
      transfers: (world.state.transfers ?? []).filter(
        (t) => t.from === org || world.state.partnerOffers?.[org]?.some((o) => o.id === t.id),
      ),
      sharedCommitments: world.state.sharedCommitments?.[org] ?? [],
      inspections: world.state.inspections
        .filter((p) => p.org === org)
        .map((p) => {
          if (['completed', 'inconclusive', 'timeout'].includes(p.state)) return p;
          return Object.fromEntries(
            [
              'id',
              'org',
              'target',
              'entity',
              'method',
              'purpose',
              'validForMs',
              'targetVersion',
              'reportTo',
              'requestProposal',
              'requestStep',
              'authorizedBy',
              'staffResource',
              'requestedVehicle',
              'state',
              'createdAt',
            ]
              .filter((key) => p[key] !== undefined)
              .map((key) => [key, p[key]]),
          );
        }),
      queries,
      claims: world.state.claims.filter((p) => p.org === org),
      patterns: world.state.patterns.filter((p) => p.org === org),
      modelRequests: (world.state.modelRequests ?? []).filter((p) => p.org === org),
      publicUpdates: world.state.publicUpdates,
      unloadingRequests: Object.values(source.unloadingRequests ?? {}),
      humanCapacity,
      humanWork: humanCapacity.tasks,
      humanInbox: source.humanInbox ?? [],
      compact: { version: 1, runId: world.runId, mapQueryId },
    };
    return { state, results };
  }

  return {
    project(org, options) {
      current();
      return project(org, options);
    },
    queryResult(org, id, version) {
      current();
      if (!world.organization(org) || world.state.integrations.revokedOrgs.includes(org))
        throw new SimError('ACCESS_REVOKED', 'Actor access has been revoked', 403);
      const query = (world.state.queries ?? []).find((q) => q.org === org && q.id === id);
      if (!query || !Object.hasOwn(query, 'result') || query.result === undefined)
        throw new SimError('NOT_FOUND', 'Query result not found', 404);
      const currentVersion = revision(query);
      if (version !== currentVersion)
        throw new SimError('SOURCE_RESULT_CHANGED', 'Query result revision changed', 409);
      return { id, version: currentVersion, result: query.result };
    },
    reset,
  };
}
