import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A compact trailing shelf plant. The pot rests at local y = 0 and its vines
// grow toward +X, over the front of the bookcase and into the room.
export function createCornerPlant() {
  const group = new THREE.Group();
  group.name = 'CornerPlant';

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const geometries = [];

  function colored(geometry, color, matrix = null) {
    const result = geometry.index ? geometry.toNonIndexed() : geometry;
    if (result !== geometry) geometry.dispose();
    if (matrix) result.applyMatrix4(matrix);
    result.deleteAttribute('uv');
    const rgb = new THREE.Color(color);
    const colors = new Float32Array(result.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = rgb.r;
      colors[i + 1] = rgb.g;
      colors[i + 2] = rgb.b;
    }
    result.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return result;
  }

  function mergedMesh(parts, name) {
    const geometry = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // Eight sides keep the silhouette in the same faceted style as the room.
  // The raised lip and recessed soil make the pot read as an open vessel.
  const pot = mergedMesh([
    colored(new THREE.CylinderGeometry(0.18, 0.135, 0.23, 8, 1, true), 0xa47759,
      new THREE.Matrix4().makeTranslation(0, 0.14, 0)),
    colored(new THREE.CylinderGeometry(0.194, 0.194, 0.035, 8, 1, true), 0xb68a68,
      new THREE.Matrix4().makeTranslation(0, 0.2575, 0)),
    colored(new THREE.RingGeometry(0.17, 0.194, 8).rotateX(-Math.PI / 2), 0xc49672,
      new THREE.Matrix4().makeTranslation(0, 0.275, 0)),
    colored(new THREE.CylinderGeometry(0.169, 0.169, 0.012, 8), 0x392e24,
      new THREE.Matrix4().makeTranslation(0, 0.255, 0)),
    colored(new THREE.CylinderGeometry(0.205, 0.183, 0.025, 8), 0x8f664e,
      new THREE.Matrix4().makeTranslation(0, 0.0125, 0)),
  ], 'CornerPlant_Pot');
  group.add(pot);

  // A folded ridge and broad angular outline catch the room lighting without
  // textures, alpha blending, or a dense mesh. Each leaf is just 16 triangles.
  function leafGeometry(length, width) {
    const rows = [
      [0, 0.005, 0],
      [0.22, width * 0.46, 0.008],
      [0.48, width * 0.5, 0.014],
      [0.76, width * 0.3, 0.01],
      [1, 0, -0.008],
    ];
    const positions = [];
    for (let i = 0; i < rows.length - 1; i += 1) {
      const [t0, w0, curve0] = rows[i];
      const [t1, w1, curve1] = rows[i + 1];
      const a = [0, t0 * length, curve0 + w0 * 0.24];
      const b = [0, t1 * length, curve1 + w1 * 0.24];
      const left0 = [-w0, t0 * length, curve0];
      const left1 = [-w1, t1 * length, curve1];
      const right0 = [w0, t0 * length, curve0];
      const right1 = [w1, t1 * length, curve1];
      positions.push(...a, ...left0, ...left1, ...a, ...left1, ...b);
      positions.push(...a, ...b, ...right1, ...a, ...right1, ...right0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  const leafColors = [0x778e59, 0x879968, 0x647d50, 0x95a578, 0x738b5b];
  const up = new THREE.Vector3(0, 1, 0);

  function stem(start, end, radius = 0.005) {
    const direction = end.clone().sub(start);
    const transform = new THREE.Matrix4().compose(
      start.clone().add(end).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize()),
      new THREE.Vector3(1, 1, 1),
    );
    return colored(new THREE.CylinderGeometry(radius, radius, direction.length(), 5, 1, true),
      0x66764a, transform);
  }

  function addLeaf(parts, anchor, direction, length, width, color) {
    const growth = new THREE.Vector3(...direction).normalize();
    const base = anchor.clone().addScaledVector(growth, 0.025);
    parts.push(stem(anchor, base, 0.0035));
    // Orient each blade upward and inward, with its fold catching the light.
    const side = growth.clone().cross(up).normalize();
    const normal = side.clone().cross(growth).normalize();
    const transform = new THREE.Matrix4().makeBasis(side, growth, normal);
    transform.setPosition(base);
    parts.push(colored(leafGeometry(length * 1.1, width * 1.3), color, transform));
  }

  // Each path clears the shelf's +X edge before dropping below the pot base.
  // No branch grows backward into the wall. Uneven lengths make the trailing
  // silhouette natural, while keeping the shape deterministic on reload.
  const paths = [
    [[-0.01, 0, -0.045], [0.15, 0.13, -0.07], [0.31, 0.02, -0.12],
      [0.39, -0.2, -0.15], [0.42, -0.42, -0.1], [0.48, -0.69, -0.15]],
    [[0.025, 0, 0.02], [0.18, 0.11, 0.02], [0.32, 0, 0.05],
      [0.4, -0.23, 0.04], [0.5, -0.48, 0.12], [0.49, -0.82, 0.08]],
    [[0.01, 0.01, 0.06], [0.16, 0.15, 0.13], [0.34, -0.01, 0.22],
      [0.49, -0.18, 0.24], [0.54, -0.46, 0.29]],
  ];
  const stalks = paths.map((path, branchIndex) => {
    const points = path.map((point) => new THREE.Vector3(...point));
    const parts = [];
    for (let index = 1; index < points.length; index += 1) {
      parts.push(stem(points[index - 1], points[index]));
      const sign = (index + branchIndex) % 2 === 0 ? 1 : -1;
      addLeaf(parts, points[index], [0.82, index < 2 ? 0.28 : -0.32, sign * 0.55],
        0.18 + (index % 3) * 0.018, 0.125 + (index % 2) * 0.025,
        leafColors[(index + branchIndex) % leafColors.length]);
      if (index < points.length - 1) {
        const opposite = points[index - 1].clone().lerp(points[index], 0.64);
        addLeaf(parts, opposite, [0.9, 0.04, -sign * 0.5],
          0.16, 0.12, leafColors[(index + branchIndex + 2) % leafColors.length]);
      }
    }
    const stalk = mergedMesh(parts, `CornerPlant_Vine_${branchIndex + 1}`);
    stalk.position.y = 0.26;
    group.add(stalk);
    return stalk;
  });

  // A few short upright stems fill the top of the pot, all leaning inward.
  const crownParts = [];
  const crown = [
    [[0.09, 0.18, -0.1], [0.7, 0.45, -0.3], 0.2, 0.15],
    [[0.06, 0.24, 0.01], [0.72, 0.4, 0.12], 0.19, 0.15],
    [[0.11, 0.15, 0.12], [0.8, 0.18, 0.5], 0.2, 0.15],
    [[0.015, 0.13, -0.015], [0.75, 0.52, -0.05], 0.17, 0.135],
  ];
  crown.forEach(([point, direction, length, width], index) => {
    const tip = new THREE.Vector3(...point);
    crownParts.push(stem(new THREE.Vector3(0, 0, point[2] * 0.2), tip));
    addLeaf(crownParts, tip, direction, length, width, leafColors[index]);
  });
  const crownMesh = mergedMesh(crownParts, 'CornerPlant_Crown');
  crownMesh.position.y = 0.26;
  group.add(crownMesh);
  stalks.push(crownMesh);

  return {
    group,
    update(elapsed, motionEnabled = true) {
      stalks.forEach((stalk, index) => {
        // Slow, small movement keeps the pot anchored and the shelf readable.
        // Zeroing rotations also handles a live reduced-motion preference change.
        stalk.rotation.x = motionEnabled ? Math.sin(elapsed * 0.64 + index * 1.17) * 0.012 : 0;
        stalk.rotation.z = motionEnabled ? Math.sin(elapsed * 0.47 + index * 0.83) * 0.009 : 0;
      });
    },
    dispose() {
      group.removeFromParent();
      geometries.forEach((geometry) => geometry.dispose());
      material.dispose();
    },
  };
}
