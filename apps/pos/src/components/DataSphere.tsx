import { useEffect, useRef } from 'react';

/** Rotating dotted globe for the login screen (canvas, no libraries). Drag to spin.
 *  Brand colours: blue dots with orange highlights. Respects prefers-reduced-motion. */
export function DataSphere({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let rotY = 0.6;
    let rotX = -0.18;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let w = 0;
    let h = 0;
    let frame = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      rotY += (e.clientX - lastX) * 0.008;
      rotX = Math.max(-0.8, Math.min(0.8, rotX + (e.clientY - lastY) * 0.006));
      lastX = e.clientX;
      lastY = e.clientY;
      if (still) draw();
    };
    const up = () => (dragging = false);

    const tilt = (19 * Math.PI) / 180;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.43;
      const glow = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.36, 0, cx, cy, R);
      glow.addColorStop(0, 'rgba(96, 165, 250, .22)');
      glow.addColorStop(0.65, 'rgba(37, 99, 235, .10)');
      glow.addColorStop(1, 'rgba(37, 99, 235, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      for (let lat = -Math.PI / 2 + 0.08; lat < Math.PI / 2; lat += 0.105) {
        for (let lon = 0; lon < Math.PI * 2; lon += 0.105) {
          const x = Math.cos(lat) * Math.cos(lon + rotY);
          const y = Math.sin(lat);
          const z = Math.cos(lat) * Math.sin(lon + rotY);
          const ry = y * Math.cos(rotX) - z * Math.sin(rotX);
          const rz = y * Math.sin(rotX) + z * Math.cos(rotX);
          if (rz < -0.12) continue;
          const tx = x * Math.cos(tilt) - ry * Math.sin(tilt);
          const ty = x * Math.sin(tilt) + ry * Math.cos(tilt);
          const shift = (Math.sin(lat * 5 + lon * 2) + 1) / 2;
          const a = 0.22 + rz * 0.65;
          ctx.beginPath();
          ctx.arc(cx + tx * R, cy + ty * R, Math.max(0.4, 0.75 + rz * 1.35 + shift * 0.45), 0, Math.PI * 2);
          ctx.fillStyle = shift > 0.93 ? `rgba(249, 115, 22, ${a * 0.9})` : `rgba(${Math.round(37 + shift * 60)}, ${Math.round(99 + shift * 70)}, 235, ${a})`;
          ctx.fill();
        }
      }
    };
    const loop = () => {
      draw();
      if (!dragging) rotY += 0.0028;
      frame = requestAnimationFrame(loop);
    };

    resize();
    const onResize = () => (resize(), still && draw());
    window.addEventListener('resize', onResize);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    if (still) draw();
    else loop();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
