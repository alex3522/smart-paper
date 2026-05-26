// ---------------------------------------------------------------------------
// Tree rendering module
// ---------------------------------------------------------------------------
// Exports: lerpColor, renderBackLayer, renderTree, renderGroveTree
//
// All functions are pure with respect to the DOM — callers pass a context
// object { theme, hour, phase, soundType } so this module has no dependency
// on app state or the document.

// ---------------------------------------------------------------------------
// Colour math
// ---------------------------------------------------------------------------

export function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function rgbStr(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }

// ---------------------------------------------------------------------------
// 12a. Time-of-day shadow (A1)
// ---------------------------------------------------------------------------
// Ground shadow shifts shape and direction with the sun: long pointing west
// at sunrise, short and centred at noon, long pointing east at dusk.
//
// Convention: viewer faces south, so east is screen-LEFT and west is
// screen-RIGHT. Sunrise sun (east) → shadow westward (positive cxOffset);
// dusk sun (west) → shadow eastward (negative cxOffset).

const SHADOW_PALETTE = {
  light:    { day: [60, 45, 30],  night: [70, 85, 115] },
  sepia:    { day: [75, 55, 30],  night: [85, 75, 105] },
  dark:     { day: [0, 0, 0],     night: [10, 15, 30]  },
  midnight: { day: [5, 10, 25],   night: [10, 20, 40]  },
  forest:   { day: [10, 20, 10],  night: [15, 20, 30]  }
};
const SHADOW_BASE_OPACITY = {
  light: 0.16, sepia: 0.14, dark: 0.40, midnight: 0.45, forest: 0.42
};

function getShadowParams(hour, theme) {
  const palette = SHADOW_PALETTE[theme] || SHADOW_PALETTE.light;
  const baseOpacity = SHADOW_BASE_OPACITY[theme] || 0.16;

  let dayWeight;
  if (hour < 5 || hour >= 19)  dayWeight = 0;
  else if (hour < 7)           dayWeight = (hour - 5) / 2;
  else if (hour >= 17)         dayWeight = (19 - hour) / 2;
  else                         dayWeight = 1;

  const sunPos = Math.max(-1, Math.min(1, (hour - 12) / 6));
  const sunAbs = Math.abs(sunPos);

  const rxDay = 30 + 40 * sunAbs;
  const rxNight = 28;
  const rx = Math.round(rxNight + (rxDay - rxNight) * dayWeight);
  const cxOffset = Math.round(-sunPos * 25 * dayWeight);

  const c = palette.day.map((d, i) =>
    Math.round(d * dayWeight + palette.night[i] * (1 - dayWeight))
  );
  const opacity = baseOpacity * (0.55 + 0.45 * dayWeight);

  return {
    cxOffset,
    rx,
    ry: 4,
    fill: `rgba(${c[0]},${c[1]},${c[2]},${opacity.toFixed(3)})`
  };
}

// ---------------------------------------------------------------------------
// 12b. Atmosphere back layer (A2 + A3 + A4)
// ---------------------------------------------------------------------------
// A vertical sky gradient + a horizontal horizon-mist band, drawn behind
// the tree. Plus a subtle phase-linked tint that nudges the sky warmer
// during focus and cooler during break.
//
// Mist (A3): denser when no ambient sound is playing, sparser when active.
// Phase tint (A4): ±~6 RGB nudge, below conscious noticing.

const SKY_PALETTES = {
  light: {
    sunrise: [[240, 232, 236], [250, 232, 215]],
    midday:  [[228, 236, 246], [240, 244, 250]],
    dusk:    [[238, 222, 232], [250, 222, 210]],
    night:   [[195, 205, 222], [205, 213, 226]]
  },
  sepia: {
    sunrise: [[238, 222, 195], [245, 215, 175]],
    midday:  [[228, 226, 208], [238, 234, 218]],
    dusk:    [[232, 202, 190], [240, 200, 180]],
    night:   [[180, 170, 185], [192, 180, 195]]
  },
  dark: {
    sunrise: [[50, 35, 28],   [70, 42, 30]],
    midday:  [[38, 45, 55],   [55, 60, 70]],
    dusk:    [[50, 30, 40],   [70, 32, 35]],
    night:   [[12, 16, 28],   [20, 24, 35]]
  },
  midnight: {
    sunrise: [[38, 32, 52],   [60, 38, 52]],
    midday:  [[30, 42, 65],   [55, 70, 95]],
    dusk:    [[42, 25, 55],   [55, 28, 52]],
    night:   [[10, 14, 32],   [16, 22, 42]]
  },
  forest: {
    sunrise: [[42, 38, 22],   [58, 42, 22]],
    midday:  [[28, 45, 32],   [50, 65, 45]],
    dusk:    [[48, 28, 26],   [60, 28, 26]],
    night:   [[10, 18, 14],   [16, 24, 16]]
  }
};

const MIST_COLOURS = {
  light:    [225, 218, 208],
  sepia:    [210, 198, 180],
  dark:     [80, 80, 88],
  midnight: [55, 70, 100],
  forest:   [55, 75, 60]
};

function getSkyColours(hour, theme) {
  const p = SKY_PALETTES[theme] || SKY_PALETTES.light;
  function pair(a, b, t) { return [lerpColor(a[0], b[0], t), lerpColor(a[1], b[1], t)]; }
  if (hour >= 6 && hour < 12)       return pair(p.sunrise, p.midday, (hour - 6) / 6);
  else if (hour >= 12 && hour < 18) return pair(p.midday, p.dusk, (hour - 12) / 6);
  else if (hour >= 18 && hour < 24) return pair(p.dusk, p.night, (hour - 18) / 6);
  else                              return pair(p.night, p.sunrise, hour / 6);
}

function applyPhaseTint(rgb, phase) {
  if (phase === 'focus') return [Math.min(255, rgb[0] + 6), Math.min(255, rgb[1] + 3), Math.max(0, rgb[2] - 6)];
  if (phase === 'break') return [Math.max(0, rgb[0] - 6), rgb[1], Math.min(255, rgb[2] + 6)];
  return rgb;
}

function getMistOpacity(soundType, theme) {
  const lightish = (theme === 'light' || theme === 'sepia');
  const max = lightish ? 0.32 : 0.50;
  const min = lightish ? 0.08 : 0.16;
  return soundType === 'off' ? max : min;
}

export function renderBackLayer(theme, hour, phase, soundType) {
  const sky = getSkyColours(hour, theme);
  const topT = applyPhaseTint(sky[0], phase);
  const horT = applyPhaseTint(sky[1], phase);
  const mist = MIST_COLOURS[theme] || MIST_COLOURS.light;
  const mistOp = getMistOpacity(soundType, theme);
  let svg = '';
  svg += `<defs><linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="1">`;
  svg += `<stop offset="0%" stop-color="${rgbStr(topT)}"/>`;
  svg += `<stop offset="100%" stop-color="${rgbStr(horT)}"/>`;
  svg += `</linearGradient></defs>`;
  svg += `<rect x="0" y="0" width="200" height="225" fill="url(#sky-grad)"/>`;
  svg += `<rect x="0" y="206" width="200" height="22" fill="rgba(${mist[0]},${mist[1]},${mist[2]},${mistOp.toFixed(2)})"/>`;
  return svg;
}

// ---------------------------------------------------------------------------
// Tree palettes & colour transforms
// ---------------------------------------------------------------------------

const TREE_PALETTES = {
  light: {
    oak: { trunk: '#5b4636', leafLight: '#7c9c4b', leafDark: '#4a6b2e', flower: null },
    willow: { trunk: '#6e5a44', leafLight: '#a8c585', leafDark: '#6b8a4b', flower: null },
    cherry: { trunk: '#5b4636', leafLight: '#f5c4d1', leafDark: '#d4537e', flower: '#fff5f8' }
  },
  dark: {
    oak: { trunk: '#8a6a4a', leafLight: '#a8c570', leafDark: '#6a8a3a', flower: null },
    willow: { trunk: '#9a7a5a', leafLight: '#c0d89a', leafDark: '#88a560', flower: null },
    cherry: { trunk: '#8a6a4a', leafLight: '#f5c4d1', leafDark: '#e89ab8', flower: '#fff5f8' }
  },
  sepia: {
    oak: { trunk: '#5a4124', leafLight: '#8a8b4a', leafDark: '#5a5d2c', flower: null },
    willow: { trunk: '#6a4f30', leafLight: '#a09a6a', leafDark: '#6a6840', flower: null },
    cherry: { trunk: '#5a4124', leafLight: '#d8a8a0', leafDark: '#a86560', flower: '#f0d8c4' }
  },
  midnight: {
    oak: { trunk: '#6a5a4a', leafLight: '#7a9080', leafDark: '#4a6058', flower: null },
    willow: { trunk: '#7a6a58', leafLight: '#9aa8a8', leafDark: '#5a7068', flower: null },
    cherry: { trunk: '#6a5a4a', leafLight: '#c8a8c0', leafDark: '#8a6890', flower: '#e8d8ea' }
  },
  forest: {
    oak: { trunk: '#7a5838', leafLight: '#a8c860', leafDark: '#608a30', flower: null },
    willow: { trunk: '#8a6848', leafLight: '#c8d890', leafDark: '#80a058', flower: null },
    cherry: { trunk: '#7a5838', leafLight: '#f0b0c8', leafDark: '#d07090', flower: '#fff0f5' }
  }
};

const GROVE_PALETTES = {
  light:    { oak: { trunk: '#5b4636', leaf: '#6b8a3d' }, willow: { trunk: '#6e5a44', leaf: '#8eaf6a' }, cherry: { trunk: '#5b4636', leaf: '#e08aab' } },
  dark:     { oak: { trunk: '#8a6a4a', leaf: '#88a560' }, willow: { trunk: '#9a7a5a', leaf: '#a0c080' }, cherry: { trunk: '#8a6a4a', leaf: '#e89ab8' } },
  sepia:    { oak: { trunk: '#5a4124', leaf: '#7a7c40' }, willow: { trunk: '#6a4f30', leaf: '#928e58' }, cherry: { trunk: '#5a4124', leaf: '#c89490' } },
  midnight: { oak: { trunk: '#6a5a4a', leaf: '#688078' }, willow: { trunk: '#7a6a58', leaf: '#7a8a82' }, cherry: { trunk: '#6a5a4a', leaf: '#a888a8' } },
  forest:   { oak: { trunk: '#7a5838', leaf: '#88b048' }, willow: { trunk: '#8a6848', leaf: '#a0c068' }, cherry: { trunk: '#7a5838', leaf: '#d890a8' } }
};

// wither: blend toward muted browns. preserved: blend toward autumnal +
// partial desaturation (factor < 1 keeps some original character).
const TRANSFORM_TARGETS = {
  light:    { wither: { r: 140, g: 110, b: 80 }, preserved: { r: 180, g: 140, b: 90, factor: 0.55 } },
  dark:     { wither: { r: 100, g: 80, b: 60 },  preserved: { r: 140, g: 110, b: 70, factor: 0.5 } },
  sepia:    { wither: { r: 130, g: 100, b: 70 }, preserved: { r: 165, g: 125, b: 80, factor: 0.5 } },
  midnight: { wither: { r: 80, g: 75, b: 90 },   preserved: { r: 110, g: 100, b: 120, factor: 0.5 } },
  forest:   { wither: { r: 90, g: 80, b: 50 },   preserved: { r: 130, g: 110, b: 70, factor: 0.5 } }
};

function getPalette(species, theme) {
  const palettes = TREE_PALETTES[theme] || TREE_PALETTES.light;
  return palettes[species] || palettes.oak;
}
function getWitherTarget(theme)    { return (TRANSFORM_TARGETS[theme] || TRANSFORM_TARGETS.light).wither; }
function getPreservedTarget(theme) { return (TRANSFORM_TARGETS[theme] || TRANSFORM_TARGETS.light).preserved; }

// ---------------------------------------------------------------------------
// renderTree — main tree panel SVG
// ---------------------------------------------------------------------------
// ctx = { theme, hour, phase, soundType }

export function renderTree(species, growth, wither, sway, preserved, intoElement, ctx) {
  const { theme, hour, phase, soundType } = ctx;
  const w = 200, h = 240;
  const trunkBaseY = h - 20;
  const trunkTopY = trunkBaseY - (40 + 80 * growth);
  const cx = w / 2;

  const p = getPalette(species, theme);

  function applyWither(hex, witherAmount) {
    if (witherAmount <= 0) return hex;
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    const t = getWitherTarget(theme);
    return `rgb(${Math.round(r + (t.r - r) * witherAmount)},${Math.round(g + (t.g - g) * witherAmount)},${Math.round(b + (t.b - b) * witherAmount)})`;
  }
  function applyPreserved(hex) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    const t = getPreservedTarget(theme);
    return `rgb(${Math.round(r * t.factor + t.r * (1-t.factor))},${Math.round(g * t.factor + t.g * (1-t.factor))},${Math.round(b * t.factor + t.b * (1-t.factor))})`;
  }

  const colorTransform = preserved ? applyPreserved : (c) => applyWither(c, wither);
  const trunkColor = colorTransform(p.trunk);
  const leafLight = colorTransform(p.leafLight);
  const leafDark = colorTransform(p.leafDark);
  const flowerColor = p.flower ? colorTransform(p.flower) : null;

  let svg = '';
  svg += renderBackLayer(theme, hour, phase, soundType);
  const shadow = getShadowParams(hour, theme);
  svg += `<ellipse cx="${cx + shadow.cxOffset}" cy="${trunkBaseY+4}" rx="${shadow.rx}" ry="${shadow.ry}" fill="${shadow.fill}"/>`;
  const trunkWidth = 6 + 6 * growth;
  svg += `<path d="M ${cx - trunkWidth/2} ${trunkBaseY} Q ${cx - trunkWidth/3} ${(trunkBaseY+trunkTopY)/2} ${cx - trunkWidth/4} ${trunkTopY} L ${cx + trunkWidth/4} ${trunkTopY} Q ${cx + trunkWidth/3} ${(trunkBaseY+trunkTopY)/2} ${cx + trunkWidth/2} ${trunkBaseY} Z" fill="${trunkColor}"/>`;

  const swayPivotY = trunkTopY + 10;
  svg += `<g transform="rotate(${sway} ${cx} ${swayPivotY})">`;

  if (species === 'oak') {
    const canopyR = 30 + 35 * growth;
    const branchW = Math.max(1.8, trunkWidth * 0.5);
    const forkY = trunkTopY + 6;
    const lbx = cx - canopyR * 0.52, lby = trunkTopY - canopyR * 0.24;
    const rbx = cx + canopyR * 0.52, rby = trunkTopY - canopyR * 0.24;
    // Main branch forks
    svg += `<path d="M ${cx} ${forkY} Q ${cx-canopyR*0.18} ${trunkTopY} ${lbx} ${lby}" stroke="${trunkColor}" stroke-width="${branchW.toFixed(1)}" fill="none" stroke-linecap="round"/>`;
    svg += `<path d="M ${cx} ${forkY} Q ${cx+canopyR*0.18} ${trunkTopY} ${rbx} ${rby}" stroke="${trunkColor}" stroke-width="${branchW.toFixed(1)}" fill="none" stroke-linecap="round"/>`;
    // Sub-branches that poke above canopy
    const sbw = (branchW * 0.55).toFixed(1);
    svg += `<path d="M ${lbx} ${lby} Q ${lbx-canopyR*0.2} ${lby-canopyR*0.28} ${lbx-canopyR*0.08} ${lby-canopyR*0.56}" stroke="${trunkColor}" stroke-width="${sbw}" fill="none" stroke-linecap="round"/>`;
    svg += `<path d="M ${rbx} ${rby} Q ${rbx+canopyR*0.2} ${rby-canopyR*0.28} ${rbx+canopyR*0.08} ${rby-canopyR*0.56}" stroke="${trunkColor}" stroke-width="${sbw}" fill="none" stroke-linecap="round"/>`;
    // Central upward branch
    svg += `<path d="M ${cx} ${forkY} Q ${cx+6} ${trunkTopY-canopyR*0.15} ${cx-5} ${trunkTopY-canopyR*0.58}" stroke="${trunkColor}" stroke-width="${(branchW*0.48).toFixed(1)}" fill="none" stroke-linecap="round"/>`;
    // Canopy dark base
    svg += `<ellipse cx="${cx}" cy="${trunkTopY-canopyR*0.26}" rx="${canopyR}" ry="${canopyR*0.82}" fill="${leafDark}"/>`;
    svg += `<ellipse cx="${cx-canopyR*0.54}" cy="${trunkTopY-canopyR*0.44}" rx="${canopyR*0.62}" ry="${canopyR*0.54}" fill="${leafDark}" opacity="0.8"/>`;
    svg += `<ellipse cx="${cx+canopyR*0.5}" cy="${trunkTopY-canopyR*0.48}" rx="${canopyR*0.6}" ry="${canopyR*0.52}" fill="${leafDark}" opacity="0.8"/>`;
    svg += `<ellipse cx="${cx}" cy="${trunkTopY-canopyR*0.9}" rx="${canopyR*0.38}" ry="${canopyR*0.3}" fill="${leafDark}" opacity="0.85"/>`;
    // Canopy light highlights
    svg += `<ellipse cx="${cx-canopyR*0.4}" cy="${trunkTopY-canopyR*0.55}" rx="${canopyR*0.5}" ry="${canopyR*0.44}" fill="${leafLight}"/>`;
    svg += `<ellipse cx="${cx+canopyR*0.43}" cy="${trunkTopY-canopyR*0.58}" rx="${canopyR*0.46}" ry="${canopyR*0.42}" fill="${leafLight}"/>`;
    svg += `<ellipse cx="${cx+canopyR*0.08}" cy="${trunkTopY-canopyR*0.78}" rx="${canopyR*0.42}" ry="${canopyR*0.36}" fill="${leafLight}"/>`;
    svg += `<ellipse cx="${cx-canopyR*0.66}" cy="${trunkTopY-canopyR*0.26}" rx="${canopyR*0.26}" ry="${canopyR*0.24}" fill="${leafLight}" opacity="0.7"/>`;
    svg += `<ellipse cx="${cx+canopyR*0.64}" cy="${trunkTopY-canopyR*0.24}" rx="${canopyR*0.24}" ry="${canopyR*0.22}" fill="${leafLight}" opacity="0.65"/>`;
  } else if (species === 'willow') {
    const canopyR = 28 + 32 * growth;
    const crownY = trunkTopY - canopyR * 0.35;
    const branchW = Math.max(1.5, trunkWidth * 0.45);
    // Arching branches the strands cascade from
    svg += `<path d="M ${cx} ${trunkTopY} Q ${cx-canopyR*0.32} ${crownY+canopyR*0.12} ${cx-canopyR*0.72} ${crownY+canopyR*0.18}" stroke="${trunkColor}" stroke-width="${branchW.toFixed(1)}" fill="none" stroke-linecap="round"/>`;
    svg += `<path d="M ${cx} ${trunkTopY} Q ${cx+canopyR*0.32} ${crownY+canopyR*0.12} ${cx+canopyR*0.72} ${crownY+canopyR*0.18}" stroke="${trunkColor}" stroke-width="${branchW.toFixed(1)}" fill="none" stroke-linecap="round"/>`;
    svg += `<path d="M ${cx} ${trunkTopY} Q ${cx-4} ${crownY+canopyR*0.05} ${cx+8} ${crownY-canopyR*0.4}" stroke="${trunkColor}" stroke-width="${(branchW*0.65).toFixed(1)}" fill="none" stroke-linecap="round"/>`;
    // Crown dome
    svg += `<ellipse cx="${cx}" cy="${crownY}" rx="${canopyR*0.95}" ry="${canopyR*0.55}" fill="${leafDark}"/>`;
    svg += `<ellipse cx="${cx - canopyR*0.35}" cy="${crownY - canopyR*0.15}" rx="${canopyR*0.55}" ry="${canopyR*0.42}" fill="${leafLight}"/>`;
    svg += `<ellipse cx="${cx + canopyR*0.35}" cy="${crownY - canopyR*0.15}" rx="${canopyR*0.55}" ry="${canopyR*0.42}" fill="${leafLight}"/>`;
    svg += `<ellipse cx="${cx}" cy="${crownY - canopyR*0.3}" rx="${canopyR*0.5}" ry="${canopyR*0.4}" fill="${leafLight}"/>`;
    // Drooping strands
    const strands = 18;
    for (let i = 0; i < strands; i++) {
      const t = i / (strands - 1);
      const angle = (t - 0.5) * Math.PI * 0.95;
      const sx = cx + Math.sin(angle) * canopyR * 0.85;
      const sy = crownY + Math.cos(angle) * canopyR * 0.45;
      const lengthProfile = 1 - Math.abs(t - 0.5) * 1.4;
      const droopLen = (15 + 35 * growth) * Math.max(0.4, lengthProfile) + (Math.sin(i*1.7) * 5);
      const curveOffset = (t - 0.5) * 4;
      const endX = sx + curveOffset;
      const endY = sy + droopLen;
      const ctrlX = sx + curveOffset * 0.4 + 2;
      const ctrlY = sy + droopLen * 0.55;
      const strandColor = i % 3 === 0 ? leafDark : leafLight;
      const strandWidth = i % 2 === 0 ? 2 : 1.5;
      const strandOpacity = i % 3 === 0 ? 0.85 : 0.7;
      svg += `<path d="M ${sx} ${sy} Q ${ctrlX} ${ctrlY} ${endX} ${endY}" stroke="${strandColor}" stroke-width="${strandWidth}" stroke-linecap="round" fill="none" opacity="${strandOpacity}"/>`;
    }
  } else if (species === 'cherry') {
    const canopyR = 28 + 32 * growth;
    const branchW = Math.max(1.8, trunkWidth * 0.5);
    const forkY = trunkTopY + 6;
    const lbx = cx - canopyR * 0.48, lby = trunkTopY - canopyR * 0.22;
    const rbx = cx + canopyR * 0.48, rby = trunkTopY - canopyR * 0.22;
    // Branch forks
    svg += `<path d="M ${cx} ${forkY} Q ${cx-canopyR*0.15} ${trunkTopY} ${lbx} ${lby}" stroke="${trunkColor}" stroke-width="${branchW.toFixed(1)}" fill="none" stroke-linecap="round"/>`;
    svg += `<path d="M ${cx} ${forkY} Q ${cx+canopyR*0.15} ${trunkTopY} ${rbx} ${rby}" stroke="${trunkColor}" stroke-width="${branchW.toFixed(1)}" fill="none" stroke-linecap="round"/>`;
    svg += `<path d="M ${cx} ${forkY} Q ${cx+5} ${trunkTopY-canopyR*0.2} ${cx-4} ${trunkTopY-canopyR*0.6}" stroke="${trunkColor}" stroke-width="${(branchW*0.5).toFixed(1)}" fill="none" stroke-linecap="round"/>`;
    // Canopy
    svg += `<ellipse cx="${cx}" cy="${trunkTopY-canopyR*0.28}" rx="${canopyR}" ry="${canopyR*0.8}" fill="${leafDark}"/>`;
    svg += `<ellipse cx="${cx - canopyR*0.44}" cy="${trunkTopY-canopyR*0.48}" rx="${canopyR*0.65}" ry="${canopyR*0.55}" fill="${leafLight}"/>`;
    svg += `<ellipse cx="${cx + canopyR*0.44}" cy="${trunkTopY-canopyR*0.48}" rx="${canopyR*0.65}" ry="${canopyR*0.55}" fill="${leafLight}"/>`;
    svg += `<ellipse cx="${cx}" cy="${trunkTopY-canopyR*0.73}" rx="${canopyR*0.5}" ry="${canopyR*0.44}" fill="${leafLight}"/>`;
    // Flowers with a bright centre to suggest petals
    if (flowerColor && growth > 0.3 && wither < 0.7) {
      const numFlowers = Math.floor(10 + 14 * growth);
      for (let i = 0; i < numFlowers; i++) {
        const a = (i / numFlowers) * Math.PI * 2 + i * 1.3;
        const r = canopyR * (0.3 + 0.6 * ((i * 13) % 10) / 10);
        const fx = cx + Math.cos(a) * r;
        const fy = trunkTopY - canopyR * 0.38 + Math.sin(a) * r * 0.7;
        const fo = (0.9 - wither * 0.9).toFixed(2);
        svg += `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="3" fill="${flowerColor}" opacity="${fo}"/>`;
        svg += `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="1.2" fill="#fffaf0" opacity="${(parseFloat(fo) * 0.9).toFixed(2)}"/>`;
      }
    }
  }
  svg += `</g>`;
  intoElement.innerHTML = svg;
}

// ---------------------------------------------------------------------------
// renderGroveTree — compact icon for the grove strip
// ---------------------------------------------------------------------------

export function renderGroveTree(species, growth, preserved, theme) {
  const w = 48, h = 56;
  const cx = w / 2;
  const trunkBaseY = h - 4;
  const trunkTopY = trunkBaseY - (12 + 18 * growth);
  const palettes = GROVE_PALETTES[theme] || GROVE_PALETTES.light;
  const p = palettes[species] || palettes.oak;

  function preserve(hex) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    const t = getPreservedTarget(theme);
    return `rgb(${Math.round(r * t.factor + t.r * (1-t.factor))},${Math.round(g * t.factor + t.g * (1-t.factor))},${Math.round(b * t.factor + t.b * (1-t.factor))})`;
  }

  const trunkColor = preserved ? preserve(p.trunk) : p.trunk;
  const leafColor = preserved ? preserve(p.leaf) : p.leaf;
  const trunkWidth = 2 + 2 * growth;
  const canopyR = 8 + 12 * growth;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`;
  svg += `<rect x="${cx - trunkWidth/2}" y="${trunkTopY}" width="${trunkWidth}" height="${trunkBaseY - trunkTopY}" fill="${trunkColor}"/>`;
  svg += `<ellipse cx="${cx}" cy="${trunkTopY - canopyR*0.3}" rx="${canopyR}" ry="${canopyR*0.85}" fill="${leafColor}"/>`;
  svg += `</svg>`;
  return svg;
}
