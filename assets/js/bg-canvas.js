/**
 * 科技风粒子网络背景（Canvas，零依赖）。
 * 特性：设备像素比适配 / 鼠标引力交互 / prefers-reduced-motion 静态帧 / destroy 清理。
 */

export function mountTechCanvas(canvas, { density = 11000, color = '110, 178, 255', link = 130 } = {}) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let raf = 0;
  let W = 0;
  let H = 0;
  let dots = [];
  const mouse = { x: -9999, y: -9999 };

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(110, Math.max(26, Math.round((W * H) / density)));
    dots = Array.from({ length: n }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.6 + 0.7,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const d of dots) {
      d.x += d.vx;
      d.y += d.vy;
      if (d.x < 0 || d.x > W) d.vx *= -1;
      if (d.y < 0 || d.y > H) d.vy *= -1;
      const dx = mouse.x - d.x;
      const dy = mouse.y - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.001 && dist < 170) {
        d.x += (dx / dist) * 0.45;
        d.y += (dy / dist) * 0.45;
      }
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i];
        const b = dots[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < link) {
          ctx.strokeStyle = `rgba(${color},${(1 - dist / link) * 0.26})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    for (const d of dots) {
      ctx.fillStyle = `rgba(${color},0.9)`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function loop() {
    draw();
    raf = requestAnimationFrame(loop);
  }

  const onMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  };
  const onLeave = () => {
    mouse.x = -9999;
    mouse.y = -9999;
  };
  const onResize = () => {
    resize();
    if (reduced) draw();
  };

  resize();
  if (reduced) draw();
  else loop();

  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerleave', onLeave);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    },
  };
}
