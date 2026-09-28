import * as THREE from 'three';

// Spatial cells for small, numerous instances (grass, reeds, crops, stones).
// One lake-wide InstancedMesh is never frustum-culled because its bounding
// sphere covers everything; splitting it into cells lets three cull the cells
// behind the camera, and a draw distance hides cells whose contents would be a
// pixel or two across anyway.

export interface CellInstance {
  x: number;
  z: number;
  matrix: THREE.Matrix4;
  color?: THREE.Color;
}

interface Cell {
  mesh: THREE.InstancedMesh;
  cx: number;
  cz: number;
  r: number;
}

const registry: { cells: Cell[]; far: number }[] = [];

/** Builds one InstancedMesh per occupied cell. `far` is the draw distance in metres. */
export function cellInstanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  list: CellInstance[],
  cellSize: number,
  far: number,
  setup?: (m: THREE.InstancedMesh) => void,
): THREE.Group {
  const group = new THREE.Group();
  const buckets = new Map<string, CellInstance[]>();
  for (const it of list) {
    const key = `${Math.floor(it.x / cellSize)},${Math.floor(it.z / cellSize)}`;
    const b = buckets.get(key);
    if (b) b.push(it);
    else buckets.set(key, [it]);
  }
  const cells: Cell[] = [];
  for (const items of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.matrix);
      if (it.color) mesh.setColorAt(i, it.color);
      minX = Math.min(minX, it.x);
      maxX = Math.max(maxX, it.x);
      minZ = Math.min(minZ, it.z);
      maxZ = Math.max(maxZ, it.z);
    });
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    setup?.(mesh);
    group.add(mesh);
    cells.push({ mesh, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, r: Math.hypot(maxX - minX, maxZ - minZ) / 2 });
  }
  registry.push({ cells, far });
  return group;
}

/** Hides every cell whose nearest point is beyond its draw distance. Call once per frame. */
export function updateCells(camera: THREE.Camera): void {
  const x = camera.position.x;
  const z = camera.position.z;
  for (const { cells, far } of registry) {
    for (const c of cells) {
      const d = Math.hypot(c.cx - x, c.cz - z) - c.r;
      c.mesh.visible = d < far;
    }
  }
}
