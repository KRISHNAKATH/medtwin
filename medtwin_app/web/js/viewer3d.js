// 3D brain viewer. Meshes arrive in the viewer frame: x = patient's left, y = superior,
// z = anterior, millimetres, centred on the brain. A front camera therefore sees the face
// with the patient's left on screen right.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const VIEWS = {
  front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0], top: [0, 1, -0.02],
};

export class BrainViewer {
  constructor(container, { onHover, onPick } = {}) {
    this.container = container;
    this.onHover = onHover || (() => {});
    this.onPick = onPick || (() => {});
    this.loader = new GLTFLoader();
    this.brainOpacity = 0.35;
    this.regionMeshes = new Map();   // key -> mesh
    this.gtMeshes = new Map();
    this.brainMeshes = {};           // patient | template
    this.brainSource = 'patient';
    this.clipActive = false;
    this.radius = 100;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 5000);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotateSpeed = 1.2;

    this.scene.add(new THREE.HemisphereLight(0xf4f1ff, 0x2a2238, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(250, 320, 380);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.55);
    fill.position.set(-320, 60, -160);
    const rim = new THREE.DirectionalLight(0xffe2d6, 0.6);
    rim.position.set(0, -200, -320);
    this.camera.add(key, fill, rim);   // lights follow the camera: lit from the viewer's side
    this.scene.add(this.camera);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e6);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hovered = null;
    renderer.domElement.addEventListener('pointermove', (e) => this._onPointerMove(e));
    // Click or tap picks the region under the pointer; the end of a rotate-drag does not.
    renderer.domElement.addEventListener('pointerdown', (e) => { this.downAt = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('click', (e) => {
      const [x0, y0] = this.downAt || [e.clientX, e.clientY];
      if (Math.hypot(e.clientX - x0, e.clientY - y0) > 5) return;
      this._onPointerMove(e);
      if (this.hovered) this.onPick(this.hovered.userData);
    });

    new ResizeObserver(() => this._resize()).observe(container);
    this._resize();
    renderer.setAnimationLoop(() => {
      this.controls.update();
      renderer.render(this.scene, this.camera);
    });
  }

  _resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    for (const obj of [...this.root.children]) {
      this.root.remove(obj);
      obj.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    this.regionMeshes.clear();
    this.gtMeshes.clear();
    this.brainMeshes = {};
    this.hovered = null;
  }

  async _loadMesh(url) {
    const gltf = await this.loader.loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    let mesh = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) throw new Error(`No mesh in ${url}`);
    const geometry = mesh.geometry;
    geometry.applyMatrix4(mesh.matrixWorld);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const colors = geometry.attributes.color;
    if (colors) {
      // Vertex colours are written as sRGB bytes; the renderer expects linear values.
      const linear = new Float32Array(colors.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < colors.count; i++) {
        c.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i)).convertSRGBToLinear();
        linear.set([c.r, c.g, c.b], i * 3);
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(linear, 3));
    }
    return geometry;
  }

  _brainMaterial() {
    return new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.62, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.55,
      sheen: 0.6, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xffd9cf),
      // Front faces only keeps the see-through brain readable; a cut needs both sides.
      side: this.clipActive ? THREE.DoubleSide : THREE.FrontSide, transparent: true, opacity: this.brainOpacity,
      depthWrite: this.brainOpacity > 0.97, clippingPlanes: [this.clipPlane],
    });
  }

  async load(base, results, { keepCamera = false } = {}) {
    const camera = keepCamera ? { pos: this.camera.position.clone(), target: this.controls.target.clone() } : null;
    const visibleBrain = this.brainSource;
    this.clear();
    const jobs = [];
    const ver = encodeURIComponent(results.updated_at || results.created_at || '');
    const brain = results.brain;
    jobs.push(this._loadMesh(`${base}/meshes/${brain.mesh.replace('.glb', '')}.glb?v=${ver}`).then((g) => {
      const m = new THREE.Mesh(g, this._brainMaterial());
      m.renderOrder = 10;
      m.userData = { kind: 'brain' };
      this.brainMeshes.patient = m;
      this.root.add(m);
      g.computeBoundingSphere();
      this.radius = g.boundingSphere.radius;
      g.computeBoundingBox();
      this.bounds = g.boundingBox.clone();
    }));
    if (brain.template) {
      jobs.push(this._loadMesh(`${base}/meshes/${brain.template.mesh.replace('.glb', '')}.glb?v=${ver}`).then((g) => {
        const m = new THREE.Mesh(g, this._brainMaterial());
        m.renderOrder = 10;
        m.visible = false;
        this.brainMeshes.template = m;
        this.root.add(m);
      }));
    }
    for (const disease of results.diseases) {
      for (const region of disease.regions) {
        if (!region.mesh) continue;
        const info = { kind: 'region', disease: disease.name, diseaseKey: disease.key, ...region };
        jobs.push(this._loadMesh(`${base}/meshes/${region.mesh.replace('.glb', '')}.glb?v=${ver}`).then((g) => {
          const color = new THREE.Color(region.color);
          const mat = new THREE.MeshPhysicalMaterial({
            color, roughness: 0.38, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.25,
            emissive: color, emissiveIntensity: 0.18, transparent: region.key === 'edema', opacity: region.key === 'edema' ? 0.55 : 1,
            depthWrite: region.key !== 'edema',
          });
          const m = new THREE.Mesh(g, mat);
          m.renderOrder = region.key === 'edema' ? 5 : 1;
          m.userData = info;
          this.regionMeshes.set(`${disease.key}:${region.key}`, m);
          this.root.add(m);
        }));
        if (region.ground_truth && region.ground_truth.mesh) {
          jobs.push(this._loadMesh(`${base}/meshes/${region.ground_truth.mesh.replace('.glb', '')}.glb?v=${ver}`).then((g) => {
            const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(region.color), wireframe: true, transparent: true, opacity: 0.35 });
            const m = new THREE.Mesh(g, mat);
            m.visible = false;
            this.gtMeshes.set(`${disease.key}:${region.key}`, m);
            this.root.add(m);
          }));
        }
      }
    }
    await Promise.all(jobs);
    if (camera) {
      // after a correction: keep the clinician's view and brain choice
      this.camera.position.copy(camera.pos);
      this.controls.target.copy(camera.target);
      this.controls.update();
      this.brainSource = this.brainMeshes[visibleBrain] ? visibleBrain : 'patient';
    } else {
      this.setView('front');
    }
  }

  setView(name) {
    const dir = new THREE.Vector3(...(VIEWS[name] || VIEWS.front)).normalize();
    const dist = this.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.08;
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(dir.multiplyScalar(dist));
    this.controls.target.set(0, 0, 0);
    this.camera.near = dist / 50;
    this.camera.far = dist * 10;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  setBrainOpacity(value) {
    this.brainOpacity = value;
    for (const m of Object.values(this.brainMeshes)) {
      m.material.opacity = value;
      m.material.depthWrite = value > 0.97;
      m.visible = value > 0.01 && (m === this.brainMeshes[this.brainSource]);
      m.material.needsUpdate = true;
    }
  }

  setBrainSource(source) {
    if (!this.brainMeshes[source]) return;
    this.brainSource = source;
    this.setBrainOpacity(this.brainOpacity);
  }

  // axis: none | sagittal | coronal | axial; t in [-1, 1] across the brain's extent.
  setClip(axis, t) {
    this.clipActive = axis !== 'none';
    for (const m of Object.values(this.brainMeshes)) {
      m.material.side = this.clipActive ? THREE.DoubleSide : THREE.FrontSide;
      m.material.needsUpdate = true;
    }
    if (axis === 'none' || !this.bounds) { this.clipPlane.constant = 1e6; return; }
    const idx = { sagittal: 'x', coronal: 'z', axial: 'y' }[axis];
    const normal = new THREE.Vector3();
    normal[idx] = -1;
    const lo = this.bounds.min[idx];
    const hi = this.bounds.max[idx];
    this.clipPlane.normal.copy(normal);
    this.clipPlane.constant = lo + (t + 1) / 2 * (hi - lo);
  }

  setRegionVisible(id, visible) {
    const m = this.regionMeshes.get(id);
    if (m) m.visible = visible;
  }

  setGroundTruthVisible(visible) {
    for (const m of this.gtMeshes.values()) m.visible = visible;
  }

  setAutoRotate(on) { this.controls.autoRotate = on; }

  snapshot() { return this.renderer.domElement.toDataURL('image/png'); }

  _onPointerMove(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [...this.regionMeshes.values()].filter((m) => m.visible);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    const obj = hit ? hit.object : null;
    if (obj !== this.hovered) {
      if (this.hovered) this.hovered.material.emissiveIntensity = 0.18;
      if (obj) obj.material.emissiveIntensity = 0.55;
      this.hovered = obj;
      this.renderer.domElement.style.cursor = obj ? 'pointer' : '';
    }
    this.onHover(obj ? obj.userData : null, event.clientX - rect.left, event.clientY - rect.top);
  }
}
