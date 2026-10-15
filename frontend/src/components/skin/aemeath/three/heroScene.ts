import { Group, MathUtils } from 'three';
import { startLoop, trackPointer } from './loop';
import { makeStage } from './stage';
import type { GlQuality } from './quality';

export interface HeroSceneOptions {
  quality: Exclude<GlQuality, 'off'>;
  /** Số pha lê quay quanh (mặc định: high 6, low 3). */
  count?: number;
  /** Bán kính quỹ đạo theo đơn vị cảnh (banner ~2.6, 404 ~1.4). */
  radius?: number;
  /** Dịch tâm quỹ đạo sang phải (banner: vùng sprite). */
  offsetX?: number;
}

/**
 * Cảnh cho banner trang chủ và trang 404: pha lê hologram quay quanh một tâm, đèn hồng/cyan chạy vòng,
 * cả nhóm nghiêng theo chuột (có chiều sâu thật). Chỉ render khi canvas nằm trong khung nhìn.
 */
export function createHeroScene(canvas: HTMLCanvasElement, host: HTMLElement, opts: HeroSceneOptions) {
  const high = opts.quality === 'high';
  const st = makeStage(canvas, { antialias: high, dpr: high ? 1.5 : 1, fov: 38, z: 8, host });
  const { scene, camera, kit, renderer } = st;
  const radius = opts.radius ?? 2.6;
  const count = opts.count ?? (high ? 6 : 3);

  const group = new Group();
  group.position.x = opts.offsetX ?? 0;
  scene.add(group);
  const items = Array.from({ length: count }, (_, i) => {
    const g = kit.make(i % 3, MathUtils.randFloat(0.28, 0.55) * (radius / 2.6 + 0.4), high);
    group.add(g);
    return {
      g,
      a: (i / count) * Math.PI * 2,
      speed: (0.12 + (i % 3) * 0.05) * (i % 2 ? 1 : -1),
      rx: radius * MathUtils.randFloat(0.8, 1.2),
      ry: radius * MathUtils.randFloat(0.35, 0.6),
      z: MathUtils.randFloat(-1.2, 1.6),
      ph: Math.random() * 6,
    };
  });

  const ptr = trackPointer();
  let tx = 0;
  let ty = 0;
  const stop = startLoop(
    canvas,
    (dt, t) => {
      tx += (ptr.p.y * 0.2 - tx) * Math.min(1, dt * 2.5);
      ty += (ptr.p.x * 0.35 - ty) * Math.min(1, dt * 2.5);
      group.rotation.x = tx;
      group.rotation.y = ty;
      for (const it of items) {
        it.a += it.speed * dt;
        it.g.position.set(Math.cos(it.a) * it.rx, Math.sin(it.a) * it.ry + Math.sin(t * 0.8 + it.ph) * 0.12, it.z + Math.sin(it.a) * 0.8);
        it.g.rotation.y += dt * 0.5;
        it.g.rotation.z = Math.sin(t * 0.4 + it.ph) * 0.25;
      }
      st.pink.position.set(Math.cos(t * 0.5) * 5, 2.5, 4);
      st.cyan.position.set(-Math.cos(t * 0.5) * 5, -2, 4);
      renderer.render(scene, camera);
    },
    { pauseOffscreen: true },
  );

  return () => {
    stop();
    ptr.stop();
    st.dispose();
  };
}
