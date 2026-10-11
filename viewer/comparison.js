import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const views = [];
let ready = false,
  active = false,
  lastChanged = 0;
function initialize() {
  for (const id of ['compareA', 'compareB']) {
    const el = document.getElementById(id),
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    el.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#eff3f8');
    scene.add(new THREE.HemisphereLight('#ffffff', '#a0aac3', 3));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000000),
      controls = new OrbitControls(camera, renderer.domElement);
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.maxPolarAngle = Math.PI * 0.46;
    const view = {
      el,
      renderer,
      scene,
      camera,
      controls,
      group: null,
      extent: 1000,
      initialized: false,
    };
    views.push(view);
    controls.addEventListener('start', () => (lastChanged = views.indexOf(view)));
    new ResizeObserver(() => resize(view)).observe(el);
  }
  const animate = () => {
    requestAnimationFrame(animate);
    if (!active) return;
    const primary = views[lastChanged],
      other = views[1 - lastChanged];
    primary.controls.update();
    other.camera.position.copy(primary.camera.position);
    other.camera.quaternion.copy(primary.camera.quaternion);
    other.camera.zoom = primary.camera.zoom;
    other.controls.target.copy(primary.controls.target);
    other.camera.updateProjectionMatrix();
    for (const v of views) v.renderer.render(v.scene, v.camera);
  };
  animate();
  ready = true;
}
function resize(v) {
  const w = v.el.clientWidth,
    h = Math.max(1, v.el.clientHeight);
  v.renderer.setSize(w, h);
  v.camera.left = (-v.extent * w) / h;
  v.camera.right = (v.extent * w) / h;
  v.camera.top = v.extent;
  v.camera.bottom = -v.extent;
  v.camera.updateProjectionMatrix();
}
function draw(v, s) {
  if (v.group) {
    v.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    v.scene.remove(v.group);
  }
  const group = (v.group = new THREE.Group());
  v.scene.add(group);
  const map = s.state.map,
    scale = map.extentM / map.grid,
    nodes = new Map(map.nodes.map((n) => [n.id, n]));
  const geo = new THREE.BoxGeometry(1, 1, 1),
    mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(), map.buildings.length),
    matrix = new THREE.Matrix4();
  for (let i = 0; i < map.buildings.length; i++) {
    const b = map.buildings[i],
      h = (b.height * scale) / 150;
    matrix.makeScale(b.width, h, b.width);
    matrix.setPosition(b.x, h / 2, b.z);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(
      i,
      new THREE.Color(b.state === 'operating' ? '#79a89c' : b.damage ? '#d79582' : '#c7d1e0'),
    );
  }
  group.add(mesh);
  const points = [];
  for (const e of map.edges) {
    const a = nodes.get(e.from),
      b = nodes.get(e.to);
    points.push(a.x, 1, a.z, b.x, 1, b.z);
  }
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  group.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: '#bdcadc' })));
  for (const n of s.state.needs.filter((n) => n.served < n.quantity)) {
    const b = map.buildings.find((b) => b.id === n.building),
      ring = new THREE.Mesh(
        new THREE.RingGeometry(scale * 0.08, scale * 0.11, 16),
        new THREE.MeshBasicMaterial({ color: '#dc8d78', side: THREE.DoubleSide }),
      );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(b.x, 2, b.z);
    group.add(ring);
  }
  for (const truck of s.state.vehicles) {
    const node = nodes.get(truck.node);
    if (!node) continue;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(scale * 0.035, scale * 0.03, scale * 0.055),
      new THREE.MeshStandardMaterial({ color: truck.background ? '#b0bac9' : '#5e7fc7' }),
    );
    let x = node.x,
      z = node.z;
    if (truck.edge) {
      const e = map.edges.find((e) => e.id === truck.edge),
        to = nodes.get(e.to),
        t = Math.min(1, Math.max(0, (s.now - truck.edgeStart) / (truck.edgeEnd - truck.edgeStart)));
      x += (to.x - x) * t;
      z += (to.z - z) * t;
    }
    box.position.set(x, scale * 0.02, z);
    group.add(box);
  }
  if (!v.initialized || v.mapHash !== map.hash) {
    v.extent = map.extentM * 0.65;
    v.camera.position.set(map.extentM * 1.5, map.extentM * 1.1, map.extentM * 1.5);
    v.controls.target.set(map.extentM / 2, 0, map.extentM / 2);
    v.camera.lookAt(v.controls.target);
    v.camera.zoom = 1;
    v.initialized = true;
    v.mapHash = map.hash;
    resize(v);
  }
}
export function renderComparison(a, b) {
  if (!ready) initialize();
  active = true;
  if (a && b) {
    draw(views[0], a);
    draw(views[1], b);
  }
}
export function stopComparison() {
  active = false;
}
