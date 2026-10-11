import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const clock = (ms) => new Date(ms).toISOString().slice(11, 19);
const number = (n) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(n ?? 0);
let snapshot,
  catalog,
  selected = null,
  following = false,
  frozen = false,
  lastRun,
  mapGroup,
  vehicleGroup;
let rayTargets = [],
  pickMap = new Map(),
  vehicleMeshes = new Map(),
  busy = false;
const layers = { needs: true, roads: true, hazards: true, network: false, routes: true };
let renderer,
  scene,
  camera,
  controls,
  extent = 1,
  lastFrame = performance.now(),
  frames = 0;
let layerGroups = {},
  requestCounter = 0;

async function api(url, data) {
  const response = await fetch(
    url,
    data === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? result.error);
  return result;
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').style.display = 'block';
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => ($('toast').style.display = 'none'), 4000);
}
const perform = (fn) => async (event) => {
  event?.preventDefault();
  try {
    await fn(event);
    await refresh();
  } catch (error) {
    toast(error.message);
  }
};
function download(name, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }),
  );
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function property(label, value) {
  return `<div class="property"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
}
function dispose(group) {
  if (!group) return;
  group.traverse((o) => {
    o.geometry?.dispose();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material?.dispose();
  });
  scene.remove(group);
}
function position(node) {
  return snapshot.state.map.nodes.find((n) => n.id === node);
}

function initialize3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#eff3f8');
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  $('canvas').append(renderer.domElement);
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minPolarAngle = 0.2;
  controls.screenSpacePanning = false;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  scene.add(new THREE.HemisphereLight('#ffffff', '#8291ae', 2.5));
  const sun = new THREE.DirectionalLight('#ffffff', 3);
  sun.position.set(-10, 25, 10);
  scene.add(sun);
  const resize = () => {
    const rect = $('canvas').getBoundingClientRect();
    renderer.setSize(rect.width, rect.height);
    const aspect = rect.width / rect.height;
    camera.left = -extent * aspect;
    camera.right = extent * aspect;
    camera.top = extent;
    camera.bottom = -extent;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe($('canvas'));
  initialize3D.resize = resize;
  let down;
  renderer.domElement.addEventListener(
    'pointerdown',
    (e) => (down = { x: e.clientX, y: e.clientY }),
  );
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(down.x - e.clientX, down.y - e.clientY) > 6) return;
    const r = renderer.domElement.getBoundingClientRect(),
      ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      ),
      camera,
    );
    const hit = ray
      .intersectObjects(rayTargets)
      .find((h) => h.object.visible && h.object.parent?.visible);
    if (hit)
      select(
        pickMap.get(`${hit.object.uuid}:${hit.instanceId ?? ''}`) ?? hit.object.userData.entity,
      );
  });
  window.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const d = extent * 0.04;
    const v = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[
      e.key
    ];
    if (v) {
      e.preventDefault();
      controls.target.x += v[0];
      controls.target.z += v[1];
      camera.position.x += v[0];
      camera.position.z += v[1];
    }
    if (e.key.toLowerCase() === 'h') home();
  });
  const animate = (now) => {
    requestAnimationFrame(animate);
    if (!snapshot || document.hidden) return;
    frames++;
    if (now - lastFrame > 1500) {
      renderer.domElement.dataset.fps = `${Math.round((frames * 1000) / (now - lastFrame))}`;
      frames = 0;
      lastFrame = now;
    }
    updateVehicles();
    if (following && selected?.kind === 'vehicle') {
      const mesh = vehicleMeshes.get(selected.id);
      if (mesh) {
        const delta = mesh.position.clone().sub(controls.target);
        delta.y = 0;
        controls.target.addScaledVector(delta, 0.12);
        camera.position.addScaledVector(delta, 0.12);
      }
    }
    const zoomedOut = camera.zoom < 0.55;
    if (layerGroups.buildings) layerGroups.buildings.visible = !zoomedOut;
    controls.update();
    renderer.render(scene, camera);
  };
  requestAnimationFrame(animate);
}
function home() {
  const map = snapshot.state.map,
    mid = map.extentM / 2;
  extent = map.extentM * 0.65;
  camera.position.set(mid + map.extentM, map.extentM * 1.1, mid + map.extentM);
  camera.far = map.extentM * 8;
  camera.zoom = 1;
  controls.target.set(mid, 0, mid);
  initialize3D.resize();
  controls.update();
}
function buildScene() {
  dispose(mapGroup);
  dispose(vehicleGroup);
  mapGroup = new THREE.Group();
  vehicleGroup = new THREE.Group();
  scene.add(mapGroup, vehicleGroup);
  rayTargets = [];
  pickMap = new Map();
  vehicleMeshes = new Map();
  layerGroups = {};
  const map = snapshot.state.map,
    scale = map.extentM / snapshot.manifest.config.grid,
    perspective = $('perspective').value,
    obs = perspective === 'truth' ? null : snapshot.state.observations[perspective];
  const subgroup = (name) => {
    const group = new THREE.Group();
    layerGroups[name] = group;
    mapGroup.add(group);
    return group;
  };
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(map.extentM * 1.08, map.extentM * 1.08),
    new THREE.MeshStandardMaterial({ color: '#e9eef5', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(map.extentM / 2, -1, map.extentM / 2);
  mapGroup.add(ground);
  const roads = subgroup('roads'),
    buildings = subgroup('buildings'),
    hazards = subgroup('hazards'),
    needs = subgroup('needs'),
    network = subgroup('network'),
    routes = subgroup('routes');
  const vertices = [],
    damaged = [];
  for (const edge of map.edges) {
    if (edge.from > edge.to) continue;
    const a = position(edge.from),
      b = position(edge.to),
      known = obs?.edges[edge.id];
    const target = (obs ? known?.open === false : !edge.open) ? damaged : vertices;
    target.push(a.x, 1, a.z, b.x, 1, b.z);
  }
  const lines = (points, color, parent, opacity = 1) => {
    if (!points.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const o = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
    );
    parent.add(o);
  };
  lines(vertices, '#c6d2e2', roads);
  lines(damaged, '#ce7a69', roads);
  const boxes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 1 }),
    map.buildings.length,
  );
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  map.buildings.forEach((b, i) => {
    const visible = obs ? obs.buildings[b.id] : b;
    const base =
      b.use === 'depot'
        ? '#8d9bc8'
        : b.use === 'shelter'
          ? '#aaa1ca'
          : b.use === 'plant'
            ? '#8fafba'
            : '#c8d0df';
    const color =
      visible?.state === 'operating'
        ? '#7ba99b'
        : visible?.damage >= 1 || visible?.state === 'damaged'
          ? '#d49988'
          : base;
    const h = (b.height * scale) / 150;
    matrix.compose(
      new THREE.Vector3(b.x, h / 2, b.z),
      quaternion,
      new THREE.Vector3(b.width, h, b.width),
    );
    boxes.setMatrixAt(i, matrix);
    boxes.setColorAt(i, new THREE.Color(color));
    pickMap.set(`${boxes.uuid}:${i}`, { kind: 'building', id: b.id });
  });
  boxes.instanceMatrix.needsUpdate = true;
  if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
  buildings.add(boxes);
  rayTargets.push(boxes);
  for (const n of snapshot.state.needs) {
    if (n.served >= n.quantity || (obs && !obs.needs[n.id])) continue;
    const b = map.buildings.find((b) => b.id === n.building);
    if (!b) continue;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(scale * 0.07, scale * 0.09, 24),
      new THREE.MeshBasicMaterial({
        color: '#dc8d78',
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(b.x, 3, b.z);
    ring.userData.entity = { kind: 'need', id: n.id };
    needs.add(ring);
    rayTargets.push(ring);
  }
  for (const s of map.sectors) {
    if (!obs && s.coverage === 0) {
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(scale * 0.18, 20),
        new THREE.MeshBasicMaterial({
          color: '#8391ab',
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide,
        }),
      );
      const n = position(s.node);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(n.x, 2, n.z);
      network.add(dot);
    }
  }
  if (!obs)
    for (const h of snapshot.state.hazards ?? []) {
      const disk = new THREE.Mesh(
        new THREE.CircleGeometry(h.radius ?? scale, 40),
        new THREE.MeshBasicMaterial({
          color: h.kind === 'flood' ? '#8eb7d6' : '#e59a76',
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
        }),
      );
      disk.rotation.x = -Math.PI / 2;
      disk.position.set(h.x, 4, h.z);
      hazards.add(disk);
    }
  for (const v of snapshot.state.vehicles) {
    if (obs && !obs.vehicles[v.id]) continue;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(scale * (v.background ? 0.018 : 0.035), scale * 0.025, scale * 0.045),
      new THREE.MeshStandardMaterial({ color: v.background ? '#b0bac9' : '#5e7fc7' }),
    );
    mesh.userData.entity = { kind: 'vehicle', id: v.id };
    vehicleGroup.add(mesh);
    rayTargets.push(mesh);
    vehicleMeshes.set(v.id, mesh);
    if (layers.routes && v.route?.length && !v.background && (!obs || v.owner === perspective)) {
      const ps = [];
      for (const eid of v.route) {
        const e = map.edges.find((e) => e.id === eid),
          a = position(e.from),
          b = position(e.to);
        ps.push(a.x, 5, a.z, b.x, 5, b.z);
      }
      lines(ps, '#7c88c9', routes, 0.45);
    }
  }
  for (const name of Object.keys(layers)) layerGroups[name].visible = layers[name];
  updateVehicles();
}
function updateVehicles() {
  if (!snapshot) return;
  const truth = $('perspective').value === 'truth',
    obs = snapshot.state.observations[$('perspective').value];
  for (const v of snapshot.state.vehicles) {
    const mesh = vehicleMeshes.get(v.id);
    if (!mesh) continue;
    const n = position(truth ? v.node : obs?.vehicles[v.id]?.node);
    if (!n) continue;
    let x = n.x,
      z = n.z;
    if (truth && v.edge) {
      const edge = snapshot.state.map.edges.find((e) => e.id === v.edge),
        to = position(edge.to),
        t = Math.max(0, Math.min(1, (snapshot.now - v.edgeStart) / (v.edgeEnd - v.edgeStart)));
      x += (to.x - n.x) * t;
      z += (to.z - n.z) * t;
      mesh.rotation.y = Math.atan2(to.x - n.x, to.z - n.z);
    }
    mesh.position.set(x, (snapshot.state.map.extentM / snapshot.manifest.config.grid) * 0.018, z);
  }
}
function select(entity) {
  if (!entity) return;
  selected = entity;
  following = false;
  inspect();
}
function inspect() {
  if (!selected || !snapshot) return;
  const s = snapshot.state,
    obs = $('perspective').value === 'truth' ? null : s.observations[$('perspective').value];
  let e;
  if (selected.kind === 'building')
    e = obs ? obs.buildings[selected.id] : s.map.buildings.find((x) => x.id === selected.id);
  if (selected.kind === 'vehicle')
    e = obs ? obs.vehicles[selected.id] : s.vehicles.find((x) => x.id === selected.id);
  if (selected.kind === 'need')
    e = obs ? obs.needs[selected.id] : s.needs.find((x) => x.id === selected.id);
  if (selected.kind === 'operation')
    e = s.operations.find(
      (x) => x.id === selected.id && (!obs || x.org === $('perspective').value),
    );
  if (selected.kind === 'post') e = s.posts.find((x) => x.public.id === selected.id)?.public;
  $('selectionTitle').textContent = selected.id;
  $('selectionHint').textContent = e
    ? `${selected.kind} · ${obs ? 'Known observation' : 'Ground truth'}`
    : 'No observation available to this organization.';
  $('follow').hidden = selected.kind !== 'vehicle';
  $('follow').textContent = following ? 'Stop following' : 'Follow vehicle';
  if (!e) {
    $('selection').innerHTML = '';
    return;
  }
  const keys =
    selected.kind === 'post'
      ? ['authorName', 'text', 'format', 'publishedAt', 'version']
      : [
          'use',
          'owner',
          'org',
          'state',
          'type',
          'quantity',
          'served',
          'unit',
          'capacity',
          'occupancy',
          'damage',
          'load',
          'fuel',
          'node',
          'at',
          'version',
          'deadline',
          'destination',
        ];
  let html = keys
    .filter((k) => e[k] !== undefined)
    .map((k) => property(k, typeof e[k] === 'object' ? JSON.stringify(e[k]) : e[k]))
    .join('');
  if (e.dependencies)
    html +=
      '<h2>Dependencies</h2>' +
      Object.entries(e.dependencies)
        .map(
          ([k, v]) =>
            `<div class="dependency">${escape(k)} · ${number(e.provisioned?.[k] ?? 0)} / ${number(v)}</div>`,
        )
        .join('');
  if (!obs) {
    html +=
      '<h2>Timeline</h2>' +
      snapshot.events
        .filter((ev) => ev.entity === selected.id || JSON.stringify(ev.data).includes(selected.id))
        .slice(-12)
        .reverse()
        .map(
          (ev) =>
            `<div class="timelineEntry">${clock(ev.at)} · ${escape(ev.type)}<br>${escape(JSON.stringify(ev.data))}</div>`,
        )
        .join('');
  }
  $('selection').innerHTML = html;
}
function showStreams() {
  if (frozen) return;
  const s = snapshot.state,
    filter = $('feedFilter').value.toLowerCase(),
    truth = $('perspective').value === 'truth';
  const matches = (e) => JSON.stringify(e).toLowerCase().includes(filter);
  const cards = (items, fn) =>
    items.slice(-80).reverse().filter(matches).map(fn).join('') ||
    '<p class="empty">No events in this view yet.</p>';
  $('reality').innerHTML = truth
    ? cards(
        snapshot.events,
        (e) =>
          `<div class="feedCard" data-kind="${e.entity?.startsWith('v-') ? 'vehicle' : e.entity?.startsWith('need-') ? 'need' : 'building'}" data-id="${escape(e.entity ?? e.data.building ?? '')}"><small><span>${escape(e.type)}</span><span>${clock(e.at)}</span></small><p>${escape(JSON.stringify(e.data))}</p></div>`,
      )
    : '<p class="empty">Ground truth is hidden in this perspective.</p>';
  $('communication').innerHTML = cards(
    s.posts.filter((p) => p.public.publishedAt !== null),
    (p) =>
      `<div class="feedCard ${truth && p.private.false ? 'false' : ''}" data-kind="post" data-id="${p.public.id}"><small><span>${escape(p.public.authorName)} · ${escape(p.public.format)}</span><span>${clock(p.public.publishedAt)}</span></small><p>${escape(p.public.text)}</p>${p.public.attachments.map((a) => `<div class="media">${a.kind === 'video' ? '▶' : a.kind === 'audio' ? '◖' : '▧'} ${escape(a.kind)} · ${escape(a.description)}</div>`).join('')}${truth && p.private.false ? '<p>Observer label · inaccurate / misleading</p>' : ''}</div>`,
  );
  $('ingestion').innerHTML = cards(
    s.ingestion.filter((r) => truth || r.org === $('perspective').value),
    (r) =>
      `<div class="feedCard" data-kind="post" data-id="${r.id}"><small><span>${escape(r.org)} · ${escape(r.stage)}</span><span>${clock(r.at)}</span></small><p>${escape(r.reason ?? r.id)}</p></div>`,
  );
  $('feedCount').textContent =
    `${number(s.posts.length)} signals created · showing up to 80 per column`;
}
let previousSceneHash;
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    snapshot = await api('/api/state');
    $('login').hidden = true;
    $('app').hidden = false;
    if (!renderer) initialize3D();
    const changed = snapshot.runId !== lastRun;
    lastRun = snapshot.runId;
    $('clock').textContent = clock(snapshot.now);
    $('play').textContent = snapshot.playing ? 'Pause' : 'Play';
    $('speed').value = snapshot.rate;
    $('runId').textContent = `run ${snapshot.runId.slice(0, 8)}`;
    $('sourceLink').href = snapshot.sourceUrl + '/feed';
    $('effective').textContent = `${number(snapshot.effectiveRate)}× effective`;
    const m = snapshot.metrics;
    $('pendingWater').textContent = number(m.services.water?.pending) + ' L';
    $('servedWater').textContent = number(m.services.water?.served) + ' L';
    $('signals').textContent = `${number(m.posts)} / ${number(m.ingested)}`;
    $('operations').textContent = number(
      snapshot.state.operations.filter(
        (o) => !['completed', 'failed', 'cancelled'].includes(o.state),
      ).length,
    );
    $('integrity').textContent = m.ledgerValid ? '✓ conserved' : 'Check failed';
    $('perspectiveLabel').textContent =
      $('perspective').value === 'truth' ? 'GROUND TRUTH' : 'KNOWN OBSERVATIONS';
    $('scenarioTitle').textContent =
      `${snapshot.manifest.config.scenario} · ${snapshot.manifest.config.hazard}`;
    const sceneHash = JSON.stringify([
      snapshot.state.map.buildings.map((b) => [b.state, b.damage]),
      snapshot.state.map.edges.filter((e) => !e.open).map((e) => e.id),
      snapshot.state.needs.map((n) => [n.id, n.served]),
      snapshot.state.vehicles.length,
      $('perspective').value,
      snapshot.state.observations[$('perspective').value],
    ]);
    if (changed || sceneHash !== previousSceneHash) {
      buildScene();
      previousSceneHash = sceneHash;
    }
    if (changed) {
      home();
      selected = null;
      for (const k of [
        'seed',
        'scenario',
        'grid',
        'extentKm',
        'hazard',
        'variant',
        'postsPerHour',
        'backgroundTraffic',
        'policy',
      ])
        $(k).value = snapshot.manifest.config[k];
    }
    inspect();
    showStreams();
  } catch (e) {
    if (!snapshot) {
      $('login').hidden = false;
      $('app').hidden = true;
    } else toast(e.message);
  } finally {
    busy = false;
  }
}
const examples = {
  record_claim: { text: 'Water is needed at East shelter', references: [] },
  relate_reports: { claim: 'claim-1', references: [] },
  flag_report: { post: '', state: 'unverified', reason: 'Check capture time' },
  query: { target: 'inventory' },
  verify: { target: 'building', id: 'b0', method: 'field' },
  propose: { title: 'Deliver water', plan: { need: 'need-water-main' }, conditions: [] },
  review: { id: 'proposal-1', decision: 'approve' },
  capabilities: { org: 'org1' },
  commitment: { action: 'reserve', resource: 'r-org0-water', quantity: 300, ttlMs: 900000 },
  transfer: { resource: 'r-org0-water', quantity: 100, to: 'org1' },
  dispatch: {
    vehicle: 'v-org0-0',
    resource: 'r-org0-water',
    quantity: 300,
    need: 'need-water-main',
  },
  reroute: { vehicle: 'v-org0-0', destination: 'n0' },
  repair: { edge: 'e0' },
  activate: { building: '', permit: true },
  evacuate: { from: '', to: '', vehicle: 'v-org0-0', quantity: 10 },
  purchase: { type: 'water', quantity: 100, price: 2, leadMs: 1800000 },
  share: { to: 'org1', kind: 'resource', id: 'r-org0-water' },
  correct: { id: 'claim-1', text: 'Corrected source statement' },
  cancel: { id: 'operation-1' },
  publish: { text: 'Water assistance is on the way', stage: 'en_route' },
  coverage: {},
  abstain: { reason: 'Field confirmation is pending' },
  record_outcome: { summary: 'Verified operational outcome', conditions: [], references: [] },
};
$('loginForm').onsubmit = perform(async () => {
  await api('/api/login', { key: $('key').value });
  $('key').value = '';
  await loadCatalog();
});
async function loadCatalog() {
  catalog = await api('/api/catalog');
  $('scenario').innerHTML = catalog.scenarios
    .map((s) => `<option value="${s.id}">${s.id} · ${escape(s.name)}</option>`)
    .join('');
  $('actionOrg').innerHTML = ['org0', 'org1', 'org2', 'org3']
    .map((o) => `<option>${o}</option>`)
    .join('');
  $('actionType').innerHTML = Object.keys(examples)
    .map((k) => `<option>${k}</option>`)
    .join('');
  $('actionType').value = 'dispatch';
  $('actionParams').value = JSON.stringify(examples.dispatch, null, 2);
}
$('play').onclick = perform(() => api('/api/control', { play: !snapshot.playing }));
$('step').onclick = perform(() => api('/api/control', { step: true }));
$('speed').onchange = perform(() => api('/api/control', { rate: Number($('speed').value) }));
$('home').onclick = home;
$('reset').onclick = perform(() => api('/api/config', snapshot.manifest.config));
$('configForm').onsubmit = perform(() =>
  api(
    '/api/config',
    Object.fromEntries(
      [
        'seed',
        'scenario',
        'grid',
        'extentKm',
        'hazard',
        'variant',
        'postsPerHour',
        'backgroundTraffic',
        'policy',
      ].map((k) => [
        k,
        ['grid', 'extentKm', 'postsPerHour', 'backgroundTraffic'].includes(k)
          ? Number($(k).value)
          : $(k).value,
      ]),
    ),
  ),
);
$('scenario').onchange = () =>
  ($('scenarioDescription').textContent =
    catalog.scenarios.find((s) => s.id === $('scenario').value)?.description ?? '');
$('checkpoint').onclick = perform(async () =>
  download(`checkpoint-${snapshot.runId}-${snapshot.now}.json`, await api('/api/checkpoint')),
);
$('restore').onchange = perform(async (e) =>
  api('/api/restore', JSON.parse(await e.target.files[0].text())),
);
$('metricsExport').onclick = perform(async () =>
  download(`metrics-${snapshot.runId}.json`, await api('/api/metrics')),
);
$('perspective').onchange = () => {
  buildScene();
  inspect();
  showStreams();
};
$('layers').onchange = (e) => {
  const name = e.target.dataset.layer;
  layers[name] = e.target.checked;
  if (layerGroups[name]) layerGroups[name].visible = e.target.checked;
};
$('follow').onclick = () => {
  following = !following;
  inspect();
};
$('find').onchange = () => {
  const id = $('find').value,
    kind =
      id.startsWith('v-') || id.startsWith('traffic-')
        ? 'vehicle'
        : id.startsWith('need-')
          ? 'need'
          : id.startsWith('operation-')
            ? 'operation'
            : 'building';
  select({ kind, id });
  const entity =
    kind === 'building'
      ? snapshot.state.map.buildings.find((b) => b.id === id)
      : snapshot.state.vehicles.find((v) => v.id === id);
  const n = entity?.node ? position(entity.node) : entity;
  if (n) {
    const d = new THREE.Vector3(n.x, 0, n.z).sub(controls.target);
    controls.target.add(d);
    camera.position.add(d);
  }
};
$('freeze').onclick = () => {
  frozen = !frozen;
  $('freeze').textContent = frozen ? 'Resume feed view' : 'Freeze feed view';
  showStreams();
};
$('feedFilter').oninput = showStreams;
document.querySelector('.streamGrid').onclick = (e) => {
  const card = e.target.closest('[data-id]');
  if (card) select({ kind: card.dataset.kind, id: card.dataset.id });
};
$('toggleCommand').onclick = () => $('commandDialog').showModal();
$('closeCommand').onclick = () => $('commandDialog').close();
$('actionType').onchange = () =>
  ($('actionParams').value = JSON.stringify(examples[$('actionType').value], null, 2));
$('actionForm').onsubmit = perform(async () => {
  $('actionResult').textContent = JSON.stringify(
    await api('/api/action', {
      org: $('actionOrg').value,
      action: {
        type: $('actionType').value,
        params: JSON.parse($('actionParams').value),
        idempotencyKey: `ui-${Date.now()}-${++requestCounter}`,
      },
    }),
    null,
    2,
  );
});
$('injectForm').onsubmit = perform(async () => {
  $('actionResult').textContent = JSON.stringify(
    await api('/api/inject', {
      type: $('injectType').value,
      data: JSON.parse($('injectParams').value),
    }),
    null,
    2,
  );
});
try {
  await loadCatalog();
} catch {}
await refresh();
setInterval(refresh, 1000);
