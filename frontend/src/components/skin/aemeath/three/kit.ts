import {
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshPhysicalMaterial,
  OctahedronGeometry,
  PMREMGenerator,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Môi trường phản chiếu nhỏ (PMREM từ RoomEnvironment) để pha lê có ánh kim loại/khúc xạ giả. */
export function makeEnv(renderer: WebGLRenderer): Texture {
  const pm = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const tex = pm.fromScene(room, 0.04).texture;
  pm.dispose();
  room.dispose();
  return tex;
}

const TINTS = [0xff8fc8, 0x6fe3f5, 0xc4b5fd]; // hồng, cyan, bạc-tím

/** Bộ dùng chung: một hình học (bát diện kéo dài), viền hologram, vài vật liệu. Gọi dispose() khi bỏ. */
export class CrystalKit {
  readonly geo = new OctahedronGeometry(1, 0).scale(0.62, 1.5, 0.62);
  readonly edges = new EdgesGeometry(this.geo);
  readonly lineMat = new LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.25 });
  readonly mats = TINTS.map(
    (color) =>
      new MeshPhysicalMaterial({
        color,
        metalness: 0.2,
        roughness: 0.06,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        iridescence: 1,
        iridescenceIOR: 1.6,
        flatShading: true,
        transparent: true,
        opacity: 0.45,
        envMapIntensity: 0.4,
        emissive: color,
        emissiveIntensity: 0.25,
      }),
  );

  setEnv(env: Texture) {
    for (const m of this.mats) m.envMap = env;
  }

  make(tint: number, scale: number, wire = true): Group {
    const g = new Group();
    g.add(new Mesh(this.geo, this.mats[tint % this.mats.length]));
    if (wire) {
      const l = new LineSegments(this.edges, this.lineMat);
      l.scale.setScalar(1.002);
      g.add(l);
    }
    g.scale.setScalar(scale);
    return g;
  }

  dispose() {
    this.geo.dispose();
    this.edges.dispose();
    this.lineMat.dispose();
    for (const m of this.mats) m.dispose();
  }
}
