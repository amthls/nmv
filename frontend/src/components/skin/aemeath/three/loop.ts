/**
 * Vòng render dùng chung: dừng khi tab ẩn, (tuỳ chọn) dừng khi canvas ngoài khung nhìn, khoá ~60fps,
 * và ghi FPS đo được vào `canvas.dataset.fps` mỗi giây (để kiểm bằng trình duyệt).
 */
export function startLoop(
  canvas: HTMLCanvasElement,
  tick: (dt: number, t: number) => void,
  opts: { pauseOffscreen?: boolean; shouldRender?: () => boolean } = {},
) {
  let raf = 0;
  let running = true;
  let visible = true;
  let last = performance.now();
  let t = 0;
  let frames = 0;
  let fpsAt = last;

  const frame = (now: number) => {
    raf = 0;
    if (!running) return;
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.1)); // rAF `now` có thể < last (last lấy từ performance.now())
    if (dt >= 1 / 62 || frames === 0) {
      last = now;
      t += dt;
      if (!opts.shouldRender || opts.shouldRender()) {
        tick(dt, t);
        frames++;
      }
    }
    if (now - fpsAt >= 1000) {
      canvas.dataset.fps = String(Math.round((frames * 1000) / (now - fpsAt)));
      frames = 0;
      fpsAt = now;
    }
    raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && running && visible && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  const onVis = () => {
    if (document.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else kick();
  };
  document.addEventListener('visibilitychange', onVis);

  let io: IntersectionObserver | null = null;
  if (opts.pauseOffscreen) {
    io = new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (!visible && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else kick();
    });
    io.observe(canvas);
  }
  kick();

  return () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVis);
    io?.disconnect();
  };
}

/** Con trỏ chuột chuẩn hoá [-1, 1] (chỉ chuột, không cảm ứng). */
export function trackPointer() {
  const p = { x: 0, y: 0 };
  const on = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    p.x = (e.clientX / window.innerWidth) * 2 - 1;
    p.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', on, { passive: true });
  return { p, stop: () => window.removeEventListener('pointermove', on) };
}
