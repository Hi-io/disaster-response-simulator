import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MotionBuffer } from './motion.js';
import { roadCorridors } from './geometry.js';
import { ReportActivity, authorInitials, screenWorldScale, spectatorFraming, vehicleMarkerPixels } from './spectator-activity.mjs';

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
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#d1cee4', 2.5));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(1, 3, 1); scene.add(sun);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 200000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableRotate = false; controls.enableDamping = true; controls.dampingFactor = .12;
  controls.minZoom = .75; controls.maxZoom = 8; controls.screenSpacePanning = false;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  const motion = new MotionBuffer({ expectedInterval: 1500, maxDuration: 1800 });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const reports = new ReportActivity(), dotTextures = new Map();
  let map, frame, nodes = new Map(), buildings = new Map(), extent = 10000,
    base, live = new THREE.Group(), boxes, selected = null, following = null,
    stopped = false, animation, teams = new Map(), cars = new Map(), needles = new Map(), clickTargets = [],
    boxIndex = new Map(), lastBuildingState = new Map(), reportMarkers = new Map(),
    routeLines = new THREE.Group(), framingMode = 'cover', bounds, viewportHeight = 1;
  scene.add(live);
  const palettes = ['#715bd7', '#438ec0', '#d69553', '#479c85', '#a66cba', '#d07885', '#547fb0', '#998642'];
  const colorFor = id => frame?.organizations.find(o => o.id === id)?.color ?? palettes[Math.max(0, frame?.organizations.findIndex(o => o.id === id) ?? 0) % palettes.length];
  const makeTexture = draw => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
    draw(canvas.getContext('2d')); const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace; return texture;
  };
  const dotTexture = color => {
    if (!dotTextures.has(color)) dotTextures.set(color, makeTexture(c => {
      const halo = c.createRadialGradient(48, 48, 16, 48, 48, 47);
      halo.addColorStop(0, '#22304736'); halo.addColorStop(1, '#22304700');
      c.fillStyle = halo; c.fillRect(0, 0, 96, 96);
      c.beginPath(); c.arc(48, 48, 34, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill();
      c.beginPath(); c.arc(48, 48, 24, 0, Math.PI * 2); c.fillStyle = color; c.fill();
    }));
    return dotTextures.get(color);
  };
  const sprite = texture => {
    const value = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
    value.renderOrder = 4; return value;
  };
  const disposeMarker = value => {
    value.parent?.remove(value); if (!value.isSprite) value.geometry?.dispose(); value.material?.dispose();
    value.userData.ownedTexture?.dispose();
  };
  const disposeReport = marker => { for (const child of [...marker.children]) disposeMarker(child); live.remove(marker); };
  const clearGroup = group => {
    group?.traverse(o => { if (!o.isSprite) o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material?.dispose();
      o.userData.ownedTexture?.dispose(); });
    if (group) scene.remove(group);
  };
  const updateFrustum = () => {
    const rect = container.getBoundingClientRect(); viewportHeight = Math.max(1, rect.height);
    const shape = spectatorFraming({ spanX: bounds.maxX - bounds.minX, spanZ: bounds.maxZ - bounds.minZ,
      width: rect.width, height: rect.height, mode: framingMode });
    Object.assign(camera, { left: shape.left, right: shape.right, top: shape.top, bottom: shape.bottom });
    camera.updateProjectionMatrix(); renderer.setSize(Math.max(1, rect.width), viewportHeight, false);
  };
  const fit = (mode = 'full') => {
    if (!map) return;
    const xs = map.nodes.map(n => n.x), zs = map.nodes.map(n => n.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    bounds = { minX, maxX, minZ, maxZ }; framingMode = mode;
    const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    extent = Math.max(maxX - minX, maxZ - minZ, 1);
    camera.far = extent * 12;
    camera.position.set(center.x + extent, extent * 1.12, center.z + extent);
    controls.target.copy(center); camera.zoom = 1; updateFrustum(); controls.update();
  };
  const resize = () => {
    if (!map) return;
    updateFrustum();
  };
  function build(geometry) {
    clearGroup(base); clearGroup(live); base = new THREE.Group(); live = new THREE.Group();
    scene.add(base, live); teams = new Map(); cars = new Map(); needles = new Map(); clickTargets = [];
    reportMarkers = new Map(); reports.reset(); routeLines = new THREE.Group(); live.add(routeLines);
    motion.reset(); selected = null; following = null; map = geometry; nodes = new Map(map.nodes.map(n => [n.id, n]));
    buildings = new Map(map.buildings.map(b => [b.id, b])); boxIndex = new Map(); lastBuildingState = new Map();
    const vertices = [];
    for (const { edge } of roadCorridors(map.edges)) {
      const points = edge.points ?? [nodes.get(edge.from), nodes.get(edge.to)];
      for (let i = 1; i < points.length; i++) if (points[i - 1] && points[i])
        vertices.push(points[i - 1].x, 1, points[i - 1].z, points[i].x, 1, points[i].z);
    }
    const roads = new THREE.BufferGeometry(); roads.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    base.add(new THREE.LineSegments(roads, new THREE.LineBasicMaterial({ color: '#c2cad8', opacity: .85, transparent: true })));
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
    base.add(boxes); fit('cover');
  }
  function sync(next) {
    frame = next;
    if (!map || next.mapId !== map.projectionId) return false;
    // MotionBuffer receives the same minimal physical fields used by the real
    // viewer. It only interpolates previously confirmed route samples.
    motion.accept({ runId: next.episodeId, now: next.now, playing: next.playing,
      state: { map, vehicles: next.vehicles } }, performance.now(), 'truth');
    const liveTeamIds = new Set(next.organizations.map(o => o.id));
    for (const [id, mesh] of teams) if (!liveTeamIds.has(id)) { disposeMarker(mesh); teams.delete(id); }
    for (const org of next.organizations) {
      const point = nodes.get(org.node); if (!point) continue;
      let marker = teams.get(org.id);
      if (!marker) {
        const texture = makeTexture(c => {
          c.beginPath(); c.arc(48, 48, 41, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill();
          c.beginPath(); c.arc(48, 48, 33, 0, Math.PI * 2); c.fillStyle = colorFor(org.id); c.fill();
          c.fillStyle = '#ffffff'; c.font = '600 25px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(authorInitials(org.name), 48, 48);
        });
        marker = sprite(texture); marker.renderOrder = 5;
        marker.position.set(point.x, extent * .008, point.z);
        marker.userData = { kind: 'organization', id: org.id, ownedTexture: texture };
        teams.set(org.id, marker); live.add(marker);
      }
    }
    const vehicleIds = new Set(next.vehicles.map(v => v.id));
    for (const [id, mesh] of cars) if (!vehicleIds.has(id)) { disposeMarker(mesh); cars.delete(id); }
    for (const v of next.vehicles) {
      if (!cars.has(v.id)) {
        const mesh = sprite(dotTexture(v.background ? '#52687c' : colorFor(v.owner)));
        mesh.userData = { kind: 'vehicle', id: v.id, owner: v.owner, background: !!v.background };
        cars.set(v.id, mesh); live.add(mesh);
      }
      const mesh = cars.get(v.id);
      mesh.material.map = dotTexture(v.background ? '#52687c' : colorFor(v.owner));
      mesh.material.opacity = v.background ? .9 : selected && selected !== v.owner ? .35 : 1;
      mesh.userData.pixels = vehicleMarkerPixels(v, { selected, following });
    }
    for (const child of [...routeLines.children]) { child.geometry.dispose(); child.material.dispose(); routeLines.remove(child); }
    const edges = new Map(map.edges.map(e => [e.id, e]));
    for (const v of next.vehicles.filter(v => !v.background && v.route?.length &&
      (following === v.id || selected === v.owner)).slice(0, 8)) {
      const vertices = [];
      for (const id of v.route.slice(v.routeIndex ?? 0)) {
        const edge = edges.get(id); if (!edge) continue;
        const points = edge.points ?? [nodes.get(edge.from), nodes.get(edge.to)];
        for (let i = 1; i < points.length; i++) if (points[i - 1] && points[i])
          vertices.push(points[i - 1].x, 3, points[i - 1].z, points[i].x, 3, points[i].z);
      }
      if (vertices.length) {
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: colorFor(v.owner),
          transparent: true, opacity: .55, depthTest: false, depthWrite: false }));
        line.renderOrder = 2; routeLines.add(line);
      }
    }
    const reportEntries = reports.update(next, performance.now(), new Map([...nodes, ...buildings]));
    const reportIds = new Set(reportEntries.map(p => p.id));
    for (const [id, marker] of reportMarkers) if (!reportIds.has(id)) {
      disposeReport(marker); reportMarkers.delete(id);
    }
    for (const entry of reportEntries) {
      if (reportMarkers.has(entry.id)) continue;
      const texture = makeTexture(c => {
        const shades = ['#526e85', '#826554', '#6c698b', '#4d7c77', '#856278'];
        const name = entry.record.authorName ?? '', shade = shades[Array.from(name).reduce((n, x) => n + x.codePointAt(0), 0) % shades.length];
        c.beginPath(); c.arc(48, 43, 37, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill();
        c.beginPath(); c.arc(48, 43, 30, 0, Math.PI * 2); c.fillStyle = shade; c.fill();
        c.font = '600 24px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffffff';
        c.fillText(authorInitials(name), 48, 43);
        c.fillStyle = '#ffffff'; c.beginPath(); c.roundRect(56, 59, 29, 25, 6); c.fill();
        c.strokeStyle = '#52687c'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(63, 67); c.lineTo(78, 67); c.moveTo(63, 74); c.lineTo(73, 74); c.stroke();
      });
      const marker = new THREE.Group(), avatar = sprite(texture);
      avatar.center.set(.5, 0); avatar.renderOrder = 7;
      avatar.userData = { kind: 'post', id: entry.id, record: entry.record, ownedTexture: texture };
      const ping = new THREE.Mesh(new THREE.RingGeometry(.75, 1, 32),
        new THREE.MeshBasicMaterial({ color: '#647f9b', transparent: true, opacity: .6, depthTest: false, depthWrite: false }));
      ping.rotation.x = -Math.PI / 2; ping.renderOrder = 3;
      marker.add(ping, avatar); marker.position.set(entry.point.x, extent * .004, entry.point.z);
      marker.userData = { entry, avatar, ping }; live.add(marker); reportMarkers.set(entry.id, marker);
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
    clickTargets = [...teams.values(), ...cars.values(), ...[...reportMarkers.values()].map(m => m.userData.avatar)]; return true;
  }
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let pointerDown;
  const down = e => { pointerDown = { x: e.clientX, y: e.clientY }; };
  const up = e => {
    const start = pointerDown; pointerDown = null;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;
    const r = renderer.domElement.getBoundingClientRect(); pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(clickTargets.filter(target => target.parent && target.visible && target.material.opacity > .05))[0]?.object;
    if (hit) { const { ownedTexture, pixels, ...value } = hit.userData;
      if (value.kind === 'organization') api.selectOrganization(value.id); onSelect(value); }
  };
  renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up);
  const observer = new ResizeObserver(resize); observer.observe(container);
  function animate(now) {
    if (stopped) return; animation = requestAnimationFrame(animate);
    if (!map || document.hidden || !container.clientWidth || !container.clientHeight) return;
    const units = screenWorldScale({ top: camera.top, bottom: camera.bottom, zoom: camera.zoom, height: viewportHeight });
    for (const [id, mesh] of cars) {
      const p = motion.point(id, now, { paused: !frame?.playing, reducedMotion: reduced.matches });
      if (p) mesh.position.set(p.x, extent * .003, p.z);
      mesh.scale.setScalar(units * mesh.userData.pixels * 1.35);
    }
    for (const [id, marker] of teams) marker.scale.setScalar(units * (selected === id ? 35 : 29));
    const alive = new Set(reports.entries(now).map(p => p.id));
    for (const [id, marker] of reportMarkers) {
      if (!alive.has(id)) { disposeReport(marker); reportMarkers.delete(id); continue; }
      const { entry, avatar, ping } = marker.userData;
      const age = now - entry.startedAt, remaining = entry.expiresAt - now;
      const opacity = Math.min(1, age / 400, remaining / 1500);
      avatar.scale.setScalar(units * 42); avatar.position.y = units * (reduced.matches ? 8 : 8 + age / 1500);
      avatar.material.opacity = opacity;
      const pulse = reduced.matches ? 1 : 1 + (age % 2000) / 1000;
      ping.scale.setScalar(units * 11 * pulse); ping.material.opacity = opacity * (reduced.matches ? .45 : .55 / pulse);
    }
    if (following && cars.has(following)) {
      const p = cars.get(following).position, dx = (p.x - controls.target.x) * .08, dz = (p.z - controls.target.z) * .08;
      controls.target.x += dx; controls.target.z += dz; camera.position.x += dx; camera.position.z += dz;
    }
    for (const ring of needles.values()) {
      const pulse = reduced.matches ? 1 : 1 + .12 * Math.sin(now / 1000); ring.scale.setScalar(pulse);
    }
    controls.update();
    // Keep ordinary map panning close to the simulated region. Following still
    // uses the real vehicle position; there is no free-flight/admin camera.
    const x = Math.max(bounds.minX - extent * .2, Math.min(bounds.maxX + extent * .2, controls.target.x));
    const z = Math.max(bounds.minZ - extent * .2, Math.min(bounds.maxZ + extent * .2, controls.target.z));
    camera.position.x += x - controls.target.x; camera.position.z += z - controls.target.z;
    controls.target.x = x; controls.target.z = z;
    renderer.render(scene, camera);
  }
  const api = {
    setBootstrap(value) { build(value.map); sync(value.frame); },
    update: sync,
    selectOrganization(id) { selected = id; following = null; if (frame) sync(frame); },
    followVehicle(id) { following = id; const v = frame?.vehicles.find(v => v.id === id); if (v) {
      selected = v.background ? null : v.owner; camera.zoom = Math.max(camera.zoom, 3); camera.updateProjectionMatrix(); sync(frame);
    } },
    home() { following = null; fit(); }, resize,
    destroy() { stopped = true; cancelAnimationFrame(animation); observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', up);
      controls.dispose(); clearGroup(base); clearGroup(live);
      for (const texture of dotTextures.values()) texture.dispose();
      renderer.dispose(); renderer.domElement.remove(); },
  };
  animation = requestAnimationFrame(animate); return api;
}
