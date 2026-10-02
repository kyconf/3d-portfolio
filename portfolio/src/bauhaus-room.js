import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Restyle the existing room without touching its personal objects or layout.
// Match the original glTF node name: generated mesh names can have suffixes.
export function applyBauhausStyle(model) {
  const group = new THREE.Group();
  group.name = 'BauhausRoomDetails';
  const originals = [];
  const hidden = [];
  const materials = [];
  const geometries = [];
  const batches = new Map();

  const makeMaterial = (name, color, options = {}) => {
    const material = new THREE.MeshStandardMaterial({
      name: `Bauhaus_${name}`,
      color,
      roughness: 0.75,
      ...options,
    });
    materials.push(material);
    return material;
  };
  const ivory = makeMaterial('Ivory', 0xf0ebde, { roughness: 0.88 });
  const olive = makeMaterial('Olive', 0x596b49, { roughness: 0.8 });
  const rugSage = makeMaterial('SageTextile', 0x778467, { roughness: 0.97 });
  const throwClay = makeMaterial('ClayTextile', 0xb07355, { roughness: 0.98 });
  const textileIvory = makeMaterial('IvoryTextile', 0xece4d0, { roughness: 0.98 });
  const terracotta = makeMaterial('Terracotta', 0xb85f3e, { roughness: 0.42 });
  const ochre = makeMaterial('Ochre', 0xc7a05a, { roughness: 0.92 });
  const charcoal = makeMaterial('Charcoal', 0x252927, { roughness: 0.55 });
  // A little diffuse response keeps the tubing readable without an HDR map.
  const chrome = makeMaterial('SatinChrome', 0xb9c8cd, { metalness: 0.68, roughness: 0.24 });
  const globe = makeMaterial('MilkGlass', 0xffefd0, {
    roughness: 0.4,
    emissive: 0xffd6a0,
    emissiveIntensity: 0.3,
  });

  function nodeNamed(name) {
    let match = null;
    model.traverse((object) => {
      if (!match && object.userData?.name === name) match = object;
    });
    return match || model.getObjectByName(name.replace(/\./g, ''));
  }

  function replace(name, material, materialName = null) {
    const node = nodeNamed(name);
    node?.traverse((object) => {
      if (!object.isMesh) return;
      const previous = object.material;
      const source = Array.isArray(previous) ? previous : [previous];
      const next = source.map((entry) => !materialName || entry.name === materialName ? material : entry);
      if (next.every((entry, index) => entry === source[index])) return;
      originals.push({ object, material: previous });
      object.material = Array.isArray(previous) ? next : next[0];
    });
  }

  function hide(name) {
    const object = nodeNamed(name);
    if (!object) return;
    hidden.push({ object, visible: object.visible });
    object.visible = false;
  }

  // Floors, bookshelf, desk top, window surround and upper room frame retain
  // their original wood. Apply finishes to nodes, not shared materials.
  replace('Wall', ivory);
  replace('07262005', ivory); // individual blind slats
  replace('Cube', ivory); // desk drawer cabinet
  replace('Plane.002', ivory); // desk drawer fronts
  replace('Plane.001', ivory); // right desk support, opposite the drawer cabinet
  replace('Cylinder', chrome);
  replace('Cylinder.001', chrome);
  replace('Cube.029', ivory); // bedside record cabinet
  replace('Plane.010', ivory); // bedside drawer front
  replace('Cylinder.014', chrome);
  replace('MCBed', textileIvory, 'BedRed');
  replace('MCBed', textileIvory, 'Material.021');

  // Batch the new static details by material, keeping the extra draw calls low.
  function add(geometry, material, position, rotation = null) {
    let part = geometry;
    if (geometry.index) {
      part = geometry.toNonIndexed();
      geometry.dispose();
    }
    part.deleteAttribute('uv');
    const quaternion = rotation
      ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation))
      : new THREE.Quaternion();
    part.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...position), quaternion, new THREE.Vector3(1, 1, 1),
    ));
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(part);
  }

  function box(width, height, depth, material, position) {
    add(new THREE.BoxGeometry(width, height, depth), material, position);
  }

  function tube(start, end, radius = 0.022) {
    const from = new THREE.Vector3(...start);
    const to = new THREE.Vector3(...end);
    const direction = to.clone().sub(from);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 10);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    add(geometry, chrome, from.add(to).multiplyScalar(0.5).toArray());
  }

  // One thin metal edge accents the desk; the bookcase keeps its wooden frame.
  tube([-1.105, 1.482, -0.2], [-1.105, 1.482, 2.25], 0.018);

  // Rectangular wool rug with a quiet, regular ivory grid. The original round
  // rug remains in the model so the style can be disposed without data loss.
  hide('Cylinder.009');
  const rugCenter = [0.2, 0.539, 0.88];
  const rugWidth = 2.5;
  const rugDepth = 2.12;
  box(rugWidth, 0.015, rugDepth, rugSage, rugCenter);
  for (let i = 0; i <= 10; i += 1) {
    box(0.009, 0.0015, rugDepth - 0.09, textileIvory,
      [rugCenter[0] - rugWidth / 2 + 0.045 + i * (rugWidth - 0.09) / 10, 0.5475, rugCenter[2]]);
  }
  for (let i = 0; i <= 8; i += 1) {
    box(rugWidth - 0.09, 0.0015, 0.009, textileIvory,
      [rugCenter[0], 0.5475, rugCenter[2] - rugDepth / 2 + 0.045 + i * (rugDepth - 0.09) / 8]);
  }

  // Clay bedding and an ochre cushion balance the sage rug and green foliage.
  // The short end of the throw continues over the front edge of the mattress.
  box(0.49, 0.017, 1.68, throwClay, [0.89, 1.513, -1.235]);
  box(0.49, 0.32, 0.018, throwClay, [0.89, 1.353, -0.388]);
  box(0.027, 0.019, 1.68, textileIvory, [1.07, 1.515, -1.235]);
  box(0.027, 0.32, 0.02, textileIvory, [1.07, 1.353, -0.386]);
  const cushion = new THREE.BoxGeometry(0.32, 0.12, 0.41, 1, 1, 1);
  add(cushion, ochre, [-1.04, 1.445, -1.25], [0, -0.12, 0]);

  // Replace just the lowest poster with a small original geometric composition.
  // The two photographs and the hand-written whiteboard remain as they are.
  hide('Plane.008');
  box(0.675, 0.675, 0.027, charcoal, [1.869, 2.233, -2.168]);
  box(0.633, 0.633, 0.006, ivory, [1.869, 2.233, -2.151]);
  add(new THREE.CircleGeometry(0.142, 40), terracotta, [1.762, 2.345, -2.146]);
  box(0.113, 0.287, 0.002, ochre, [2.057, 2.324, -2.145]);
  add(new THREE.CircleGeometry(0.21, 40, 0, Math.PI), olive, [1.859, 2.036, -2.143]);
  box(0.43, 0.024, 0.002, charcoal, [1.86, 2.006, -2.14]);

  // A compact mushroom lamp sits on the original desk. Keep the old nodes and
  // their transforms available to the existing point-light positioning code.
  hide('Cylinder.004');
  hide('BézierCurve');
  const lampX = -1.84;
  const lampZ = 0.015;
  add(new THREE.CylinderGeometry(0.165, 0.185, 0.055, 24), terracotta, [lampX, 1.693, lampZ]);
  add(new THREE.CylinderGeometry(0.065, 0.085, 0.315, 20), terracotta, [lampX, 1.865, lampZ]);
  add(new THREE.SphereGeometry(0.272, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), terracotta,
    [lampX, 2.014, lampZ]);
  add(new THREE.CircleGeometry(0.266, 28), globe, [lampX, 2.013, lampZ], [Math.PI / 2, 0, 0]);

  // The globe shares the existing overhead point light's exact center.
  // The caller hides its previous tiny bulb mesh when this style is installed.
  add(new THREE.SphereGeometry(0.21, 24, 16), globe, [0.5, 4.5, 0.5]);
  add(new THREE.CylinderGeometry(0.047, 0.047, 0.055, 12), chrome, [0.5, 4.71, 0.5]);
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 6), charcoal, [0.5, 4.897, 0.5]);

  for (const [material, parts] of batches) {
    const geometry = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material.name;
    // The overhead point source is inside the glass; its decorative globe must
    // not cast a shadow that blocks all of that light.
    mesh.castShadow = material !== globe;
    mesh.receiveShadow = material !== globe;
    group.add(mesh);
  }

  return {
    group,
    dispose() {
      group.removeFromParent();
      for (let i = originals.length - 1; i >= 0; i -= 1) {
        originals[i].object.material = originals[i].material;
      }
      hidden.forEach(({ object, visible }) => { object.visible = visible; });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}
