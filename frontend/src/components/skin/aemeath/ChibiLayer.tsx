'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from '@/lib/realtime';
import SkinChibi, { useChibiOn } from './SkinChibi';
import { CHIBI_LINES, pickLine } from './chibiLines';

/** Chibi ló ra ở mép dưới-trái: thỉnh thoảng thò đầu, rê lại gần thì nhô lên, bấm thì nói một câu rồi rụt vào. */
function Corner() {
  const [state, setState] = useState<'hidden' | 'peek' | 'up'>('hidden');
  const [line, setLine] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const near = useRef(false);
  const talking = useRef(false);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }, []);

  // Chu kỳ: ẩn lâu, thò đầu một lúc, ẩn lại
  useEffect(() => {
    let cancelled = false;
    const cycle = (wait: number) =>
      later(() => {
        if (cancelled) return;
        setState('peek');
        later(() => {
          if (cancelled || near.current || talking.current) return cycle(8000);
          setState('hidden');
          cycle(45000 + Math.random() * 40000);
        }, 7000);
      }, wait);
    cycle(7000);
    const ts = timers.current;
    return () => {
      cancelled = true;
      ts.forEach(clearTimeout);
    };
  }, [later]);

  // Rê chuột lại gần góc thì nhô lên (mượt), ra xa thì về như cũ
  useEffect(() => {
    if (!window.matchMedia('(hover: hover)').matches) return;
    const onMove = (e: PointerEvent) => {
      const isNear = e.clientX < 150 && e.clientY > window.innerHeight - 130;
      if (isNear === near.current) return;
      near.current = isNear;
      setState((s) => (isNear ? 'up' : s === 'up' ? 'peek' : s));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  const tap = () => {
    if (talking.current) return;
    talking.current = true;
    setState('up');
    setLine(pickLine(CHIBI_LINES.tap));
    later(() => {
      setLine(null);
      talking.current = false;
      setState('hidden');
    }, 4200);
  };

  return (
    <>
      <div className={`sk-chibi-corner ${state !== 'hidden' ? 'is-seen' : ''} ${state === 'up' ? 'is-up' : state === 'peek' ? 'is-peek' : ''}`} onClick={tap} aria-hidden="true">
        <div className="sk-chibi-corner__pet">
          <SkinChibi pose="peek" mood={line ? 'happy' : 'wink'} seed="corner" size={96} />
        </div>
      </div>
      {line && (
        <p className="sk-chibi-bubble" role="status">
          {line}
        </p>
      )}
    </>
  );
}

/** Toast "có thông báo mới" với chibi mini bên trái. */
function Toast() {
  const [shown, setShown] = useState<string | null>(null);
  const timer = useRef<number>(0);
  useRealtime('notification', () => {
    setShown(pickLine(CHIBI_LINES.notifyNew));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(null), 4500);
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!shown) return null;
  return (
    <div className="sk-chibi-toast" role="status">
      <SkinChibi badge="wave" size={40} />
      <span>{shown}</span>
    </div>
  );
}

/** Lớp chibi toàn site (chỉ được tải khi skin Aemeath bật, xem AemeathLayer). */
export default function ChibiLayer() {
  const { on } = useChibiOn();
  if (!on) return null;
  return (
    <>
      <Corner />
      <Toast />
    </>
  );
}
