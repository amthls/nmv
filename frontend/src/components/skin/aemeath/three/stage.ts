import { ACESFilmicToneMapping, AmbientLight, PerspectiveCamera, PointLight, Scene, WebGLRenderer, type Texture } from 'three';
import { CrystalKit, makeEnv } from './kit';
import { MAX_DPR } from './quality';

export interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  kit: CrystalKit;
  env: Texture;
  pink: PointLight;
  cyan: PointLight;
  resize: () => void;
  dispose: () => void;
}

/**
 * Sân khấu chung: renderer trong suốt (alpha), dpr <= 1.5, tone mapping ACES, đèn hồng + cyan, môi trường phản chiếu.
 * `host` là phần tử đo kích thước (canvas phủ nó); bg dùng window.
 */
export function makeStage(canvas: HTMLCanvasElement, opts: { antialias: boolean; dpr?: number; fov?: number; z?: number; host?: HTMLElement }): Stage {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: opts.antialias, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  const dpr = Math.min(window.devicePixelRatio || 1, opts.dpr ?? MAX_DPR);
  renderer.setPixelRatio(dpr);

  const scene = new Scene();
  const camera = new PerspectiveCamera(opts.fov ?? 40, 1, 0.1, 60);
  camera.position.set(0, 0, opts.z ?? 8);

  const kit = new CrystalKit();
  const env = makeEnv(renderer);
  kit.setEnv(env);

  scene.add(new AmbientLight(0xffe6f4, 0.35));
  const pink = new PointLight(0xff6fb5, 60, 40, 1.6);
  const cyan = new PointLight(0x67e8f9, 50, 40, 1.6);
  scene.add(pink, cyan);

  const resize = () => {
    const w = opts.host ? opts.host.clientWidth : window.innerWidth;
    const h = opts.host ? opts.host.clientHeight : window.innerHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(opts.host ?? document.documentElement);

  const dispose = () => {
    ro.disconnect();
    kit.dispose();
    env.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
  return { renderer, scene, camera, kit, env, pink, cyan, resize, dispose };
}
