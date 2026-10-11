import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { renderComparison, stopComparison } from './comparison.js';

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
const roadPoint = (points, t) => {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.z - points[i].z)),
    total = lengths.reduce((a, b) => a + b, 0);
  let distance = total * t;
  for (let i = 0; i < lengths.length; i++)
    if (distance <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] ? distance / lengths[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * f,
        z: points[i].z + (points[i + 1].z - points[i].z) * f,
      };
    } else distance -= lengths[i];
  return points[0];
};
const timelineCache = new Map();
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
const layers = {
  needs: true,
  roads: true,
  hazards: true,
  network: false,
  routes: true,
  people: false,
  organizations: true,
};
const orgColors = ['#617ad0', '#9276be', '#639aaa', '#bf9469', '#7b9d82'];
let snapshotReceivedAt = performance.now();
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
      $('renderStats').textContent =
        `${renderer.domElement.dataset.fps} FPS · ${renderer.info.render.calls} draw calls`;
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
    routes = subgroup('routes'),
    people = subgroup('people'),
    organizations = subgroup('organizations'),
    sectors = subgroup('sectors');
  const vertices = [],
    damaged = [],
    bridges = [];
  for (const edge of map.edges) {
    if (edge.from > edge.to) continue;
    const a = position(edge.from),
      b = position(edge.to),
      known = obs?.edges[edge.id];
    const target = (obs ? known?.open === false : !edge.open)
      ? damaged
      : edge.bridge
        ? bridges
        : vertices;
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
  lines(vertices, '#c6d2e2', roads);
  lines(damaged, '#ce7a69', roads);
  lines(bridges, '#6a84a9', roads);
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
        new THREE.MeshBasicMaterial({ color: '#b8d4e8', side: THREE.DoubleSide }),
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
  for (const n of obs ? Object.values(obs.needs) : snapshot.state.needs) {
    if (n.served >= n.quantity) continue;
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
  const positions = [];
  for (const b of map.buildings) if (!obs || obs.buildings[b.id]) positions.push(b.x, 3, b.z);
  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  sectors.add(
    new THREE.Points(
      pointsGeometry,
      new THREE.PointsMaterial({ color: '#7f91b9', size: 5, sizeAttenuation: false }),
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
        color: '#a08bd0',
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
  const bodies = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 6, 4),
    new THREE.MeshStandardMaterial({ color: '#a3b0c7' }),
    cohorts.length * 3,
  );
  cohorts.forEach((c, i) => {
    const n = position(c.node);
    for (let j = 0; j < 3; j++) {
      matrix.compose(
        new THREE.Vector3(n.x + scale * (0.14 + j * 0.025), scale * 0.017, n.z - scale * 0.1),
        quaternion,
        new THREE.Vector3(scale * 0.01, scale * 0.017, scale * 0.01),
      );
      bodies.setMatrixAt(i * 3 + j, matrix);
    }
  });
  people.add(bodies);
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
    if (layers.routes && v.route?.length && !v.background && !obs) {
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
        t = Math.max(
          0,
          Math.min(
            1,
            (snapshot.now +
              (snapshot.playing
                ? (performance.now() - snapshotReceivedAt) * snapshot.effectiveRate
                : 0) -
              v.edgeStart) /
              (v.edgeEnd - v.edgeStart),
          ),
        );
      const point = roadPoint(edge.points ?? [n, to], t);
      x = point.x;
      z = point.z;
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
    e = obs ? obs.operations[selected.id] : s.operations.find((x) => x.id === selected.id);
  if (selected.kind === 'organization') e = s.map.organizations.find((x) => x.id === selected.id);
  if (selected.kind === 'post') {
    const p = s.posts.find((x) => x.public.id === selected.id);
    e =
      p &&
      (!obs ||
        p.private.audience === 'public' ||
        p.private.audience.includes($('perspective').value))
        ? p.public
        : null;
  }
  $('selectionTitle').textContent = selected.id;
  $('selectionHint').textContent = e
    ? `${selected.kind} · ${obs ? 'Known observation' : 'Ground truth'}`
    : 'No observation available to this organization.';
  $('follow').hidden = selected.kind !== 'vehicle';
  $('nextEntity').hidden = false;
  $('fullTimeline').hidden = !!obs;
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
  if (!obs && selected.kind === 'building') {
    const community = s.cohorts.filter((c) => c.sector === e.sector);
    html +=
      '<h2>Community outcomes · experimental</h2>' +
      community
        .map(
          (c) =>
            property('Alive / deceased', `${c.population} / ${c.deceased ?? 0}`) +
            property('Injured', c.health?.injured ?? 0) +
            property('Water deficit', `${number((c.health?.dehydrationMs ?? 0) / 3600000)} h`) +
            property('Food deficit', `${number((c.health?.hungerMs ?? 0) / 3600000)} h`),
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
      '<h2>Observer provenance</h2>' +
      property('Truth category', p.private.truthCategory) +
      property('Causal event', p.private.causeEvent) +
      property('Physical location', p.private.actualLocation) +
      property('Original source', p.private.original);
  }
  if (!obs) {
    const history = timelineCache.get(selected.id) ?? snapshot.events;
    html +=
      '<h2>Timeline</h2>' +
      history
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
    s.posts.filter(
      (p) =>
        p.public.publishedAt !== null &&
        (truth ||
          p.private.audience === 'public' ||
          p.private.audience.includes($('perspective').value)),
    ),
    (p) =>
      `<div class="feedCard ${truth && p.private.false ? 'false' : ''}" data-kind="post" data-id="${p.public.id}"><small><span>${escape(p.public.authorName)} · ${escape(p.public.format)}</span><span>${clock(p.public.publishedAt)}</span></small><p>${escape(p.public.text)}</p>${p.public.attachments.map((a) => `<div class="media">${a.kind === 'video' ? '▶' : a.kind === 'audio' ? '◖' : '▧'} ${escape(a.kind)} · ${escape(a.description)}</div>`).join('')}${truth && p.private.false ? '<p>Observer label · inaccurate / misleading</p>' : ''}</div>`,
  );
  $('ingestion').innerHTML = cards(
    s.ingestion.filter((r) => truth || r.org === $('perspective').value),
    (r) =>
      `<div class="feedCard" data-kind="post" data-id="${r.id}"><small><span>${escape(r.org)} · ${escape(r.stage)}</span><span>${clock(r.at)}</span></small><p>${escape(r.reason ?? r.id)}</p></div>`,
  );
  $('feedCount').textContent =
    `${number(snapshot.totals.posts)} signals created · ${number(snapshot.metrics.eventCounts.post_published)} published · ${number(snapshot.totals.ingestion)} receipts · window: 80 per column`;
}
let previousSceneHash;
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    snapshot = await api('/api/state');
    snapshotReceivedAt = performance.now();
    $('login').hidden = true;
    $('app').hidden = false;
    if (!renderer) initialize3D();
    const changed = snapshot.runId !== lastRun;
    if (changed) {
      timelineCache.clear();
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
    }
    lastRun = snapshot.runId;
    $('clock').textContent = clock(snapshot.now);
    $('play').textContent = snapshot.playing ? 'Pause' : 'Play';
    $('speed').value = snapshot.rate;
    $('runId').textContent = `run ${snapshot.runId.slice(0, 8)}`;
    $('sourceLink').href = snapshot.sourceUrl + '/feed';
    $('effective').textContent = `${number(snapshot.effectiveRate)}× effective`;
    const m = snapshot.metrics;
    const knowledge =
      $('perspective').value === 'truth'
        ? null
        : snapshot.state.observations[$('perspective').value];
    const knownWater = knowledge
      ? Object.values(knowledge.needs).filter((n) => n.type === 'water')
      : null;
    $('pendingWater').textContent =
      number(
        knownWater
          ? knownWater.reduce((t, n) => t + Math.max(0, n.quantity - n.served), 0)
          : m.services.water?.pending,
      ) + ' L';
    $('servedWater').textContent =
      number(
        knownWater
          ? knownWater.reduce((t, n) => t + Math.min(n.quantity, n.served), 0)
          : m.services.water?.served,
      ) + ' L';
    $('signals').textContent =
      `${number(m.source.published)} / ${number(m.information.downloaded)}`;
    $('operations').textContent = number(
      (knowledge ? Object.values(knowledge.operations) : snapshot.state.operations).filter(
        (o) => !['completed', 'failed', 'cancelled'].includes(o.state),
      ).length,
    );
    $('integrity').textContent = knowledge
      ? 'known state'
      : m.ledgerValid
        ? '✓ conserved'
        : 'Check failed';
    const reports = knowledge
      ? Object.values(knowledge.population ?? {}).flatMap((r) => r.communities)
      : null;
    $('fatalities').textContent = reports?.length
      ? number(reports.reduce((n, c) => n + c.deceased, 0))
      : knowledge
        ? 'unknown'
        : number(m.population.deceased);
    $('injured').textContent = reports?.length
      ? number(reports.reduce((n, c) => n + c.injured, 0))
      : knowledge
        ? 'unknown'
        : number(m.population.injured);
    $('waterExposure').textContent = knowledge
      ? 'observer only'
      : number(m.population.waterDeficitPersonHours);
    $('foodExposure').textContent = knowledge
      ? 'observer only'
      : number(m.population.foodDeficitPersonHours);
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
        'topology',
      ])
        $(k).value = snapshot.manifest.config[k];
    }
    inspect();
    showStreams();
    if ($('comparisonDialog').open && snapshot.comparison) {
      const other = await api('/api/compare');
      renderComparison(snapshot, other);
      $('compareATitle').textContent = 'A · ' + snapshot.manifest.config.policy;
      $('compareBTitle').textContent = 'B · ' + other.manifest.config.policy;
      for (const [name, data] of [
        ['A', snapshot],
        ['B', other],
      ])
        $(`compare${name}Metrics`).textContent =
          `${clock(data.now)} · ${number(data.metrics.services.water?.served)} L served · ${number(data.metrics.services.water?.pending)} L pending · ${number(data.metrics.population.deceased)} simulated fatalities`;
      $('comparisonStatus').textContent =
        `Paired initial map ${snapshot.state.map.hash.slice(0, 12)} · equal physical endowment · ${snapshot.now === other.now ? 'clocks synchronized' : 'clock catching up'}`;
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
        'topology',
      ].map((k) => [
        k,
        ['grid', 'extentKm', 'postsPerHour', 'backgroundTraffic'].includes(k)
          ? Number($(k).value)
          : $(k).value,
      ]),
    ),
  ),
);
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
  ];
  const overrides = JSON.parse($('advancedConfig').value);
  await api('/api/config', {
    ...Object.fromEntries(
      fields.map((k) => [
        k,
        ['grid', 'extentKm', 'postsPerHour', 'backgroundTraffic'].includes(k)
          ? Number($(k).value)
          : $(k).value,
      ]),
    ),
    ...overrides,
  });
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
$('fullTimeline').onclick = perform(async () => {
  const rows = await api('/api/events?entity=' + encodeURIComponent(selected.id));
  timelineCache.set(selected.id, rows.events);
  $('selection').innerHTML +=
    '<h2>Recorded history · ' +
    rows.total +
    ' events</h2>' +
    rows.events
      .map(
        (e) =>
          `<div class="timelineEntry">${clock(e.at)} · ${escape(e.type)}<br>${escape(JSON.stringify(e.data))}</div>`,
      )
      .join('');
});
$('selection').onclick = (e) => {
  const op = e.target.closest('[data-operation]');
  if (op) select({ kind: 'operation', id: op.dataset.operation });
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
for (const id of ['pendingWater', 'servedWater', 'signals', 'operations', 'integrity'])
  $(id).parentElement.onclick = () => {
    const rules = {
      pendingWater:
        'Pending water = demand minus effective service. Proposals and arrivals do not reduce this number.',
      servedWater:
        'Counts water delivered as service, capped at each need. Excess supply is reported separately.',
      signals:
        'Published reports / distinct versioned download receipts. Download is not understanding.',
      operations: 'Authorized operations outside completed, cancelled and failed states.',
      integrity:
        'Checks stock conservation, exclusive reservations, finite seats, population and milestone order.',
    };
    $('selectionTitle').textContent = 'How this metric is calculated';
    $('selectionHint').textContent = rules[id];
    $('selection').innerHTML =
      '<p class="muted">Export results for per-community values, uncertainty and event counts. No value estimates lives saved.</p>';
  };
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
