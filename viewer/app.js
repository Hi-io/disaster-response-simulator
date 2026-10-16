import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { renderComparison, stopComparison } from './comparison.js';
import { pointAlong as roadPoint } from './geometry.js';
import {
  streamModels,
  eventCard,
  postCard,
  humanize,
  entityKind,
  placeName,
} from './presentation.js';
import { MotionBuffer } from './motion.js';
import { FlowLane, MapNotices, iconHTML, applyIcons } from './flow.js';
import {
  serviceRows,
  selectionPoint,
  trackingStep,
  mapVisualKey,
  humanQueueRows,
} from './display.js';
import { mapTheme } from './theme.js';
import { englishText } from './english.js';
import {
  roadCorridors,
  corridorTrafficLevel,
  visibleRoutePlans,
  routeOverlayKey,
  fixedTopologyProfile,
} from './map-layout.js';
import { mergeViewerFrame } from './projection.js';

const $ = (id) => document.getElementById(id);
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const clock = (ms) =>
  [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
const timelineCache = new Map();
const eventCache = new Map();
const number = (n) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(n ?? 0);
let snapshot,
  viewerMap,
  activity,
  activityBusy = false,
  activitySupported = true,
  catalog,
  selected = null,
  following = false,
  playbackOverride = null,
  desiredFocusZoom = 1,
  frozen = false,
  lastRun,
  mapGroup,
  vehicleGroup;
let rayTargets = [],
  pickMap = new Map(),
  vehicleMeshes = new Map(),
  busy = false;
const layers = {
  needs: true,
  roads: true,
  hazards: true,
  network: false,
  routes: true,
  people: false,
  organizations: true,
  traffic: true,
  vehicles: true,
  notifications: true,
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const motion = new MotionBuffer();
const flowLanes = {
  reality: new FlowLane($('reality')),
  communication: new FlowLane($('communication')),
  available: new FlowLane($('ingestion')),
};
let feedScope,
  mapScope,
  trafficLines,
  vehiclePoints,
  vehicleIds = [],
  dotTexture,
  previousRouteKey;
let nodeIndex = new Map(),
  buildingIndex = new Map(),
  edgeIndex = new Map(),
  operationIndex = new Map();
const mapNotices = new MapNotices($('mapNotices'), locateNotice, projectNotice);
applyIcons();
const orgColors = mapTheme.organizations;
const trafficColors = Object.fromEntries(
  Object.entries(mapTheme.traffic).map(([key, color]) => [key, new THREE.Color(color)]),
);
let snapshotReceivedAt = performance.now();
let lastAnimationTime = performance.now();
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
  return nodeIndex.get(node);
}
function locateNotice(item) {
  const s = snapshot.state,
    id = item.location;
  if (!id) return null;
  const b = buildingIndex.get(id);
  if (b) return { x: b.x, z: b.z };
  const org = s.map.organizations.find((o) => o.id === id);
  if (org) return position(org.node);
  const n = position(id);
  if (n) return n;
  const v = vehicleMeshes.get(id);
  if (v) return { x: v.position.x, z: v.position.z };
  if ($('perspective').value !== 'truth') return null;
  const need = s.needs.find((n) => n.id === id);
  if (need) return locateNotice({ location: need.building });
  const cohort = s.cohorts.find((c) => c.id === id || c.sector === id);
  if (cohort) return position(cohort.node);
  const edge = edgeIndex.get(id);
  if (edge) return roadPoint(edge.points ?? [position(edge.from), position(edge.to)], 0.5);
  const op = operationIndex.get(id);
  if (op) return position(op.destination);
  return null;
}
function projectNotice(point) {
  const p = new THREE.Vector3(point.x, point.y ?? extent * 0.004, point.z).project(camera);
  const r = $('canvas').getBoundingClientRect();
  return {
    x: ((p.x + 1) * r.width) / 2,
    y: ((-p.y + 1) * r.height) / 2,
    visible: Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.92,
  };
}
const isPlaying = () => playbackOverride ?? snapshot?.playing ?? false;
function selectedPoint(now = performance.now()) {
  return selectionPoint(snapshot, selected, $('perspective').value, {
    vehiclePoint: (id) =>
      motion.point(id, now, { paused: !isPlaying(), reducedMotion: reducedMotion.matches }),
    events: eventCache,
  });
}
function releaseTracking() {
  following = false;
  $('canvas').dataset.tracking = '';
  $('stopTracking').hidden = true;
  $('follow').textContent = 'Track target';
}
function focusSelection() {
  following = !!selectedPoint();
  desiredFocusZoom = Math.max(
    camera.zoom,
    Math.min(12, Math.max(5, snapshot.manifest.config.grid * 0.32)),
  );
  $('stopTracking').hidden = !following;
  $('follow').textContent = following ? 'Stop tracking' : 'Track target';
  updateViewOffset();
}
function updateViewOffset() {
  if (!camera) return;
  const rect = $('canvas').getBoundingClientRect();
  if (!$('inspector').hidden) {
    const panel = $('inspector').getBoundingClientRect();
    camera.setViewOffset(
      rect.width,
      rect.height,
      innerWidth <= 720 ? 0 : (panel.width + 20) / 2,
      innerWidth <= 720 ? (panel.height + 16) / 2 : 0,
      rect.width,
      rect.height,
    );
  } else camera.clearViewOffset();
}
function updateCamera(now) {
  const elapsed = now - lastAnimationTime;
  lastAnimationTime = now;
  if (!following) return;
  const point = selectedPoint(now);
  if (!point) return releaseTracking();
  const next = trackingStep(
    controls.target,
    camera.zoom,
    point,
    desiredFocusZoom,
    elapsed,
    reducedMotion.matches,
  );
  const dx = next.x - controls.target.x,
    dz = next.z - controls.target.z;
  controls.target.x = next.x;
  controls.target.z = next.z;
  camera.position.x += dx;
  camera.position.z += dz;
  camera.zoom = next.zoom;
  camera.updateProjectionMatrix();
  $('canvas').dataset.cameraZoom = next.zoom.toFixed(2);
  $('canvas').dataset.tracking = `${selected.kind}:${selected.id}`;
}
function updateSelectionMarker(now) {
  const marker = $('selectionMarker');
  const point = selectedPoint(now);
  if (!point) {
    marker.hidden = true;
    return;
  }
  const screen = projectNotice({
    ...point,
    y: selected.kind === 'vehicle' ? vehicleMeshes.get(selected.id)?.position.y : undefined,
  });
  marker.hidden = !screen.visible;
  marker.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
}
function renderMeasurements() {
  if (!snapshot || $('measurementsDrawer').hidden) return;
  const s = snapshot.state,
    m = snapshot.metrics,
    perspective = $('perspective').value;
  const obs = perspective === 'truth' ? null : s.observations[perspective];
  $('measurementScope').textContent = obs
    ? `${s.map.organizations.find((o) => o.id === perspective)?.name} · last received observations`
    : 'Whole region · recorded world state';
  const rows = serviceRows(snapshot, perspective);
  const reports = obs
    ? Object.values(obs.population ?? {}).flatMap((r) => r.communities ?? [])
    : null;
  const deceased = obs
    ? reports.length
      ? reports.reduce((n, c) => n + c.deceased, 0)
      : null
    : m.population.deceased;
  const injured = obs
    ? reports.length
      ? reports.reduce((n, c) => n + c.injured, 0)
      : null
    : m.population.injured;
  const metricValue = (v) => (v == null ? 'Not reported' : number(v));
  $('measurements').innerHTML =
    '<h3>Needs & effective aid</h3><table class="serviceTable"><thead><tr><th>Resource</th><th>Unmet</th><th>Served</th><th>Excess</th></tr></thead><tbody>' +
    rows
      .map(
        (r) =>
          `<tr><td>${escape(humanize(r.type))}<small>${escape(r.unit ?? 'No report received')}</small></td><td>${r.reported ? number(r.pending) : '—'}</td><td>${r.reported ? number(r.served) : '—'}</td><td>${r.reported ? number(r.overprovided) : '—'}</td></tr>`,
      )
      .join('') +
    '</tbody></table><p class="muted">Service counts actual aid received. Proposals and vehicle arrivals are excluded.</p><h3>Community outcomes</h3>' +
    property('Simulated fatalities', metricValue(deceased)) +
    property('Injured · remaining', metricValue(injured)) +
    (obs
      ? ''
      : property('Water deficit · person-hours', number(m.population.waterDeficitPersonHours)) +
        property('Food deficit · person-hours', number(m.population.foodDeficitPersonHours)) +
        property('Exposure · person-hours', number(m.population.exposurePersonHours)) +
        property(
          'Untreated injuries · person-hours',
          number(m.population.untreatedInjuryPersonHours),
        )) +
    '<p class="measurementNote">Deficit person-hours = people × time without adequate supply. Health outcomes use experimental assumptions; they are simulated consequences, not measured lives saved.</p>';
  const knownOperations = obs ? Object.values(obs.operations ?? {}) : s.operations;
  const org = $('focusOrg').value;
  const view = streamModels(snapshot, org, false);
  $('informationStats').innerHTML =
    property(
      obs ? 'Recent accessible sources' : 'Reports published',
      obs ? view.communication.length : number(m.source.published),
    ) +
    property(
      obs ? 'Recent team downloads' : 'Distinct downloads',
      obs
        ? new Set(
            s.ingestion
              .filter((r) => r.org === perspective && r.stage === 'downloaded')
              .map((r) => `${r.id}:${r.version}`),
          ).size
        : number(m.information.downloaded),
    ) +
    property(
      'Active operations',
      number(
        knownOperations.filter((o) => !['completed', 'failed', 'cancelled'].includes(o.state))
          .length,
      ),
    ) +
    (obs
      ? ''
      : property(
          'Resource conservation',
          m.ledgerValid == null
            ? 'Full check on export'
            : m.ledgerValid
              ? 'Verified'
              : 'Check failed',
        ) +
        property('Queueing vehicles', number(m.physical.trafficQueue)) +
        property('Closed crossings', number(m.physical.closedCrossings)));
  const humanRows = humanQueueRows(snapshot, perspective);
  if (
    humanRows.some(
      (r) => r.queued + r.working + r.awaitingDelivery + r.completed + r.unconfirmed > 0,
    )
  ) {
    $('informationStats').innerHTML +=
      '<h3>Finite human attention</h3><table class="serviceTable"><thead><tr><th>Stage</th><th>Waiting</th><th>Busy</th><th>Done</th></tr></thead><tbody>' +
      humanRows
        .map(
          (r) =>
            `<tr><td>${escape({ read: 'Read', decide: 'Decide / review', relay: 'Relay' }[r.stage])}</td><td>${number(r.queued)}</td><td>${number(r.working + r.awaitingDelivery)}</td><td>${number(r.completed)}</td></tr>`,
        )
        .join('') +
      '</tbody></table>' +
      property(
        'Oldest task still waiting',
        clock(Math.max(...humanRows.map((r) => r.oldestQueuedMs ?? 0))),
      ) +
      property('Unconfirmed work', number(humanRows.reduce((n, r) => n + r.unconfirmed, 0))) +
      '<p class="measurementNote">These queues use declared experimental timings. Reading or approval is not physical aid received. Relay remains busy until its message arrives.</p>';
  }
}

function initialize3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(mapTheme.background);
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
  controls.addEventListener('start', releaseTracking);
  scene.add(new THREE.HemisphereLight(mapTheme.light, mapTheme.ground, 1.6));
  const sun = new THREE.DirectionalLight(mapTheme.light, 2);
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
    updateViewOffset();
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
    ray.params.Points.threshold = (extent * 0.009) / camera.zoom;
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
        pickMap.get(`${hit.object.uuid}:${hit.instanceId ?? hit.index ?? ''}`) ??
          hit.object.userData.entity,
      );
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeInspector();
      setMeasurementsOpen(false);
      setConfigOpen(false);
      setLayersOpen(false);
      return;
    }
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const d = extent * 0.04;
    const v = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[
      e.key
    ];
    if (v) {
      e.preventDefault();
      releaseTracking();
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
      $('renderStats').textContent =
        `${renderer.domElement.dataset.fps} FPS · ${renderer.info.render.calls} draw calls`;
      frames = 0;
      lastFrame = now;
    }
    updateVehicles(now);
    updateCamera(now);
    controls.update();
    updateSelectionMarker(now);
    const zoomedOut = camera.zoom < 0.55;
    if (layerGroups.buildings) layerGroups.buildings.visible = !zoomedOut;
    if (layerGroups.sectors) layerGroups.sectors.visible = zoomedOut;
    for (const label of $('labels').children) {
      const n = position(label.dataset.node);
      if (!n) continue;
      const projected = new THREE.Vector3(n.x, extent * 0.02, n.z).project(camera);
      label.style.left = `${(projected.x + 1) * 50}%`;
      label.style.top = `${(-projected.y + 1) * 50}%`;
      label.hidden =
        Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || !layers.organizations;
    }
    for (const lane of Object.values(flowLanes))
      lane.tick(now, frozen, reducedMotion.matches, isPlaying(), snapshot.rate);
    mapNotices.tick(now, layers.notifications, reducedMotion.matches, isPlaying(), snapshot.rate);
    renderer.render(scene, camera);
  };
  requestAnimationFrame(animate);
}
function home() {
  releaseTracking();
  const map = snapshot.state.map,
    mid = map.extentM / 2;
  const rect = $('canvas').getBoundingClientRect();
  const aspect = Math.max(0.1, rect.width / rect.height);
  const rise = Math.max(0.45, Math.min(1.1, 1.6 / aspect));
  const verticalProjection = rise / Math.sqrt(2 + rise * rise);
  const xs = map.geography ? map.nodes.map((n) => n.x) : [0, map.extentM];
  const zs = map.geography ? map.nodes.map((n) => n.z) : [0, map.extentM];
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = map.geography
    ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 1.2
    : map.extentM;
  extent = span * Math.max(0.7072 * verticalProjection * 1.28, (0.7072 / aspect) * 1.16);
  camera.position.set(centerX + span, span * rise, centerZ + span);
  camera.far = map.extentM * 8;
  camera.zoom = 1;
  $('canvas').dataset.cameraZoom = '1';
  $('canvas').dataset.tracking = '';
  controls.target.set(centerX, 0, centerZ);
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
    new THREE.MeshBasicMaterial({ color: mapTheme.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(map.extentM / 2, -1, map.extentM / 2);
  mapGroup.add(ground);
  const roads = subgroup('roads'),
    buildings = subgroup('buildings'),
    hazards = subgroup('hazards'),
    needs = subgroup('needs'),
    network = subgroup('network'),
    routes = subgroup('routes'),
    people = subgroup('people'),
    organizations = subgroup('organizations'),
    sectors = subgroup('sectors');
  const vertices = [],
    damaged = [],
    bridges = [];
  const corridors = roadCorridors(map.edges);
  for (const corridor of corridors) {
    const edge = corridor.edge;
    const a = position(edge.from),
      b = position(edge.to),
      closed = corridor.edges.some((e) => (obs ? obs.edges[e.id]?.open === false : !e.open));
    const target = closed ? damaged : corridor.edges.some((e) => e.bridge) ? bridges : vertices;
    const path = edge.points ?? [a, b];
    for (let i = 0; i < path.length - 1; i++)
      target.push(path[i].x, 1, path[i].z, path[i + 1].x, 1, path[i + 1].z);
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
  lines(vertices, mapTheme.road, roads);
  lines(damaged, mapTheme.coral, roads);
  lines(bridges, mapTheme.blue, roads);
  const trafficPositions = [];
  const trafficSpans = [];
  for (const corridor of corridors) {
    const edge = corridor.edge;
    const path = edge.points ?? [position(edge.from), position(edge.to)];
    const start = trafficPositions.length / 3;
    for (let i = 0; i < path.length - 1; i++) {
      trafficPositions.push(path[i].x, 3, path[i].z, path[i + 1].x, 3, path[i + 1].z);
    }
    trafficSpans.push({
      ids: corridor.edges.map((e) => e.id),
      start,
      count: trafficPositions.length / 3 - start,
      level: null,
    });
  }
  const trafficGeometry = new THREE.BufferGeometry();
  trafficGeometry.setAttribute('position', new THREE.Float32BufferAttribute(trafficPositions, 3));
  trafficGeometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(new Float32Array(trafficPositions.length), 3),
  );
  trafficLines = new THREE.LineSegments(
    trafficGeometry,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.62 }),
  );
  trafficLines.userData.spans = trafficSpans;
  subgroup('traffic').add(trafficLines);
  updateTraffic();
  if (map.river) {
    const p = map.river.points,
      verts = [];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i],
        b = p[i + 1],
        d = map.river.widthM / 2;
      verts.push(
        a.x - d,
        0,
        a.z,
        a.x + d,
        0,
        a.z,
        b.x + d,
        0,
        b.z,
        a.x - d,
        0,
        a.z,
        b.x + d,
        0,
        b.z,
        b.x - d,
        0,
        b.z,
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    mapGroup.add(
      new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: mapTheme.river, side: THREE.DoubleSide }),
      ),
    );
  }
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
        ? mapTheme.buildings.depot
        : b.use === 'shelter'
          ? mapTheme.buildings.shelter
          : b.use === 'plant'
            ? mapTheme.buildings.plant
            : mapTheme.buildings.ordinary;
    const color =
      visible?.state === 'operating'
        ? mapTheme.buildings.operating
        : visible?.damage >= 1 || visible?.state === 'damaged'
          ? mapTheme.buildings.damaged
          : base;
    const h = (b.height * scale) / 150;
    matrix.compose(
      new THREE.Vector3(b.x, h / 2, b.z),
      quaternion,
      new THREE.Vector3(
        obs && !visible ? 0 : b.width,
        obs && !visible ? 0 : h,
        obs && !visible ? 0 : b.width,
      ),
    );
    boxes.setMatrixAt(i, matrix);
    boxes.setColorAt(i, new THREE.Color(color));
    pickMap.set(`${boxes.uuid}:${i}`, { kind: 'building', id: b.id });
  });
  boxes.instanceMatrix.needsUpdate = true;
  if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
  buildings.add(boxes);
  rayTargets.push(boxes);
  const visibleNeeds = (obs ? Object.values(obs.needs) : snapshot.state.needs).filter(
    (n) => n.served < n.quantity && buildingIndex.has(n.building),
  );
  const rings = new THREE.InstancedMesh(
    new THREE.RingGeometry(0.07, 0.09, 24),
    new THREE.MeshBasicMaterial({
      color: mapTheme.coral,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    }),
    visibleNeeds.length,
  );
  const ringRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  visibleNeeds.forEach((n, i) => {
    const b = buildingIndex.get(n.building);
    const size = scale * (n.type === 'water' ? 1 : 1.24);
    matrix.compose(
      new THREE.Vector3(b.x, 3, b.z),
      ringRotation,
      new THREE.Vector3(size, size, size),
    );
    rings.setMatrixAt(i, matrix);
    pickMap.set(`${rings.uuid}:${i}`, { kind: 'need', id: n.id });
  });
  rings.instanceMatrix.needsUpdate = true;
  needs.add(rings);
  rayTargets.push(rings);
  const positions = [];
  for (const b of map.buildings) if (!obs || obs.buildings[b.id]) positions.push(b.x, 3, b.z);
  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  sectors.add(
    new THREE.Points(
      pointsGeometry,
      new THREE.PointsMaterial({ color: mapTheme.slate, size: 5, sizeAttenuation: false }),
    ),
  );
  sectors.visible = false;
  $('labels').innerHTML = map.organizations
    .map(
      (o, i) =>
        `<button class="mapLabel" data-node="${o.node}" data-org="${o.id}" style="border-left-color:${orgColors[i % orgColors.length]}">${escape(o.name)}${o.usesPlatform ? '' : ' · external partner'}</button>`,
    )
    .join('');
  for (const [i, o] of map.organizations.entries()) {
    const n = position(o.node),
      marker = new THREE.Mesh(
        new THREE.CylinderGeometry(scale * 0.055, scale * 0.055, scale * 0.08, 6),
        new THREE.MeshStandardMaterial({ color: orgColors[i % orgColors.length] }),
      );
    marker.position.set(n.x, scale * 0.04, n.z);
    marker.userData.entity = { kind: 'organization', id: o.id };
    organizations.add(marker);
    rayTargets.push(marker);
  }
  const exchanges = [];
  for (const event of snapshot.state.sharingEvents ?? []) {
    if (obs && event.to !== $('perspective').value && event.from !== $('perspective').value)
      continue;
    const a = position(map.organizations.find((o) => o.id === event.from)?.node),
      b = position(map.organizations.find((o) => o.id === event.to)?.node);
    if (a && b) exchanges.push(a.x, scale * 0.04, a.z, b.x, scale * 0.04, b.z);
  }
  if (exchanges.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(exchanges, 3));
    const lines = new THREE.LineSegments(
      geo,
      new THREE.LineDashedMaterial({
        color: mapTheme.violet,
        dashSize: scale * 0.1,
        gapSize: scale * 0.07,
        transparent: true,
        opacity: 0.35,
      }),
    );
    lines.computeLineDistances();
    organizations.add(lines);
  }
  const cohorts = (obs ? [] : snapshot.state.cohorts.filter((c) => c.population > 0)).slice(0, 500);
  const bodyPositions = [];
  cohorts.forEach((c) => {
    const n = position(c.node);
    for (let j = 0; j < 3; j++) {
      bodyPositions.push(n.x + scale * (0.14 + j * 0.025), scale * 0.017, n.z - scale * 0.1);
    }
  });
  const bodies = new THREE.BufferGeometry();
  bodies.setAttribute('position', new THREE.Float32BufferAttribute(bodyPositions, 3));
  people.add(
    new THREE.Points(
      bodies,
      new THREE.PointsMaterial({
        color: mapTheme.slate,
        size: 4,
        sizeAttenuation: false,
        map: getDotTexture(),
        transparent: true,
        alphaTest: 0.15,
      }),
    ),
  );
  const outageSectors = obs ? [] : map.sectors.filter((s) => s.coverage === 0);
  if (outageSectors.length) {
    const dots = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({
        color: mapTheme.slate,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
      }),
      outageSectors.length,
    );
    outageSectors.forEach((sector, i) => {
      const n = position(sector.node);
      matrix.compose(
        new THREE.Vector3(n.x, 2, n.z),
        ringRotation,
        new THREE.Vector3(scale * 0.18, scale * 0.18, scale * 0.18),
      );
      dots.setMatrixAt(i, matrix);
    });
    dots.instanceMatrix.needsUpdate = true;
    network.add(dots);
  }
  if (!obs)
    for (const h of snapshot.state.hazards ?? []) {
      const disk = new THREE.Mesh(
        new THREE.CircleGeometry(h.radius ?? scale, 40),
        new THREE.MeshBasicMaterial({
          color: h.kind === 'flood' ? mapTheme.blue : mapTheme.coral,
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
    vehicleMeshes.set(v.id, { position: new THREE.Vector3(), index: vehicleMeshes.size });
  }
  vehicleIds = [...vehicleMeshes.keys()];
  const dotGeometry = new THREE.BufferGeometry();
  dotGeometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(map.extentM / 2, 0, map.extentM / 2),
    map.extentM * 1.8,
  );
  dotGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(new Float32Array(vehicleIds.length * 3), 3),
  );
  dotGeometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(new Float32Array(vehicleIds.length * 3), 3),
  );
  vehiclePoints = new THREE.Points(
    dotGeometry,
    new THREE.PointsMaterial({
      vertexColors: true,
      size: 7,
      sizeAttenuation: false,
      map: getDotTexture(),
      transparent: true,
      alphaTest: 0.15,
      depthTest: false,
    }),
  );
  vehiclePoints.frustumCulled = false;
  vehicleGroup.add(vehiclePoints);
  vehicleIds.forEach((id, i) => pickMap.set(`${vehiclePoints.uuid}:${i}`, { kind: 'vehicle', id }));
  rayTargets.push(vehiclePoints);
  previousRouteKey = undefined;
  updateRoutes();
  for (const name of Object.keys(layers))
    if (layerGroups[name]) layerGroups[name].visible = layers[name];
  vehicleGroup.visible = layers.vehicles;
  layerGroups.traffic.visible = layers.traffic && layers.roads;
  updateVehicles();
}
function getDotTexture() {
  if (dotTexture) return dotTexture;
  const pixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4,
        d = Math.hypot(x - 15.5, y - 15.5);
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = Math.max(0, Math.min(255, (15 - d) * 255));
    }
  dotTexture = new THREE.DataTexture(pixels, 32, 32);
  dotTexture.needsUpdate = true;
  return dotTexture;
}
function updateTraffic() {
  if (!trafficLines) return;
  const truth = $('perspective').value === 'truth',
    obs = snapshot.state.observations[$('perspective').value];
  const attribute = trafficLines.geometry.attributes.color;
  let changed = false;
  trafficLines.userData.spans.forEach((span) => {
    const level = corridorTrafficLevel(span.ids, edgeIndex, obs?.edges, truth);
    if (level === span.level) return;
    const color = trafficColors[level];
    for (let i = span.start; i < span.start + span.count; i++)
      attribute.setXYZ(i, color.r, color.g, color.b);
    span.level = level;
    changed = true;
  });
  if (changed) attribute.needsUpdate = true;
}
function updateRoutes() {
  const group = layerGroups.routes;
  if (!group) return;
  const perspective = $('perspective').value;
  const key = routeOverlayKey(snapshot, perspective);
  if (key === previousRouteKey) return;
  for (const child of group.children) {
    child.geometry?.dispose();
    child.material?.dispose();
  }
  group.clear();
  for (const plan of visibleRoutePlans(snapshot, perspective)) {
    const points = [];
    for (const id of plan.edges) {
      const edge = edgeIndex.get(id);
      if (!edge) continue;
      const path = edge.points ?? [position(edge.from), position(edge.to)];
      for (let i = 0; i < path.length - 1; i++)
        points.push(path[i].x, 5, path[i].z, path[i + 1].x, 5, path[i + 1].z);
    }
    if (!points.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    group.add(
      new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ color: mapTheme.violet, transparent: true, opacity: 0.6 }),
      ),
    );
  }
  previousRouteKey = key;
}
function updateVehicles(now = performance.now()) {
  if (!snapshot) return;
  const truth = $('perspective').value === 'truth',
    obs = snapshot.state.observations[$('perspective').value];
  for (const v of snapshot.state.vehicles) {
    const mesh = vehicleMeshes.get(v.id);
    if (!mesh) continue;
    const p = motion.point(v.id, now, {
      paused: !isPlaying(),
      reducedMotion: reducedMotion.matches,
    });
    if (!p) continue;
    const height = (snapshot.state.map.extentM / snapshot.manifest.config.grid) * 0.022;
    mesh.position.set(p.x, height, p.z);
    const known = truth ? v : obs?.vehicles[v.id];
    const state = known?.state;
    const operation = truth ? operationIndex.get(v.operation) : null;
    const color = new THREE.Color(
      v.background
        ? mapTheme.slate
        : ['blocked', 'failed', 'spillback'].includes(state)
          ? mapTheme.amber
          : operation?.type === 'evacuation'
            ? mapTheme.violet
            : mapTheme.blue,
    );
    vehiclePoints.geometry.attributes.position.setXYZ(mesh.index, p.x, height, p.z);
    vehiclePoints.geometry.attributes.color.setXYZ(mesh.index, color.r, color.g, color.b);
  }
  if (vehiclePoints) {
    vehiclePoints.geometry.attributes.position.needsUpdate = true;
    vehiclePoints.geometry.attributes.color.needsUpdate = true;
  }
}
function select(entity) {
  if (!entity) return;
  selected = entity;
  setMeasurementsOpen(false);
  $('inspector').hidden = false;
  setConfigOpen(false);
  if (entity.kind === 'organization') {
    $('focusOrg').value = entity.id;
    $('focusOrg').onchange();
  }
  inspect();
  focusSelection();
}
function inspect() {
  if (!selected || !snapshot) return;
  const s = snapshot.state,
    obs = $('perspective').value === 'truth' ? null : s.observations[$('perspective').value];
  let e;
  if (selected.kind === 'event') {
    const candidate = eventCache.get(selected.id);
    e =
      candidate &&
      (!obs ||
        candidate.data?.to === $('perspective').value ||
        candidate.data?.org === $('perspective').value)
        ? candidate
        : null;
    $('selectionTitle').textContent = e ? eventCard(e, s).title : 'Event details';
    $('selectionHint').textContent = e
      ? `${clock(e.at)} · ${obs ? 'Received by this team' : 'Recorded world event'}`
      : 'This event is outside the recent preview.';
    for (const id of ['follow', 'nextEntity', 'fullTimeline']) $(id).hidden = true;
    $('selection').innerHTML = e
      ? `<p>${escape(eventCard(e, s).body)}</p><details><summary>Recorded data</summary><pre>${escape(JSON.stringify(e.data, null, 2))}</pre></details>`
      : '';
    return;
  }
  if (selected.kind === 'building')
    e = obs ? obs.buildings[selected.id] : s.map.buildings.find((x) => x.id === selected.id);
  if (selected.kind === 'vehicle')
    e = obs ? obs.vehicles[selected.id] : s.vehicles.find((x) => x.id === selected.id);
  if (selected.kind === 'need')
    e = obs ? obs.needs[selected.id] : s.needs.find((x) => x.id === selected.id);
  if (selected.kind === 'operation')
    e = obs ? obs.operations[selected.id] : s.operations.find((x) => x.id === selected.id);
  if (selected.kind === 'organization') e = s.map.organizations.find((x) => x.id === selected.id);
  if (selected.kind === 'post') {
    const p = feedSnapshot().state.posts.find((x) => x.public.id === selected.id);
    e =
      p &&
      (!obs ||
        p.private.audience === 'public' ||
        p.private.audience.includes($('perspective').value))
        ? p.public
        : null;
  }
  $('selectionTitle').textContent =
    selected.kind === 'post'
      ? (e?.authorName ?? 'Community report')
      : selected.kind === 'building' || selected.kind === 'organization'
        ? placeName(s, selected.id)
        : humanize(selected.kind) + ' · ' + selected.id;
  $('selectionHint').textContent = e
    ? `${selected.kind} · ${obs ? 'Known observation' : 'Ground truth'}`
    : 'No observation available to this organization.';
  $('follow').hidden = !selectedPoint();
  $('nextEntity').hidden = false;
  $('fullTimeline').hidden = !!obs;
  $('follow').textContent = following ? 'Stop tracking' : 'Track target';
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
          'fuelUnit',
          'passengers',
          'eta',
          'name',
          'sharing',
          'usesPlatform',
          'node',
          'at',
          'version',
          'deadline',
          'destination',
        ];
  let html = keys
    .filter((k) => e[k] !== undefined)
    .map((k) =>
      property(
        humanize(k),
        ['publishedAt', 'eta', 'deadline', 'at'].includes(k) && typeof e[k] === 'number'
          ? clock(e[k])
          : typeof e[k] === 'object'
            ? JSON.stringify(e[k])
            : e[k],
      ),
    )
    .join('');
  if (selected.kind === 'post') {
    html =
      `<div class="inspectorPost"><div class="author"><span class="avatar">${iconHTML('user-round')}</span><div><strong>${escape(e.authorName)}</strong><div class="muted">${escape(e.format === 'audio' ? 'Voice note' : humanize(e.format))} · ${clock(e.publishedAt)}</div></div></div><p>${escape(englishText(e.text))}</p>${(e.attachments ?? []).map((a) => `<div class="mediaBlock">${iconHTML(a.kind === 'audio' ? 'mic' : a.kind === 'video' ? 'play' : 'file-text')}<span>${escape(humanize(a.kind))}${a.duration ? ` · ${a.duration}s` : ''}<br>${escape(englishText(a.description))}</span></div>`).join('')}</div>` +
      property('Location reported', e.location ?? 'Not specified') +
      property('Source version', e.version) +
      (englishText(e.text) !== e.text
        ? `<details><summary>Original source text</summary><p lang="${escape(e.language ?? 'es')}">${escape(e.text)}</p></details>`
        : '');
  }
  if (e.dependencies)
    html +=
      '<h2>Dependencies</h2>' +
      Object.entries(e.dependencies)
        .map(
          ([k, v]) =>
            `<div class="dependency">${escape(k)} · ${number(e.provisioned?.[k] ?? 0)} / ${number(v)}</div>`,
        )
        .join('');
  if (!obs && selected.kind === 'building') {
    const community = s.cohorts.filter((c) => c.sector === e.sector);
    html +=
      '<h2>Surrounding community</h2>' +
      property(
        'Alive / deceased',
        `${number(community.reduce((n, c) => n + c.population, 0))} / ${number(community.reduce((n, c) => n + (c.deceased ?? 0), 0))}`,
      ) +
      property('Injured', number(community.reduce((n, c) => n + (c.health?.injured ?? 0), 0))) +
      property(
        'Water deficit · person-hours',
        number(community.reduce((n, c) => n + (c.health?.waterDeficitPersonMs ?? 0) / 3600000, 0)),
      ) +
      property(
        'Food deficit · person-hours',
        number(community.reduce((n, c) => n + (c.health?.foodDeficitPersonMs ?? 0) / 3600000, 0)),
      ) +
      '<p class="muted">Sector totals · experimental population model.</p>';
  }
  if (selected.kind === 'building') {
    const needs = (obs ? Object.values(obs.needs) : s.needs).filter(
      (n) => n.building === selected.id,
    );
    if (needs.length)
      html +=
        '<h2>Requests at this location</h2>' +
        needs
          .map(
            (n) =>
              `<button class="inspectNeed" data-need="${escape(n.id)}">${escape(humanize(n.type))} · ${number(Math.max(0, n.quantity - n.served))} ${escape(n.unit)} still needed</button>`,
          )
          .join('');
  }
  if (e.times)
    html +=
      '<h2>Operation milestones</h2>' +
      Object.entries(e.times)
        .map(([stage, at]) => property(stage, clock(at)))
        .join('');
  if (selected.kind === 'vehicle' && !obs && e.operation) {
    const op = s.operations.find((o) => o.id === e.operation);
    if (op)
      html += `<button class="inspectOperation" data-operation="${op.id}">Inspect ${escape(op.id)} →</button>`;
  }
  if (selected.kind === 'post' && !obs) {
    const p = s.posts.find((x) => x.public.id === selected.id);
    html +=
      '<details><summary>Observer provenance · hidden from teams</summary>' +
      property('Truth category', p.private.truthCategory) +
      property('Causal event', p.private.causeEvent) +
      property('Physical location', p.private.actualLocation) +
      property('Original source', p.private.original) +
      '</details>';
  }
  if (!obs) {
    const archive = timelineCache.get(selected.id);
    const history = archive
      ? archive.events
      : snapshot.events
          .filter(
            (ev) => ev.entity === selected.id || JSON.stringify(ev.data).includes(selected.id),
          )
          .slice(-12);
    html +=
      (archive
        ? `<details open><summary>Archived history</summary><p class="muted">${archive.events.length ? archive.offset + 1 : 0}–${archive.offset + archive.events.length} of ${archive.total} events · newest first within this page</p>
           <button data-history-offset="${Math.max(0, archive.offset - 200)}" ${archive.offset === 0 ? 'disabled' : ''}>Earlier page</button>
           <button data-history-offset="${archive.next ?? 0}" ${archive.next === null ? 'disabled' : ''}>Later page</button>`
        : '<details><summary>Recent activity</summary>') +
      history
        .slice()
        .reverse()
        .map(
          (ev) =>
            `<div class="timelineEntry">${clock(ev.at)}<strong>${escape(eventCard(ev, s).title)}</strong>${escape(eventCard(ev, s).body)}<details><summary>Recorded data</summary><pre>${escape(JSON.stringify(ev.data, null, 2))}</pre></details></div>`,
        )
        .join('') +
      '</details>';
  }
  $('selection').innerHTML = html;
}
function feedSnapshot() {
  if (
    !activity ||
    !snapshot ||
    activity.runId !== snapshot.runId ||
    activity.now < snapshot.now ||
    activity.org !== $('focusOrg').value ||
    activity.perspective !== $('perspective').value
  )
    return snapshot;
  return {
    ...snapshot,
    ...activity,
    state: {
      ...snapshot.state,
      ...activity.state,
      observations: { ...snapshot.state.observations, ...activity.state.observations },
    },
  };
}
async function refreshActivity() {
  if (!snapshot || activityBusy || !activitySupported || document.hidden) return;
  const org = $('focusOrg').value,
    perspective = $('perspective').value;
  activityBusy = true;
  try {
    const response = await fetch(
      `/api/activity?org=${encodeURIComponent(org)}&perspective=${encodeURIComponent(perspective)}`,
    );
    if (response.status === 404 || response.status === 405) {
      activitySupported = false; // Older API servers still support the full observer.
      return;
    }
    if (!response.ok) return;
    const data = await response.json();
    if (
      data.runId !== snapshot.runId ||
      org !== $('focusOrg').value ||
      perspective !== $('perspective').value
    )
      return;
    activity = { ...data, org, perspective };
    showStreams();
    if (selected?.kind === 'post') inspect();
  } catch {
    // The full observer keeps working; retry the lightweight channel next tick.
  } finally {
    activityBusy = false;
  }
}
function showStreams() {
  const current = feedSnapshot();
  if (!snapshot) return;
  const filter = $('feedFilter').value.toLowerCase(),
    truth = $('perspective').value === 'truth';
  const org = $('focusOrg').value;
  const telemetry = $('showTelemetry').checked;
  const discoverable = $('showDiscoverable').checked;
  const models = streamModels(current, org, truth, { telemetry });
  const teamItems = discoverable ? models.available : models.received;
  const visibleModels = { ...models, available: teamItems };
  for (const item of models.reality.concat(models.available))
    if (item.raw?.type) {
      const key = eventCard(item.raw, current.state).key;
      eventCache.delete(key);
      eventCache.set(key, item.raw);
    }
  while (eventCache.size > 500) eventCache.delete(eventCache.keys().next().value);
  const name = snapshot.state.map.organizations.find((o) => o.id === org)?.name ?? 'your team';
  const scope = `${snapshot.runId}:${$('perspective').value}:${org}:${filter}:${telemetry}:${discoverable}`;
  const mapCards = truth
    ? models.reality
        .filter(
          (m) => !['signal_created', 'post_published', 'ingestion_receipt'].includes(m.raw.type),
        )
        .concat(models.communication)
        .sort((a, b) => a.at - b.at)
    : models.received
        .filter((m) => m.location)
        .concat(models.communication)
        .sort((a, b) => a.at - b.at);
  for (const [id, lane] of Object.entries(flowLanes)) {
    const items = visibleModels[id].filter(
      (m) => !filter || JSON.stringify(m).toLowerCase().includes(filter),
    );
    if (scope !== feedScope)
      lane.reset(
        items,
        id === 'reality' && !truth
          ? 'World truth is hidden. Only received observations are shown on the map.'
          : id === 'available'
            ? discoverable
              ? 'No discoverable sources or received reports yet.'
              : 'No reports received yet. Public sources can be fetched through the source API.'
            : 'No events in this recent window.',
      );
    else if (!frozen) lane.accept(items);
  }
  const nextMapScope = `${snapshot.runId}:${$('perspective').value}:${org}:${telemetry}`;
  if (nextMapScope !== mapScope) mapNotices.reset(mapCards);
  else mapNotices.accept(mapCards);
  mapScope = nextMapScope;
  feedScope = scope;
  $('availableTitle').textContent = `${discoverable ? 'Available to' : 'Received by'} ${name}`;
  $('availableTitle').title = discoverable
    ? 'Consultable public sources, known reports and connector receipts. Availability is not consumption.'
    : 'Delivered team reports, known operational data and actual connector receipts. No automatic AI filtering.';
  $('availableCount').textContent = '';
  $('realityCount').textContent = truth ? '' : 'Ground truth hidden';
  $('communicationCount').textContent = '';
  $('feedCount').textContent = truth
    ? `${number(current.totals.posts)} signals · ${number(current.totals.ingestion)} connector receipts`
    : `${number(models.communication.length)} recent sources · ${number(current.state.ingestion.filter((r) => r.org === org).length)} recent team receipts`;
  const skipped = Object.values(flowLanes).reduce((n, lane) => n + lane.queue.skipped, 0);
  $('presentationNote').textContent =
    `Live visual sample · ${skipped ? `${number(skipped)} updates omitted from animation · ` : ''}full history retained. Available ≠ downloaded ≠ understood.`;
}
let previousSceneHash;
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const previousTime = snapshot?.now;
    const scope = `?org=${encodeURIComponent($('focusOrg').value || 'org0')}&perspective=${encodeURIComponent($('perspective').value || 'truth')}`;
    let frame;
    if (!viewerMap) {
      const bootstrap = await api('/api/viewer/bootstrap' + scope);
      viewerMap = bootstrap.map;
      frame = bootstrap.frame;
    } else {
      frame = await api('/api/viewer/frame' + scope);
      if (viewerMap.projectionId !== frame.mapId) {
        const bootstrap = await api('/api/viewer/bootstrap' + scope);
        viewerMap = bootstrap.map;
        frame = bootstrap.frame;
      }
    }
    snapshot = mergeViewerFrame(viewerMap, frame);
    if (playbackOverride === snapshot.playing) playbackOverride = null;
    nodeIndex = new Map(snapshot.state.map.nodes.map((n) => [n.id, n]));
    buildingIndex = new Map(snapshot.state.map.buildings.map((b) => [b.id, b]));
    edgeIndex = new Map(snapshot.state.map.edges.map((e) => [e.id, e]));
    operationIndex = new Map(snapshot.state.operations.map((o) => [o.id, o]));
    snapshotReceivedAt = performance.now();
    $('login').hidden = true;
    $('app').hidden = false;
    if (!renderer) initialize3D();
    const changed = snapshot.runId !== lastRun || snapshot.now < previousTime;
    if (changed) {
      activity = null;
      motion.reset();
      feedScope = null;
      mapScope = null;
      closeInspector();
      setMeasurementsOpen(false);
      timelineCache.clear();
      eventCache.clear();
      const previous = $('perspective').value;
      $('perspective').innerHTML =
        '<option value="truth">Observer · ground truth</option>' +
        snapshot.state.map.organizations
          .map((o) => `<option value="${o.id}">${escape(o.name)} · known state</option>`)
          .join('');
      $('perspective').value = snapshot.state.map.organizations.some((o) => o.id === previous)
        ? previous
        : 'truth';
      $('actionOrg').innerHTML = snapshot.state.map.organizations
        .map((o) => `<option value="${o.id}">${escape(o.name)}</option>`)
        .join('');
      const focus = $('focusOrg').value;
      $('focusOrg').innerHTML = snapshot.state.map.organizations
        .map((o) => `<option value="${o.id}">${escape(o.name)}</option>`)
        .join('');
      $('focusOrg').value = snapshot.state.map.organizations.some((o) => o.id === focus)
        ? focus
        : snapshot.state.map.organizations[0]?.id;
    }
    const geographic = snapshot.state.map.geography;
    const geographicSummary =
      snapshot.state.map.topology === 'takamatsu'
        ? '100 km² · 4,300 synthetic community sites'
        : 'Synthetic facilities & emergency scenario';
    $('mapAttribution').hidden = !geographic;
    $('mapAttribution').innerHTML = geographic
      ? `<strong>${escape(geographic.name)}</strong><span>${escape(geographicSummary)}</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Map data © OpenStreetMap contributors · ODbL</a>`
      : '';
    motion.accept(snapshot, snapshotReceivedAt, $('perspective').value);
    lastRun = snapshot.runId;
    $('clock').textContent = clock(snapshot.now);
    $('play').textContent = snapshot.playing ? 'Pause' : 'Play';
    $('speed').value = snapshot.rate;
    $('runId').textContent =
      `${snapshot.continuousDemo ? 'continuous demo' : 'run'} ${snapshot.runId.slice(0, 8)}`;
    $('runId').title = snapshot.continuousDemo
      ? 'Continuous demonstration. This run is not eligible for benchmark comparisons.'
      : 'Finite seeded simulation run';
    $('sourceLink').href = snapshot.sourceUrl + '/feed';
    $('effective').textContent =
      `${number(snapshot.playing ? snapshot.effectiveRate : 0)}× effective`;
    renderMeasurements();
    $('scenarioTitle').textContent = `${humanize(snapshot.manifest.config.hazard)} simulation`;
    const sceneHash = mapVisualKey(snapshot, $('perspective').value, { includeRoutes: false });
    if (changed || sceneHash !== previousSceneHash) {
      buildScene();
      previousSceneHash = sceneHash;
    }
    updateTraffic();
    updateRoutes();
    if (changed) {
      home();
      selected = null;
      following = false;
      timelineCache.clear();
      $('selectionTitle').textContent = 'Explore the world.';
      $('selectionHint').textContent =
        'Choose a building or vehicle. Its state, dependencies and timeline appear here.';
      $('selection').innerHTML = '';
      for (const id of ['follow', 'nextEntity', 'fullTimeline']) $(id).hidden = true;
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
        'topology',
        'organizations',
      ])
        $(k).value = snapshot.manifest.config[k];
      $('humanProfile').value = snapshot.manifest.config.humanCapacity?.profile ?? 'zero';
      updateTopologyControls();
    }
    inspect();
    showStreams();
    if ($('comparisonDialog').open && snapshot.comparison) {
      const pair = await api('/api/compare?pair=1');
      if (!pair) return;
      const { a, b: other } = pair;
      renderComparison(a, other);
      $('compareATitle').textContent = 'A · ' + a.manifest.config.policy;
      $('compareBTitle').textContent = 'B · ' + other.manifest.config.policy;
      for (const [name, data] of [
        ['A', a],
        ['B', other],
      ])
        $(`compare${name}Metrics`).textContent =
          `${clock(data.now)} · ${number(data.metrics.services.water?.served)} L served · ${number(data.metrics.services.water?.pending)} L pending · ${number(data.metrics.population.deceased)} simulated fatalities`;
      $('comparisonStatus').textContent =
        `Paired initial map ${a.state.map.hash.slice(0, 12)} · equal physical endowment · ${a.now === other.now ? 'clocks synchronized' : 'clock catching up'}`;
    }
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
  human_work: { stage: 'read', reference: { kind: 'post', id: 'public-source-id', version: 1 } },
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
  $('actionType').innerHTML = Object.keys(examples)
    .map((k) => `<option>${k}</option>`)
    .join('');
  $('actionType').value = 'dispatch';
  $('actionParams').value = JSON.stringify(examples.dispatch, null, 2);
}
$('play').onclick = perform(async () => {
  setConfigOpen(false);
  const next = !isPlaying();
  playbackOverride = next;
  $('play').textContent = next ? 'Pause' : 'Play';
  if (!next)
    for (const lane of Object.values(flowLanes))
      lane.tick(performance.now(), frozen, reducedMotion.matches, false, snapshot.rate);
  try {
    await api('/api/control', { play: next });
  } catch (error) {
    playbackOverride = null;
    throw error;
  }
});
$('step').onclick = perform(() => api('/api/control', { step: true }));
$('speed').onchange = perform(() => api('/api/control', { rate: Number($('speed').value) }));
$('home').onclick = home;
$('reset').onclick = perform(async () => {
  await api('/api/config', snapshot.manifest.config);
  lastRun = null;
});
$('configForm').onsubmit = perform(async () => {
  const fields = [
    'seed',
    'scenario',
    'grid',
    'extentKm',
    'hazard',
    'variant',
    'postsPerHour',
    'backgroundTraffic',
    'policy',
    'topology',
    'organizations',
  ];
  const overrides = JSON.parse($('advancedConfig').value);
  if (
    Object.hasOwn(overrides, 'humanCapacity') &&
    (!overrides.humanCapacity ||
      typeof overrides.humanCapacity !== 'object' ||
      Array.isArray(overrides.humanCapacity))
  )
    throw new Error('humanCapacity must be a JSON object.');
  await api('/api/config', {
    language: 'en',
    ...Object.fromEntries(
      fields.map((k) => [
        k,
        ['grid', 'extentKm', 'postsPerHour', 'backgroundTraffic', 'organizations'].includes(k)
          ? Number($(k).value)
          : $(k).value,
      ]),
    ),
    ...overrides,
    humanCapacity: { ...overrides.humanCapacity, profile: $('humanProfile').value },
  });
  lastRun = null;
  setConfigOpen(false);
});
$('advanceForm').onsubmit = perform(async () => {
  const parts = $('advanceTime').value.split(':').map(Number);
  if (
    parts.length !== 3 ||
    parts.some((n) => !Number.isFinite(n)) ||
    parts[1] > 59 ||
    parts[2] > 59
  )
    throw new Error('Use HH:MM:SS');
  await api('/api/control', { advanceTo: ((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000 });
});
$('nextEntity').onclick = perform(() => api('/api/control', { nextRelevant: selected.id }));
async function loadTimeline(offset = 0) {
  if (!selected || $('perspective').value !== 'truth') return;
  const id = selected.id,
    runId = snapshot.runId;
  const rows = await api('/api/events?entity=' + encodeURIComponent(id) + '&offset=' + offset);
  if (snapshot.runId !== runId) return;
  timelineCache.delete(id);
  if (timelineCache.size >= 20) timelineCache.delete(timelineCache.keys().next().value);
  timelineCache.set(id, { ...rows, offset });
  if (selected?.id === id) inspect();
}
$('fullTimeline').onclick = perform(() => loadTimeline());
$('selection').onclick = (e) => {
  const page = e.target.closest('[data-history-offset]');
  if (page) return perform(() => loadTimeline(Number(page.dataset.historyOffset)))();
  const op = e.target.closest('[data-operation]');
  if (op) select({ kind: 'operation', id: op.dataset.operation });
  const need = e.target.closest('[data-need]');
  if (need) select({ kind: 'need', id: need.dataset.need });
};
$('labels').onclick = (e) => {
  const org = e.target.closest('[data-org]');
  if (org) select({ kind: 'organization', id: org.dataset.org });
};
$('openComparison').onclick = () => {
  $('comparisonDialog').showModal();
};
$('closeComparison').onclick = () => {
  $('comparisonDialog').close();
  stopComparison();
};
$('comparisonForm').onsubmit = perform(() =>
  api('/api/comparison', { policyA: $('policyA').value, policyB: $('policyB').value }),
);
$('comparePlay').onclick = perform(() => api('/api/control', { play: !snapshot.playing }));
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
$('exportMeasurements').onclick = $('metricsExport').onclick;
$('perspective').onchange = async () => {
  if ($('perspective').value !== 'truth') $('focusOrg').value = $('perspective').value;
  motion.reset();
  feedScope = null;
  previousSceneHash = null;
  await refresh();
  await refreshActivity();
};
$('focusOrg').onchange = () => {
  if ($('perspective').value !== 'truth') {
    $('perspective').value = $('focusOrg').value;
    $('perspective').onchange();
  } else {
    feedScope = null;
    refresh();
    refreshActivity();
  }
};
$('layers').onchange = (e) => {
  const name = e.target.dataset.layer;
  if (!name) return;
  layers[name] = e.target.checked;
  if (layerGroups[name]) layerGroups[name].visible = e.target.checked;
  if (name === 'vehicles') vehicleGroup.visible = layers.vehicles;
  if (name === 'notifications')
    $('toggleEvents').setAttribute('aria-pressed', String(layers.notifications));
  if (name === 'roads') {
    layerGroups.traffic.visible = layers.traffic && layers.roads;
  }
  if (name === 'traffic') {
    layerGroups.traffic.visible = layers.traffic && layers.roads;
  }
};
$('follow').onclick = () => {
  if (following) releaseTracking();
  else focusSelection();
  inspect();
};
function findEntity() {
  const id = $('find').value.trim();
  if (id) select({ kind: entityKind(id), id });
}
$('find').onchange = findEntity;
$('find').onkeydown = (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    findEntity();
  }
};
$('freeze').onclick = () => {
  frozen = !frozen;
  $('freeze').innerHTML = iconHTML(frozen ? 'play' : 'pause');
  $('freeze').setAttribute('aria-label', frozen ? 'Resume feed view' : 'Freeze feed view');
  $('freeze').setAttribute('aria-pressed', String(frozen));
  showStreams();
};
$('feedFilter').oninput = showStreams;
$('showTelemetry').onchange = showStreams;
$('showDiscoverable').onchange = showStreams;
document.querySelector('.streamGrid').onclick = (e) => {
  const card = e.target.closest('[data-id]');
  if (card) select({ kind: card.dataset.kind, id: card.dataset.id });
};
$('mapNotices').onclick = (e) => {
  const card = e.target.closest('[data-id]');
  if (card) select({ kind: card.dataset.kind, id: card.dataset.id });
};
function setConfigOpen(open) {
  $('configDrawer').hidden = !open;
  $('toggleConfig').setAttribute('aria-expanded', String(open));
  $('toggleConfig').setAttribute('aria-label', open ? 'Close configuration' : 'Open configuration');
  if (open) {
    closeInspector();
    setMeasurementsOpen(false);
    setLayersOpen(false);
  }
}
function closeInspector() {
  $('inspector').hidden = true;
  selected = null;
  releaseTracking();
  updateViewOffset();
}
function setMeasurementsOpen(open) {
  $('measurementsDrawer').hidden = !open;
  $('openMeasurements').setAttribute('aria-expanded', String(open));
  if (open) {
    closeInspector();
    setConfigOpen(false);
    setLayersOpen(false);
    renderMeasurements();
  }
}
function setLayersOpen(open) {
  $('layerPopover').hidden = !open;
  $('openLayers').setAttribute('aria-expanded', String(open));
}
$('toggleConfig').onclick = () => setConfigOpen($('configDrawer').hidden);
$('closeConfig').onclick = () => setConfigOpen(false);
$('closeInspector').onclick = closeInspector;
$('stopTracking').onclick = releaseTracking;
$('openMeasurements').onclick = () => setMeasurementsOpen($('measurementsDrawer').hidden);
$('closeMeasurements').onclick = () => setMeasurementsOpen(false);
$('openLayers').onclick = () => setLayersOpen($('layerPopover').hidden);
$('toggleEvents').onclick = () => {
  layers.notifications = !layers.notifications;
  $('layers').querySelector('[data-layer="notifications"]').checked = layers.notifications;
  $('toggleEvents').setAttribute('aria-pressed', String(layers.notifications));
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
// Geometry is fetched once. Compact latest-state frames can skip intermediate
// samples without losing changes; hidden tabs do not request any frames.
async function pollSnapshot() {
  if (!document.hidden) await refresh();
  setTimeout(pollSnapshot, 750);
}
setTimeout(pollSnapshot, 1000);
async function pollActivity() {
  await refreshActivity();
  if (activitySupported) setTimeout(pollActivity, document.hidden ? 1000 : isPlaying() ? 150 : 500);
}
pollActivity();

function updateTopologyControls() {
  const profile = fixedTopologyProfile($('topology').value);
  const fixed = !!profile;
  $('grid').disabled = fixed;
  $('extentKm').disabled = fixed;
  $('geographicHint').hidden = !fixed;
  if (fixed) {
    $('grid').value = profile.grid;
    $('extentKm').value = profile.extentKm;
    $('geographicHint').textContent = profile.hint;
  }
}
$('topology').addEventListener('change', updateTopologyControls);
