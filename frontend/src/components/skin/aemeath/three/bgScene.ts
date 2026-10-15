import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import { startLoop, trackPointer } from './loop';
import { makeStage } from './stage';

export interface BgScene {
  /** Pha lê vỡ tung rồi ghép lại (~0.9s) từ điểm (x, y) theo pixel màn hình. */
  burst: (x: number, y: number) => void;
  dispose: () => void;
}

const SHARDS = 26;

/**
 * Nền toàn site: hạt sao thưa + 3 pha lê trôi rất chậm (mờ, nằm sau nội dung) và nhóm mảnh vỡ cho hiệu ứng đổi skin.
 * Dừng render khi tab ẩn hoặc ở trang đọc chương (html[data-reader]).
 */
export function createBgScene(canvas: HTMLCanvasElement): BgScene {
  const st = makeStage(canvas, { antialias: false, dpr: 1.25, fov: 40, z: 9 });
  const { scene, camera, kit, renderer } = st;
  st.pink.position.set(-8, 4, 5);
  st.cyan.position.set(8, -3, 5);

  // sao: ~110 hạt, trôi lên rất chậm
  const N = 110;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = MathUtils.randFloatSpread(26);
    pos[i * 3 + 1] = MathUtils.randFloatSpread(16);
    pos[i * 3 + 2] = -MathUtils.randFloat(0, 8);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  const stars = new Points(
    g,
    new PointsMaterial({ color: 0xffd0ee, size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0.75, depthWrite: false, blending: AdditiveBlending }),
  );
  scene.add(stars);

  // 3 pha lê ở rìa (tránh vùng chữ ở giữa)
  const crystals: { g: Group; base: Vector3; speed: number; phase: number }[] = [
    { g: kit.make(0, 0.6), base: new Vector3(-7.2, 2.2, -2), speed: 0.1, phase: 0 },
    { g: kit.make(1, 0.75), base: new Vector3(7.6, -2.6, -3), speed: -0.08, phase: 2 },
    { g: kit.make(2, 0.5), base: new Vector3(5.2, 4.4, -5), speed: 0.06, phase: 4 },
  ];
  for (const c of crystals) {
    c.g.position.copy(c.base);
    scene.add(c.g);
  }

  // mảnh vỡ cho hiệu ứng đổi skin
  const shardGeo = new OctahedronGeometry(0.28, 0);
  const shardMat = new MeshBasicMaterial({ color: 0xffb3dd, transparent: true, opacity: 1, blending: AdditiveBlending, depthWrite: false });
  const shardMat2 = new MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 1, blending: AdditiveBlending, depthWrite: false });
  const shards = new Group();
  shards.visible = false;
  const shardData = Array.from({ length: SHARDS }, (_, i) => {
    const m = new Mesh(shardGeo, i % 2 ? shardMat2 : shardMat);
    shards.add(m);
    const dir = new Vector3(MathUtils.randFloatSpread(2), MathUtils.randFloatSpread(2), MathUtils.randFloatSpread(1)).normalize();
    const rest = dir.clone().multiplyScalar(0.55);
    return { m, dir, rest, spin: new Vector3(MathUtils.randFloatSpread(6), MathUtils.randFloatSpread(6), 0), dist: MathUtils.randFloat(3, 7) };
  });
  scene.add(shards);

  const origin = new Vector3();
  let burstT = -1;
  const burst = (x: number, y: number) => {
    const v = new Vector3((x / window.innerWidth) * 2 - 1, -((y / window.innerHeight) * 2 - 1), 0.5).unproject(camera);
    v.sub(camera.position).normalize();
    origin.copy(camera.position).addScaledVector(v, -camera.position.z / v.z);
    burstT = 0;
    shards.visible = true;
    canvas.classList.add('sk-gl-burst');
  };

  const ptr = trackPointer();
  let px = 0;
  let py = 0;
  const root = document.documentElement;

  const stop = startLoop(
    canvas,
    (dt, t) => {
      px += (ptr.p.x - px) * Math.min(1, dt * 1.5);
      py += (ptr.p.y - py) * Math.min(1, dt * 1.5);
      camera.position.x = px * 0.5;
      camera.position.y = -py * 0.3;
      camera.lookAt(0, 0, 0);
      stars.rotation.y = t * 0.006;
      stars.position.y = (t * 0.05) % 1;
      for (const c of crystals) {
        c.g.rotation.y += c.speed * dt;
        c.g.rotation.x = Math.sin(t * 0.15 + c.phase) * 0.15;
        c.g.position.y = c.base.y + Math.sin(t * 0.2 + c.phase) * 0.35;
      }
      st.pink.position.x = -8 + Math.sin(t * 0.2) * 2;
      if (burstT >= 0) {
        burstT += dt / 0.9;
        const p = Math.min(burstT, 1);
        const e = Math.pow(Math.sin(p * Math.PI), 0.9);
        const fade = 1 - MathUtils.smoothstep(p, 0.82, 1);
        shardMat.opacity = shardMat2.opacity = fade;
        for (const s of shardData) {
          s.m.position.copy(origin).add(s.rest).addScaledVector(s.dir, s.dist * e);
          s.m.rotation.x += s.spin.x * dt * (0.3 + e);
          s.m.rotation.y += s.spin.y * dt * (0.3 + e);
          s.m.scale.setScalar(1 + 0.6 * (1 - e));
        }
        if (burstT >= 1) {
          burstT = -1;
          shards.visible = false;
          canvas.classList.remove('sk-gl-burst');
        }
      }
      renderer.render(scene, camera);
    },
    { shouldRender: () => burstT >= 0 || !root.hasAttribute('data-reader') },
  );

  return {
    burst,
    dispose: () => {
      stop();
      ptr.stop();
      g.dispose();
      (stars.material as PointsMaterial).dispose();
      shardGeo.dispose();
      shardMat.dispose();
      shardMat2.dispose();
      st.dispose();
    },
  };
}
