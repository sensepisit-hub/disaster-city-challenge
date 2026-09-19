/* Disaster City Challenge - canvas particle effects (rain, snow, sand, waves, quake dust).
   No images, no external deps. Each system is intensity-driven (0..1) so scenes can
   ramp up smoothly during preparation countdown. */

function makeParticles(kind, count, w, h) {
  const arr = [];
  for (let i = 0; i < count; i++) arr.push(spawnParticle(kind, w, h, true));
  return arr;
}

function spawnParticle(kind, w, h, randomY) {
  const rand = Math.random;
  switch (kind) {
    case 'rain':
      return { x: rand() * w, y: randomY ? rand() * h : -10, len: 10 + rand() * 16, speed: 500 + rand() * 300, drift: 60 };
    case 'snow':
      return { x: rand() * w, y: randomY ? rand() * h : -10, r: 1 + rand() * 2.5, speed: 20 + rand() * 40, sway: rand() * Math.PI * 2, swaySpeed: 0.5 + rand() };
    case 'sand':
      return { x: randomY ? rand() * w : -10, y: rand() * h, r: 1 + rand() * 2, speed: 80 + rand() * 160, wobble: rand() * Math.PI * 2 };
    case 'dust':
      return { x: rand() * w, y: rand() * h, r: 2 + rand() * 4, vx: (rand() - 0.5) * 40, vy: (rand() - 0.5) * 40, life: rand() };
    default:
      return { x: rand() * w, y: rand() * h };
  }
}

function stepParticle(p, kind, dt, intensity, w, h, dirVec) {
  dirVec = dirVec || { x: 0, y: 1 };
  switch (kind) {
    case 'rain':
      p.y += p.speed * dt * (0.4 + intensity);
      p.x += dirVec.x * p.drift * dt * (0.4 + intensity);
      if (p.y > h + 20) { p.y = -20; p.x = Math.random() * w; }
      break;
    case 'snow':
      p.sway += p.swaySpeed * dt;
      p.y += p.speed * dt * (0.3 + intensity);
      p.x += Math.sin(p.sway) * 20 * dt + dirVec.x * 30 * dt * intensity;
      if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
      break;
    case 'sand':
      p.wobble += 2 * dt;
      p.x += (p.speed * dt) * (0.4 + intensity) * (dirVec.x || 1);
      p.y += Math.sin(p.wobble) * 15 * dt + dirVec.y * 30 * dt * intensity;
      if (p.x > w + 10) { p.x = -10; p.y = Math.random() * h; }
      if (p.x < -10) { p.x = w + 10; p.y = Math.random() * h; }
      break;
    case 'dust':
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 0.3;
      if (p.life <= 0) Object.assign(p, spawnParticle('dust', w, h, true));
      break;
  }
}

function drawParticle(ctx, p, kind, color, intensity) {
  ctx.save();
  switch (kind) {
    case 'rain':
      ctx.strokeStyle = color || 'rgba(180,210,255,0.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 3, p.y + p.len);
      ctx.stroke();
      break;
    case 'snow':
      ctx.fillStyle = color || 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'sand':
      ctx.fillStyle = color || 'rgba(230,190,120,0.55)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'dust':
      ctx.fillStyle = color || `rgba(160,140,110,${0.25 * (p.life || 0.5)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

function drawTopoLines(ctx, w, h, t, opacity) {
  ctx.save();
  ctx.strokeStyle = `rgba(120,200,190,${opacity})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const yBase = (h / 5) * i + Math.sin(t * 0.2 + i) * 8;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 20) {
      const y = yBase + Math.sin(x * 0.02 + t * 0.3 + i) * 10;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawWaves(ctx, w, h, t, intensity, baseline) {
  ctx.save();
  const amp = 6 + intensity * 22;
  for (let layer = 0; layer < 3; layer++) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 12) {
      const y = baseline - layer * 10 + Math.sin(x * 0.03 + t * (1.2 + layer * 0.4) + layer) * (amp - layer * 4);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = `rgba(30,${120 + layer * 20},${170 + layer * 15},${0.35 - layer * 0.08})`;
    ctx.fill();
  }
  ctx.restore();
}

/* ---------- reusable rAF-driven scene ---------- */
function createScene(canvas, drawFrame) {
  let raf = null;
  let last = performance.now();
  let running = false;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const ctx = canvas.getContext('2d');
    drawFrame(ctx, canvas.width, canvas.height, dt, now / 1000);
    raf = requestAnimationFrame(frame);
  }
  return {
    start() { if (running) return; running = true; resize(); last = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; },
    resize
  };
}

/* ---------- home / ambient background ---------- */
function createAmbientScene(canvas) {
  const rainP = [];
  const snowP = makeParticles('snow', 40, 800, 600);
  const sandP = makeParticles('sand', 30, 800, 600);
  return createScene(canvas, (ctx, w, h, dt, t) => {
    ctx.clearRect(0, 0, w, h);
    drawTopoLines(ctx, w, h, t, 0.05);
    snowP.forEach(p => { stepParticle(p, 'snow', dt, 0.15, w, h); drawParticle(ctx, p, 'snow', 'rgba(255,255,255,0.18)'); });
    sandP.forEach(p => { stepParticle(p, 'sand', dt, 0.1, w, h, { x: 1, y: 0.2 }); drawParticle(ctx, p, 'sand', 'rgba(230,190,120,0.14)'); });
    drawWaves(ctx, w, h, t, 0.15, h * 0.92);
  });
}

/* ---------- biome mini-preview canvases (card art) ---------- */
function renderBiomeCardArt(canvas, biomeId) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const meta = getBiomeMeta(biomeId);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, meta.palette.sky1);
  g.addColorStop(1, meta.palette.sky2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  if (biomeId === 'desert') {
    ctx.fillStyle = meta.palette.ground2;
    ctx.beginPath(); ctx.moveTo(0, h); ctx.quadraticCurveTo(w * 0.3, h * 0.55, w * 0.6, h * 0.72); ctx.quadraticCurveTo(w * 0.85, h * 0.85, w, h * 0.68); ctx.lineTo(w, h); ctx.fill();
    ctx.fillStyle = meta.palette.ground1;
    ctx.beginPath(); ctx.moveTo(0, h); ctx.quadraticCurveTo(w * 0.25, h * 0.75, w * 0.55, h * 0.85); ctx.quadraticCurveTo(w * 0.8, h * 0.95, w, h * 0.82); ctx.lineTo(w, h); ctx.fill();
    ctx.fillStyle = meta.palette.accent;
    ctx.beginPath(); ctx.arc(w * 0.78, h * 0.28, h * 0.13, 0, Math.PI * 2); ctx.fill();
  } else if (biomeId === 'mountain') {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(w * (0.2 + i * 0.3), h * 0.22, 28, 8, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = meta.palette.ground2;
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w * 0.18, h * 0.35); ctx.lineTo(w * 0.4, h * 0.65); ctx.lineTo(w * 0.62, h * 0.2); ctx.lineTo(w * 0.85, h * 0.6); ctx.lineTo(w, h * 0.4); ctx.lineTo(w, h); ctx.fill();
    ctx.fillStyle = meta.palette.ground1;
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w * 0.18, h * 0.6); ctx.lineTo(w * 0.4, h * 0.8); ctx.lineTo(w * 0.62, h * 0.5); ctx.lineTo(w * 0.85, h * 0.82); ctx.lineTo(w, h * 0.7); ctx.lineTo(w, h); ctx.fill();
  } else if (biomeId === 'snow') {
    ctx.fillStyle = meta.palette.ground2;
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w * 0.2, h * 0.4); ctx.lineTo(w * 0.5, h * 0.7); ctx.lineTo(w * 0.75, h * 0.3); ctx.lineTo(w, h * 0.6); ctx.lineTo(w, h); ctx.fill();
    ctx.fillStyle = meta.palette.ground1;
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w * 0.2, h * 0.6); ctx.lineTo(w * 0.5, h * 0.85); ctx.lineTo(w * 0.75, h * 0.55); ctx.lineTo(w, h * 0.75); ctx.lineTo(w, h); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 25; i++) ctx.fillRect(Math.random() * w, Math.random() * h * 0.6, 2, 2);
  } else if (biomeId === 'coast') {
    ctx.fillStyle = meta.palette.ground1;
    ctx.fillRect(0, h * 0.62, w, h * 0.15);
    ctx.fillStyle = meta.palette.ground2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(0, h * 0.8 + i * 8);
      for (let x = 0; x <= w; x += 14) ctx.lineTo(x, h * 0.8 + i * 8 + Math.sin(x * 0.05 + i) * 6);
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
    }
  }
}

/* ---------- material-flow streaks (landslide / rockfall / avalanche - stuff moving downhill) ---------- */
function drawFlowStreaks(ctx, w, h, t, intensity, dirVec, color) {
  if (intensity <= 0.02) return;
  ctx.save();
  ctx.strokeStyle = color || 'rgba(130,100,60,0.5)';
  ctx.lineWidth = 2;
  const count = 16;
  const diag = w + h;
  for (let i = 0; i < count; i++) {
    const seed = i * 97.13 + 11.7;
    const baseX = (seed * 53.7) % w;
    const baseY = (seed * 31.3) % h;
    const travel = (t * (70 + intensity * 170) + seed * 19) % diag;
    const x = ((baseX + dirVec.x * travel) % w + w) % w;
    const y = ((baseY + dirVec.y * travel) % h + h) % h;
    const len = 16 + intensity * 28;
    ctx.globalAlpha = 0.2 + intensity * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - dirVec.x * len, y - dirVec.y * len);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------- earthquake shock rings, expanding outward from the epicenter ---------- */
function drawQuakeRings(ctx, w, h, t, intensity, ex, ey) {
  if (intensity <= 0.1) return;
  ctx.save();
  const maxR = Math.max(w, h) * 0.75;
  for (let i = 0; i < 3; i++) {
    const r = ((t * (55 + i * 18) + i * 60) % maxR) + 8;
    const fade = Math.max(0, 1 - r / maxR);
    ctx.strokeStyle = `rgba(255,110,60,${fade * 0.4 * intensity})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

/* ---------- disaster-phase hazard overlay: each disaster gets its own visual signature,
   not a generic tint. Intensity is 0..1 and driven by the caller (prep countdown ramp
   or simulation progress ramp). scenario needs {kind, disaster, direction, epicenter}. ---------- */
function createHazardOverlayScene(canvas, scenario, dirVec) {
  const kind = scenario.kind;
  const disaster = scenario.disaster;
  const epi = scenario.epicenter;
  let intensity = 0.05;
  const rain = makeParticles('rain', 90, 900, 600);
  const snow = makeParticles('snow', 90, 900, 600);
  const sand = makeParticles('sand', 90, 900, 600);
  const dust = makeParticles('dust', 50, 900, 600);

  const scene = createScene(canvas, (ctx, w, h, dt, t) => {
    ctx.clearRect(0, 0, w, h);

    if (disaster === 'tsunami') {
      /* No rain (a tsunami isn't a rainstorm) and no decorative overlay lines -
         the real wave (front, foam, spreading water) is drawn from the actual
         simulated depth field on the hazard canvas underneath. This ambient
         layer only adds rougher surf at the shoreline as the threat builds. */
      drawWaves(ctx, w, h, t, intensity, h * (1 - intensity * 0.15));
    } else if (disaster === 'coastalflood' || disaster === 'stormsurge' || disaster === 'flashflood') {
      rain.forEach(p => { stepParticle(p, 'rain', dt, intensity, w, h, dirVec); drawParticle(ctx, p, 'rain'); });
      drawWaves(ctx, w, h, t, intensity, h * (1 - intensity * 0.15));
    } else if (disaster === 'typhoon') {
      rain.forEach(p => { stepParticle(p, 'rain', dt, intensity, w, h, dirVec); drawParticle(ctx, p, 'rain', 'rgba(150,190,255,0.55)'); });
      drawWaves(ctx, w, h, t, intensity * 1.1, h * (1 - intensity * 0.2));
    } else if (disaster === 'sandstorm') {
      sand.forEach(p => { stepParticle(p, 'sand', dt, intensity, w, h, dirVec); drawParticle(ctx, p, 'sand'); });
      ctx.save(); ctx.fillStyle = `rgba(220,180,110,${0.04 + intensity * 0.10})`; ctx.fillRect(0, 0, w, h); ctx.restore();
    } else if (disaster === 'blizzard' || disaster === 'snowstorm') {
      snow.forEach(p => { stepParticle(p, 'snow', dt, intensity, w, h, dirVec); drawParticle(ctx, p, 'snow', 'rgba(255,255,255,0.9)'); });
      ctx.save(); ctx.fillStyle = `rgba(220,240,255,${0.03 + intensity * 0.08})`; ctx.fillRect(0, 0, w, h); ctx.restore();
    } else if (disaster === 'avalanche') {
      snow.forEach(p => { stepParticle(p, 'snow', dt, intensity, w, h, dirVec); drawParticle(ctx, p, 'snow', 'rgba(255,255,255,0.85)'); });
      drawFlowStreaks(ctx, w, h, t, intensity, dirVec, 'rgba(220,235,245,0.55)');
    } else if (disaster === 'landslide' || disaster === 'rockfall') {
      dust.forEach(p => { stepParticle(p, 'dust', dt, intensity, w, h); drawParticle(ctx, p, 'dust'); });
      drawFlowStreaks(ctx, w, h, t, intensity, dirVec, 'rgba(120,90,55,0.55)');
    } else if (kind === 'quake') {
      dust.forEach(p => { stepParticle(p, 'dust', dt, intensity, w, h); drawParticle(ctx, p, 'dust'); });
      const ex = epi ? (epi.gx + 0.5) / TERRAIN_GRID_SIZE * w : w / 2;
      const ey = epi ? (epi.gy + 0.5) / TERRAIN_GRID_SIZE * h : h / 2;
      drawQuakeRings(ctx, w, h, t, intensity, ex, ey);
    } else if (kind === 'heat') {
      ctx.save();
      ctx.fillStyle = `rgba(255,150,50,${0.03 + intensity * 0.09})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  });
  return {
    start: scene.start, stop: scene.stop, resize: scene.resize,
    setIntensity(v) { intensity = v; }
  };
}
