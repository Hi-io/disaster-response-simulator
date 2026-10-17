const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const signature = value => JSON.stringify(value);

function rememberRow(kind, value) {
  return {
    signature: signature(value),
    // Received road records are replaced by the engine's communications and
    // verification handlers. Version/time guards also cover stamped in-place
    // edits made by integrations. Other collections may mutate in place and
    // always compare their detached JSON signature.
    ...(kind === 'edges' && record(value)
      ? { reference: value, version: value.version, at: value.at } : {}),
  };
}

/**
 * A producer-side read-model delta, independent of World and the event bus.
 * Returned data is detached from engine-owned records. Only signatures (and
 * guarded immutable road references) are retained, never a mutable state clone.
 * Each org needs its initial replacement before later ordered deltas.
 */
export function createActorDeltaProjector() {
  const organizations = new Map();
  return {
    reset() { organizations.clear(); },
    forget(org) { organizations.delete(org); },
    project(org, state) {
      let previous = organizations.get(org);
      const replacing = !previous || previous.runId !== state.runId;
      if (replacing) {
        previous = { runId: state.runId, header: new Map(), known: new Map() };
        organizations.set(org, previous);
      }
      const patch = { header: {}, removedHeader: [], known: {}, removed: {}, removedKinds: [] };
      for (const [key, value] of Object.entries(state)) {
        if (key === 'known') continue;
        const encoded = signature(value);
        if (!previous.header.has(key) || previous.header.get(key) !== encoded) patch.header[key] = value;
        previous.header.set(key, encoded);
      }
      for (const key of previous.header.keys()) if (!Object.hasOwn(state, key)) {
        patch.removedHeader.push(key); previous.header.delete(key);
      }
      for (const [kind, rows] of Object.entries(state.known ?? {})) {
        let old = previous.known.get(kind);
        if (!record(rows)) {
          const encoded = signature(rows);
          if (!old || old.type !== 'value' || old.signature !== encoded) patch.known[kind] = rows;
          previous.known.set(kind, { type: 'value', signature: encoded });
          continue;
        }
        const replaceCollection = !old || old.type !== 'rows';
        if (replaceCollection) old = { type: 'rows', rows: new Map() };
        const changed = {}, ids = Object.keys(rows);
        let changes = 0;
        for (const id of ids) {
          const value = rows[id];
          const before = old.rows.get(id);
          if (kind === 'edges' && before?.reference === value && record(value) &&
              before.version === value.version && before.at === value.at) continue;
          const remembered = rememberRow(kind, value);
          if (!before || before.signature !== remembered.signature) { changed[id] = value; changes++; }
          old.rows.set(id, remembered);
        }
        const removed = [];
        if (ids.length !== old.rows.size) for (const id of old.rows.keys()) if (!Object.hasOwn(rows, id)) {
          removed.push(id); old.rows.delete(id);
        }
        if (replaceCollection || changes) patch.known[kind] = changed;
        if (removed.length) patch.removed[kind] = removed;
        previous.known.set(kind, old);
      }
      for (const kind of previous.known.keys()) if (!Object.hasOwn(state.known ?? {}, kind)) {
        patch.removedKinds.push(kind); previous.known.delete(kind);
      }
      return structuredClone(replacing ? { replace: state } : patch);
    },
  };
}

/** Apply one ordered producer patch; useful to materializers and adapter tests. */
export function applyActorDelta(previous, patch) {
  if (patch.replace) return patch.replace;
  if (!previous) throw Error('An actor delta requires its initial snapshot.');
  const known = { ...previous.known };
  for (const kind of patch.removedKinds ?? []) delete known[kind];
  for (const [kind, rows] of Object.entries(patch.known ?? {})) {
    if (!record(rows)) known[kind] = rows;
    else known[kind] = { ...(record(known[kind]) ? known[kind] : {}), ...rows };
  }
  for (const [kind, ids] of Object.entries(patch.removed ?? {})) {
    known[kind] = { ...known[kind] };
    for (const id of ids) delete known[kind][id];
  }
  const state = { ...previous, ...patch.header, known };
  for (const key of patch.removedHeader ?? []) delete state[key];
  return state;
}
