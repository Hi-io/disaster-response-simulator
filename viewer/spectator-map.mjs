import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MotionBuffer } from './motion.js';
import { roadCorridors } from './geometry.js';

// This renderer consumes only the allowlisted spectator contract. It has no
// fetch, authentication, world controls, intervention or actor-action methods.
// Vehicle interpolation and road geometry are shared with the laboratory.
export function createSpectatorMap({ container, onSelect = () => {} } = {}) {
  if (!container) throw Error('A spectator-map container is required.');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.setClearColor('#f7f7fc', 1);
  renderer.domElement.setAttribute('aria-label', 'Live simulated response map. Select a team marker to highlight its vehicles.');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;';
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#d1cee4', 2.5));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(1, 3, 1); scene.add(sun);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 200000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableRotate = false; controls.enableDamping = true; controls.dampingFactor = .12;
  controls.minZoom = .7; controls.maxZoom = 12;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  const motion = new MotionBuffer({ expectedInterval: 1500, maxDuration: 1800 });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let map, frame, nodes = new Map(), buildings = new Map(), extent = 10000,
    base, live = new THREE.Group(), boxes, selected = null, following = null,
    stopped = false, animation, teams = new Map(), cars = new Map(), needles = new Map(), clickTargets = [],
    boxIndex = new Map(), lastBuildingState = new Map();
  scene.add(live);
  const palettes = ['#715bd7', '#438ec0', '#d69553', '#479c85', '#a66cba', '#d07885', '#547fb0', '#998642'];
  const colorFor = id => frame?.organizations.find(o => o.id === id)?.color ?? palettes[Math.max(0, frame?.organizations.findIndex(o => o.id === id) ?? 0) % palettes.length];
  const clearGroup = group => {
    group?.traverse(o => { o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material?.dispose(); });
    if (group) scene.remove(group);
  };
  const fit = () => {
    if (!map) return;
    const rect = container.getBoundingClientRect(), aspect = Math.max(.25, rect.width / Math.max(1, rect.height));
    const xs = map.nodes.map(n => n.x), zs = map.nodes.map(n => n.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    extent = Math.max(maxX - minX, maxZ - minZ, 1);
    const halfHeight = Math.max(extent * .46, extent * .74 / aspect);
    camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
    camera.top = halfHeight; camera.bottom = -halfHeight; camera.far = extent * 12;
    camera.position.set(center.x + extent, extent * 1.12, center.z + extent);
    controls.target.copy(center); camera.zoom = 1; camera.updateProjectionMatrix(); controls.update();
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  };
  const resize = () => {
    if (!map) return;
    const rect = container.getBoundingClientRect(), aspect = Math.max(.25, rect.width / Math.max(1, rect.height));
    const halfHeight = Math.max(extent * .46, extent * .74 / aspect);
    camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
    camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix();
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  };
  function build(geometry) {
    clearGroup(base); clearGroup(live); base = new THREE.Group(); live = new THREE.Group();
    scene.add(base, live); teams = new Map(); cars = new Map(); needles = new Map(); clickTargets = [];
    motion.reset(); map = geometry; nodes = new Map(map.nodes.map(n => [n.id, n]));
    buildings = new Map(map.buildings.map(b => [b.id, b])); boxIndex = new Map(); lastBuildingState = new Map();
    const vertices = [];
    for (const { edge } of roadCorridors(map.edges)) {
      const points = edge.points ?? [nodes.get(edge.from), nodes.get(edge.to)];
      for (let i = 1; i < points.length; i++) if (points[i - 1] && points[i])
        vertices.push(points[i - 1].x, 1, points[i - 1].z, points[i].x, 1, points[i].z);
    }
    const roads = new THREE.BufferGeometry(); roads.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    base.add(new THREE.LineSegments(roads, new THREE.LineBasicMaterial({ color: '#d9daea', opacity: .85, transparent: true })));
    boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .9 }), map.buildings.length);
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion();
    const siteScale = map.extentM / Math.max(10, map.grid ?? Math.sqrt(map.buildings.length));
    map.buildings.forEach((b, i) => {
      const width = Math.max(10, Math.min(siteScale * .42, b.width ?? siteScale * .24));
      const height = Math.max(9, Math.min(siteScale * .55, b.height ?? 16));
      matrix.compose(new THREE.Vector3(b.x, height / 2, b.z), q, new THREE.Vector3(width, height, width));
      boxes.setMatrixAt(i, matrix); boxes.setColorAt(i, new THREE.Color('#d8d6e8')); boxIndex.set(b.id, i);
    });
    base.add(boxes); fit();
  }
  function sync(next) {
    frame = next;
    if (!map || next.mapId !== map.projectionId) return false;
    // MotionBuffer receives the same minimal physical fields used by the real
    // viewer. It only interpolates previously confirmed route samples.
    motion.accept({ runId: next.episodeId, now: next.now, playing: next.playing,
      state: { map, vehicles: next.vehicles } }, performance.now(), 'truth');
    const liveTeamIds = new Set(next.organizations.map(o => o.id));
    for (const [id, mesh] of teams) if (!liveTeamIds.has(id)) { live.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); teams.delete(id); }
    for (const org of next.organizations) {
      const point = nodes.get(org.node); if (!point) continue;
      let marker = teams.get(org.id);
      if (!marker) {
        marker = new THREE.Mesh(new THREE.CylinderGeometry(extent * .007, extent * .009, extent * .009, 6),
          new THREE.MeshStandardMaterial({ color: colorFor(org.id), emissive: colorFor(org.id), emissiveIntensity: .12 }));
        marker.position.set(point.x, extent * .008, point.z); marker.userData = { kind: 'organization', id: org.id };
        teams.set(org.id, marker); live.add(marker);
      }
      marker.material.color.set(colorFor(org.id)); marker.scale.setScalar(selected === org.id ? 1.5 : 1);
    }
    const vehicleIds = new Set(next.vehicles.map(v => v.id));
    for (const [id, mesh] of cars) if (!vehicleIds.has(id)) { live.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); cars.delete(id); }
    for (const v of next.vehicles) {
      if (!cars.has(v.id)) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(extent * .0045, extent * .0035, extent * .007),
          new THREE.MeshStandardMaterial({ color: colorFor(v.owner) }));
        mesh.userData = { kind: 'vehicle', id: v.id, owner: v.owner }; cars.set(v.id, mesh); live.add(mesh);
      }
      const mesh = cars.get(v.id); mesh.material.color.set(colorFor(v.owner));
      mesh.material.transparent = !!selected && selected !== v.owner; mesh.material.opacity = mesh.material.transparent ? .25 : 1;
    }
    const open = next.needs.filter(n => n.quantity > n.served), active = new Set(open.map(n => n.id));
    for (const [id, ring] of needles) if (!active.has(id)) { live.remove(ring); ring.geometry.dispose(); ring.material.dispose(); needles.delete(id); }
    for (const n of open) {
      if (needles.has(n.id)) continue; const b = buildings.get(n.building); if (!b) continue;
      const ring = new THREE.Mesh(new THREE.RingGeometry(extent * .006, extent * .009, 24),
        new THREE.MeshBasicMaterial({ color: '#cf7f75', transparent: true, opacity: .7, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(b.x, extent * .002, b.z); live.add(ring); needles.set(n.id, ring);
    }
    const changed = new Map((next.mapState?.buildings ?? []).map(([id, ...values]) => [id,
      Object.fromEntries(next.mapState.buildingFields.map((field, i) => [field, values[i]]))]));
    const neededBuildings = new Set(open.map(n => n.building));
    for (const [id, i] of boxIndex) {
      const state = changed.get(id), color = state?.damage > 0 || neededBuildings.has(id) ? '#ce9890' : '#d8d6e8';
      if (lastBuildingState.get(id) !== color) { boxes.setColorAt(i, new THREE.Color(color)); lastBuildingState.set(id, color); }
    }
    if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
    clickTargets = [...teams.values(), ...cars.values()]; return true;
  }
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let pointerDown;
  const down = e => { pointerDown = { x: e.clientX, y: e.clientY }; };
  const up = e => {
    if (!pointerDown || Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) > 8) return;
    const r = renderer.domElement.getBoundingClientRect(); pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(pointer, camera); const hit = ray.intersectObjects(clickTargets)[0]?.object;
    if (hit) { const value = hit.userData; if (value.kind === 'organization') api.selectOrganization(value.id); onSelect(value); }
  };
  renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up);
  const observer = new ResizeObserver(resize); observer.observe(container);
  function animate(now) {
    if (stopped) return; animation = requestAnimationFrame(animate);
    if (!map || document.hidden || !container.clientWidth || !container.clientHeight) return;
    for (const [id, mesh] of cars) {
      const p = motion.point(id, now, { paused: !frame?.playing, reducedMotion: reduced.matches });
      if (p) mesh.position.set(p.x, extent * .003, p.z);
    }
    if (following && cars.has(following)) {
      const p = cars.get(following).position, dx = (p.x - controls.target.x) * .08, dz = (p.z - controls.target.z) * .08;
      controls.target.x += dx; controls.target.z += dz; camera.position.x += dx; camera.position.z += dz;
    }
    for (const ring of needles.values()) {
      const pulse = reduced.matches ? 1 : 1 + .12 * Math.sin(now / 1000); ring.scale.setScalar(pulse);
    }
    controls.update(); renderer.render(scene, camera);
  }
  const api = {
    setBootstrap(value) { build(value.map); sync(value.frame); },
    update: sync,
    selectOrganization(id) { selected = id; following = null; if (frame) sync(frame); },
    followVehicle(id) { following = id; const v = frame?.vehicles.find(v => v.id === id); if (v) { selected = v.owner; camera.zoom = Math.max(camera.zoom, 3); camera.updateProjectionMatrix(); } },
    home() { following = null; fit(); }, resize,
    destroy() { stopped = true; cancelAnimationFrame(animation); observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', up);
      controls.dispose(); clearGroup(base); clearGroup(live); renderer.dispose(); renderer.domElement.remove(); },
  };
  animation = requestAnimationFrame(animate); return api;
}
