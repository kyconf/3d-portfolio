import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A small procedural floor plant. The pot rests at local y = 0 so placement
// only needs the floor height; all foliage moves from its roots in the soil.
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
    colored(new THREE.CylinderGeometry(0.258, 0.188, 0.32, 8, 1, true), 0xa86b4e,
      new THREE.Matrix4().makeTranslation(0, 0.194, 0)),
    colored(new THREE.CylinderGeometry(0.275, 0.275, 0.052, 8, 1, true), 0xc38761,
      new THREE.Matrix4().makeTranslation(0, 0.356, 0)),
    colored(new THREE.RingGeometry(0.238, 0.275, 8).rotateX(-Math.PI / 2), 0xd29971,
      new THREE.Matrix4().makeTranslation(0, 0.382, 0)),
    colored(new THREE.CylinderGeometry(0.237, 0.237, 0.018, 8), 0x34261f,
      new THREE.Matrix4().makeTranslation(0, 0.343, 0)),
    colored(new THREE.CylinderGeometry(0.28, 0.252, 0.034, 8), 0x86513d,
      new THREE.Matrix4().makeTranslation(0, 0.017, 0)),
  ], 'CornerPlant_Pot');
  group.add(pot);

  // A folded ridge and broad angular outline catch the room lighting without
  // textures, alpha blending, or a dense mesh. Each leaf is just 16 triangles.
  function leafGeometry(length, width) {
    const rows = [
      [0, 0.012, 0],
      [0.24, width * 0.44, 0.02],
      [0.53, width * 0.5, 0.055],
      [0.79, width * 0.33, 0.052],
      [1, 0, -0.025],
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

  // angle, stem height, blade length, blade width, outward tilt, leaf color.
  // Fixed variation gives a lush silhouette without random changes on reload.
  const leaves = [
    [0.25, 0.52, 0.48, 0.255, 0.88, 0x4f8750],
    [1.25, 0.34, 0.43, 0.225, 1.05, 0x659655],
    [2.15, 0.63, 0.51, 0.26, 0.62, 0x467b48],
    [3.15, 0.41, 0.45, 0.235, 0.92, 0x58884b],
    [4.12, 0.72, 0.48, 0.235, 0.39, 0x6a9955],
    [5.08, 0.47, 0.49, 0.255, 0.86, 0x3d7045],
    [5.88, 0.67, 0.46, 0.23, 0.42, 0x57864c],
  ];
  const stalks = leaves.map(([angle, height, length, width, tilt, color], index) => {
    const outward = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const tip = outward.clone().multiplyScalar(0.1 + height * 0.08);
    tip.y = height;
    const curve = new THREE.CatmullRomCurve3([
      outward.clone().multiplyScalar(0.025),
      new THREE.Vector3(tip.x * 0.3, height * 0.52, tip.z * 0.3),
      tip,
    ]);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, angle, 0, 'YXZ'));
    const leafTransform = new THREE.Matrix4().compose(tip, rotation, new THREE.Vector3(1, 1, 1));
    const stalk = mergedMesh([
      colored(new THREE.TubeGeometry(curve, 4, 0.009, 4, false), 0x4d7041),
      colored(leafGeometry(length, width), color, leafTransform),
    ], `CornerPlant_Leaf_${index + 1}`);
    stalk.position.y = 0.35;
    group.add(stalk);
    return stalk;
  });

  return {
    group,
    update(elapsed, motionEnabled = true) {
      stalks.forEach((stalk, index) => {
        // About one degree: enough to feel a soft breeze, while the pot stays
        // planted. Zeroing the rotations also handles preference changes.
        stalk.rotation.x = motionEnabled ? Math.sin(elapsed * 0.72 + index * 1.17) * 0.014 : 0;
        stalk.rotation.z = motionEnabled ? Math.sin(elapsed * 0.53 + index * 0.83) * 0.012 : 0;
      });
    },
    dispose() {
      group.removeFromParent();
      geometries.forEach((geometry) => geometry.dispose());
      material.dispose();
    },
  };
}
