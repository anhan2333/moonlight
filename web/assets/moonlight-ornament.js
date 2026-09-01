// moonlight-ornament.js — 月光专属装饰 (慕夏 B 风格)
// 低饱和暖金 + 玫瑰粉 + 赭石，金线藤蔓 + 月相 + 星盘 + 光晕
// 纯函数返回 SVG 字符串，移植自 kimi-manor/mucha.js 并改为月光配色

// ---- 月光配色令牌 (B: 慕夏暖金玫瑰) ----
export const MOON = {
  gold:   '#bda06f',   // 暖金 (春之女神 #BDA06F)
  rose:   '#c17355',   // 玫瑰粉
  ochre:  '#9a6a4a',   // 赭石
  sage:   '#8a9b6e',   // 柔和绿
  ink:    '#2a1a16',   // 深墨 (文字/夜色)
  paper:  '#f7f0e6',   // 暖羊皮纸
  mute:   'rgba(122, 90, 62, 0.55)',
  hair:   'rgba(189, 160, 111, 0.4)',
  glow:   'rgba(212, 154, 86, 0.35)',
};

// --- medallion(圆章): 内环 + 16 放射刻度 + 中心花蕾 ---
export function medallion({ color = MOON.gold, accent = MOON.rose, size = 150 } = {}) {
  let lines = '';
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const r1 = 22, r2 = i % 2 === 0 ? 32 : 28;
    lines += `<line x1="${40 + Math.cos(ang) * r1}" y1="${40 + Math.sin(ang) * r1}" x2="${40 + Math.cos(ang) * r2}" y2="${40 + Math.sin(ang) * r2}" stroke="${color}" stroke-width="0.5"/>`;
  }
  return `<svg viewBox="0 0 80 80" width="${size}" height="${size}" aria-hidden>
    <circle cx="40" cy="40" r="18" fill="none" stroke="${color}" stroke-width="0.6"/>
    <circle cx="40" cy="40" r="14" fill="${accent}" opacity="0.15"/>
    ${lines}
    <circle cx="40" cy="40" r="3" fill="${accent}"/></svg>`;
}

// --- vine(藤蔓分隔线): 波浪 + 3 花蕾 + 2 斜叶 ---
export function vine({ color = MOON.gold, accent = MOON.rose } = {}) {
  const a = accent;
  return `<svg viewBox="0 0 300 24" width="100%" style="display:block" aria-hidden preserveAspectRatio="xMidYMid meet">
    <path d="M10 12 Q30 4 50 12 Q70 20 90 12 Q110 4 130 12 Q150 20 170 12 Q190 4 210 12 Q230 20 250 12 Q270 4 290 12" fill="none" stroke="${color}" stroke-width="0.6"/>
    <g fill="${a}" opacity="0.8"><circle cx="50" cy="12" r="2"/><circle cx="150" cy="12" r="2.5"/><circle cx="250" cy="12" r="2"/></g>
    <g stroke="${color}" fill="none" stroke-width="0.4" opacity="0.6">
      <ellipse cx="90" cy="12" rx="2" ry="5" transform="rotate(20 90 12)"/>
      <ellipse cx="210" cy="12" rx="2" ry="5" transform="rotate(-20 210 12)"/></g></svg>`;
}

// --- mosaic(马赛克角): 6x6 三态拜占庭瓷砖 ---
export function mosaic({ color = MOON.gold, accent = MOON.rose, size = 40 } = {}) {
  let sq = '';
  for (let r = 0; r < 6; r++) for (let q = 0; q < 6; q++) {
    const d = (r + q) % 3;
    const fill = d === 0 ? color : d === 1 ? accent : 'none';
    const op = d === 0 ? 0.18 : d === 1 ? 0.32 : 0.6;
    sq += `<rect x="${q * 10}" y="${r * 10}" width="9" height="9" fill="${fill}" stroke="${color}" stroke-width="0.3" opacity="${op}"/>`;
  }
  return `<svg viewBox="0 0 60 60" width="${size}" height="${size}" aria-hidden>${sq}</svg>`;
}

// --- moonPhase(月相盘): 双弧算法 + 暖金渐变 + 光晕 ---
export function moonPhase({ phase = 0.5, size = 60, gold = MOON.gold } = {}) {
  const r = 12, cx = 12, cy = 12;
  const cosVal = Math.cos(2 * Math.PI * phase);
  const rx = Math.abs(cosVal) * r;
  const isWaxing = phase < 0.5;
  const sweepOuter = isWaxing ? 0 : 1;
  const sweepInner = (cosVal >= 0) === isWaxing ? 1 : 0;
  const shadow = `M ${cx},${cy - r} A ${r},${r} 0 0 ${sweepOuter} ${cx},${cy + r} A ${rx},${r} 0 0 ${sweepInner} ${cx},${cy - r} Z`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden
      style="display:inline-block;filter:drop-shadow(0 0 8px ${MOON.glow}) drop-shadow(0 0 14px rgba(212,154,86,0.18))">
    <defs><radialGradient id="mphl" cx="38%" cy="36%" r="70%">
      <stop offset="0%" stop-color="#fff6e0"/><stop offset="55%" stop-color="#e4d3ad"/><stop offset="100%" stop-color="#9b7c50"/>
    </radialGradient><radialGradient id="mphc" cx="65%" cy="68%" r="38%">
      <stop offset="0%" stop-color="rgba(120,90,50,0.18)"/><stop offset="100%" stop-color="rgba(120,90,50,0)"/>
    </radialGradient></defs>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#mphl)"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#mphc)"/>
    <path d="${shadow}" fill="rgba(14,8,4,0.94)"/></svg>`;
}
