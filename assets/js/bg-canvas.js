/**
 * 科技风粒子网络背景（Canvas，零依赖）。
 * 特性：设备像素比适配 / 鼠标引力交互 / prefers-reduced-motion 静态帧 / destroy 清理。
 */

export function mountTechCanvas(canvas, { density = 11000, color = '110, 178, 255', link = 130, alpha = 1 } = {}) {
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
          ctx.strokeStyle = `rgba(${color},${(1 - dist / link) * 0.26 * alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    for (const d of dots) {
      ctx.fillStyle = `rgba(${color},${0.9 * alpha})`;
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

/**
 * 星雨背景：竖条内星点飘落 + 偶发流星拖尾（科技风，用于简历页两侧装饰条）。
 */
export function mountStarRain(canvas, { color = '191, 224, 255', density = 2600 } = {}) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let raf = 0;
  let W = 0;
  let H = 0;
  let stars = [];
  let meteor = null;
  let nextMeteorAt = 0;
  let t = 0;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.max(18, Math.round((W * H) / density));
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      speed: 0.25 + Math.random() * 0.85,
      r: 0.5 + Math.random() * 1.3,
      phase: Math.random() * Math.PI * 2,
      freq: 0.8 + Math.random() * 1.6,
    }));
  }

  function spawnMeteor() {
    meteor = {
      x: Math.random() * W * 0.8 + W * 0.1,
      y: -10,
      vx: (Math.random() - 0.3) * 0.7,
      vy: 2.6 + Math.random() * 1.8,
      life: 0,
      maxLife: 70 + Math.random() * 40,
    };
    nextMeteorAt = t + 260 + Math.random() * 420;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const s of stars) {
      s.y += s.speed;
      if (s.y > H + 4) {
        s.y = -4;
        s.x = Math.random() * W;
      }
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.02 * s.freq + s.phase));
      ctx.fillStyle = `rgba(${color},${0.5 * tw})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!meteor && t > nextMeteorAt) spawnMeteor();
    if (meteor) {
      meteor.life++;
      meteor.x += meteor.vx;
      meteor.y += meteor.vy;
      const fade = 1 - meteor.life / meteor.maxLife;
      const tailX = meteor.x - meteor.vx * 16;
      const tailY = meteor.y - meteor.vy * 16;
      const grad = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
      grad.addColorStop(0, `rgba(${color},${0.9 * fade})`);
      grad.addColorStop(1, `rgba(${color},0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(meteor.x, meteor.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      if (meteor.life > meteor.maxLife || meteor.y > H + 30) meteor = null;
    }
  }

  function loop() {
    t++;
    draw();
    raf = requestAnimationFrame(loop);
  }

  const onResize = () => {
    resize();
    if (reduced) draw();
  };

  resize();
  if (reduced) draw();
  else loop();
  window.addEventListener('resize', onResize);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    },
  };
}
