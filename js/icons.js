/* Disaster City Challenge - inline SVG icon library (no emoji, no external assets).
   Every function returns a ready-to-inject SVG markup string. Buildings use a small
   flat-shaded isometric block so they read as structures anchored to the terrain
   rather than flat text glyphs. Status/rank glyphs use currentColor / CSS vars so
   they inherit theme color from their container. */

const ICONS = {};

function svgWrap(viewBox, inner, cls) {
  return `<svg viewBox="${viewBox}" class="${cls || ''}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${inner}</svg>`;
}

/* ---------- buildings (isometric block, anchored at bottom-center) ---------- */
ICONS.house = function (tone) {
  tone = tone || '#caa877';
  const dark = shade(tone, -0.28), light = shade(tone, 0.18), roof = shade(tone, -0.5);
  return svgWrap('0 0 40 44', `
    <polygon points="8,24 20,17 32,24 32,38 8,38" fill="${tone}"/>
    <polygon points="8,24 20,17 20,38 8,38" fill="${dark}"/>
    <polygon points="20,17 32,24 32,38 20,38" fill="${light}"/>
    <polygon points="4,25 20,10 36,25 30,25 20,15 10,25" fill="${roof}"/>
    <rect x="16" y="28" width="8" height="10" fill="${roof}" opacity="0.55"/>
  `, 'icon-building icon-house');
};

ICONS.highrise = function (tone) {
  tone = tone || '#9fb0c2';
  const dark = shade(tone, -0.3), light = shade(tone, 0.2);
  let windows = '';
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 2; col++) {
      windows += `<rect x="${14 + col * 6}" y="${10 + row * 5.5}" width="3.4" height="3" fill="rgba(255,255,255,0.55)"/>`;
    }
  }
  return svgWrap('0 0 40 44', `
    <polygon points="10,8 22,3 34,8 34,40 10,40" fill="${tone}"/>
    <polygon points="10,8 22,3 22,40 10,40" fill="${dark}"/>
    <polygon points="22,3 34,8 34,40 22,40" fill="${light}"/>
    ${windows}
  `, 'icon-building icon-highrise');
};

function shade(hex, amt) {
  const c = hex.replace('#', '');
  const num = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  const f = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(r + (f - r) * p); g = Math.round(g + (f - g) * p); b = Math.round(b + (f - b) * p);
  return `rgb(${r},${g},${b})`;
}

/* ---------- status badges (safe / damaged / destroyed) ---------- */
ICONS.statusBadge = function (status) {
  const colorVar = status === 'safe' ? 'var(--safe)' : status === 'damaged' ? 'var(--warn)' : 'var(--danger)';
  let glyph;
  if (status === 'safe') {
    glyph = `<path d="M8 12.5l2.5 2.5L16 9" stroke="${colorVar}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (status === 'damaged') {
    glyph = `<path d="M12 6 L9 12 L13 13 L10 18" stroke="${colorVar}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else {
    glyph = `<path d="M8 8 L16 16 M16 8 L8 16" stroke="${colorVar}" stroke-width="2.2" stroke-linecap="round"/>`;
  }
  return svgWrap('0 0 24 24', `
    <circle cx="12" cy="12" r="10" fill="rgba(0,0,0,0.35)" stroke="${colorVar}" stroke-width="1.4"/>
    ${glyph}
  `, 'icon-badge icon-badge-' + status);
};

/* ---------- misc UI glyphs ---------- */
ICONS.warning = function () {
  return svgWrap('0 0 24 24', `
    <path d="M12 3 L22 20 L2 20 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <rect x="11.1" y="9" width="1.8" height="6" fill="currentColor"/>
    <rect x="11.1" y="16.2" width="1.8" height="1.8" fill="currentColor"/>
  `, 'icon-warning');
};

ICONS.pause = function () {
  return svgWrap('0 0 24 24', `<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>`, 'icon-pause');
};
ICONS.play = function () {
  return svgWrap('0 0 24 24', `<path d="M7 4 L20 12 L7 20 Z" fill="currentColor"/>`, 'icon-play');
};
ICONS.undo = function () {
  return svgWrap('0 0 24 24', `<path d="M7 8 H15 A5 5 0 0 1 15 18 H10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 4 L5 8 L10 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`, 'icon-undo');
};
ICONS.reset = function () {
  return svgWrap('0 0 24 24', `<path d="M4 12a8 8 0 1 1 3 6.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 16 V12 H8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`, 'icon-reset');
};
ICONS.crosshair = function () {
  return svgWrap('0 0 24 24', `<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="1.6"/>`, 'icon-crosshair');
};
ICONS.close = function () {
  return svgWrap('0 0 24 24', `<path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`, 'icon-close');
};
ICONS.chevronLeft = function () { return svgWrap('0 0 24 24', `<path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`, 'icon-chevron'); };
ICONS.expand = function () {
  return svgWrap('0 0 24 24', `
    <path d="M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  `, 'icon-expand');
};
ICONS.collapse = function () {
  return svgWrap('0 0 24 24', `
    <path d="M9 4v5H4 M15 4v5h5 M9 20v-5H4 M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  `, 'icon-collapse');
};

/* ---------- rank badges ---------- */
ICONS.rankBadge = function (key) {
  const glyphs = {
    trophy: `<path d="M9 4h6v4a3 3 0 0 1-6 0V4Z M7 5H5a2 2 0 0 0 2 4 M17 5h2a2 2 0 0 1-2 4 M10 12v3h4v-3 M8 18h8l-1 2H9l-1-2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
    shield: `<path d="M12 3 L20 6 V12 C20 17 16.5 20.5 12 22 C7.5 20.5 4 17 4 12 V6 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.5 12 L11 14.5 L16 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    brain: `<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5h1a3 3 0 0 0 2-1 M9 4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3 M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5h-1a3 3 0 0 1-2-1 M15 4a3 3 0 0 0-3 3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
    ladder: `<path d="M6 20 L10 4 M14 20 L18 4 M7.4 14h9.6 M8.4 9h9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
    wrench: `<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`
  };
  return svgWrap('0 0 24 24', `<circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.05)" stroke="currentColor" stroke-width="1" opacity="0.5"/>${glyphs[key] || glyphs.shield}`, 'icon-rank icon-rank-' + key);
};
