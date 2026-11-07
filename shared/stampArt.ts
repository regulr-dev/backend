// Shared by the server (Google Wallet hero image, rendered to PNG) and the React app
// (the web card), so both always show the same picture.
//
// The picture is a "reward ladder": a line across the shop's cover photo with one icon
// per reward, lit up once the customer has enough stamps for it. Stamps aren't reset
// when a reward is reached; customers spend them on any reward they can afford.

export const REWARD_ICONS = ['gift', 'coffee', 'drink', 'food', 'pizza', 'cake', 'percent', 'star'] as const;
export type RewardIcon = (typeof REWARD_ICONS)[number];

export type ProgressReward = { name: string; cost: number; icon?: string | null };

export type StampProgress = {
  /** The next reward the customer can't afford yet, or the top reward once they can afford everything. */
  goal: ProgressReward;
  /** Most expensive reward the customer can claim right now. */
  ready: ProgressReward | null;
  /** Stamps still needed for the goal (0 when it's ready). */
  toGo: number;
};

const byCost = (rewards: ProgressReward[]) => [...rewards].filter((r) => r.cost > 0).sort((a, b) => a.cost - b.cost);

export function stampProgress(rewards: ProgressReward[], balance: number): StampProgress | null {
  const sorted = byCost(rewards);
  if (!sorted.length) return null;
  const affordable = sorted.filter((r) => r.cost <= balance);
  const goal = sorted.find((r) => r.cost > balance) ?? sorted[sorted.length - 1];
  return { goal, ready: affordable.length ? affordable[affordable.length - 1] : null, toGo: Math.max(0, goal.cost - balance) };
}

/** One short line, e.g. "Espresso ready · 3 more for Croissant". */
export function progressCaption(p: StampProgress | null) {
  if (!p) return '';
  const next = p.toGo > 0 ? `${p.toGo} more for ${p.goal.name}` : '';
  if (p.ready && next) return `${p.ready.name} ready · ${next}`;
  if (p.ready) return `${p.ready.name} ready to claim`;
  return next;
}

// Google Wallet's recommended hero image size.
export const ART_WIDTH = 1032;
export const ART_HEIGHT = 336;
/** Taller Wallet picture used when the shop has a cover photo, so more of the photo shows. */
export const TALL_ART_HEIGHT = 560;
/** Rewards shown on the ladder at once; longer menus show the stretch around the customer. */
export const LADDER_SIZE = 5;

const HEX = /^#[0-9a-fA-F]{6}$/;
const safeColor = (c: string, fallback: string) => (HEX.test(c) ? c : fallback);
const escapeAttr = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const n = (x: number) => Math.round(x * 10) / 10;

// --- Icons: drawn from shapes so the PNG renderer needs no fonts. `k` is the colour behind the icon. ---

const rect = (x: number, y: number, w: number, h: number, fill: string, rx = 0, extra = '') =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(rx)}" fill="${fill}"${extra}/>`;
const dot = (cx: number, cy: number, r: number, fill: string, extra = '') => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"${extra}/>`;

function starShape(cx: number, cy: number, r: number, c: string) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${n(cx + rad * Math.cos(a))},${n(cy + rad * Math.sin(a))}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${c}"/>`;
}

const ICONS: Record<RewardIcon, (cx: number, cy: number, s: number, c: string, k: string) => string> = {
  gift: (cx, cy, s, c, k) =>
    [
      `<ellipse cx="${n(cx - s * 0.15)}" cy="${n(cy - s * 0.38)}" rx="${n(s * 0.15)}" ry="${n(s * 0.1)}" fill="none" stroke="${c}" stroke-width="${n(s * 0.07)}"/>`,
      `<ellipse cx="${n(cx + s * 0.15)}" cy="${n(cy - s * 0.38)}" rx="${n(s * 0.15)}" ry="${n(s * 0.1)}" fill="none" stroke="${c}" stroke-width="${n(s * 0.07)}"/>`,
      rect(cx - s * 0.45, cy - s * 0.3, s * 0.9, s * 0.22, c, s * 0.04),
      rect(cx - s * 0.38, cy - s * 0.05, s * 0.76, s * 0.48, c, s * 0.04),
      rect(cx - s * 0.06, cy - s * 0.3, s * 0.12, s * 0.73, k),
      rect(cx - s * 0.48, cy - s * 0.09, s * 0.96, s * 0.04, k),
    ].join(''),
  coffee: (cx, cy, s, c) =>
    [
      rect(cx - s * 0.4, cy - s * 0.18, s * 0.62, s * 0.48, c, s * 0.12),
      `<circle cx="${n(cx + s * 0.25)}" cy="${n(cy)}" r="${n(s * 0.13)}" fill="none" stroke="${c}" stroke-width="${n(s * 0.07)}"/>`,
      rect(cx - s * 0.5, cy + s * 0.34, s * 0.82, s * 0.07, c, s * 0.035),
      rect(cx - s * 0.22, cy - s * 0.46, s * 0.07, s * 0.18, c, s * 0.035),
      rect(cx - s * 0.02, cy - s * 0.46, s * 0.07, s * 0.18, c, s * 0.035),
    ].join(''),
  drink: (cx, cy, s, c, k) =>
    [
      `<line x1="${n(cx + s * 0.04)}" y1="${n(cy - s * 0.25)}" x2="${n(cx + s * 0.24)}" y2="${n(cy - s * 0.5)}" stroke="${c}" stroke-width="${n(s * 0.07)}" stroke-linecap="round"/>`,
      `<polygon points="${n(cx - s * 0.32)},${n(cy - s * 0.27)} ${n(cx + s * 0.32)},${n(cy - s * 0.27)} ${n(cx + s * 0.21)},${n(cy + s * 0.45)} ${n(cx - s * 0.21)},${n(cy + s * 0.45)}" fill="${c}"/>`,
      rect(cx - s * 0.32, cy - s * 0.12, s * 0.64, s * 0.05, k),
    ].join(''),
  food: (cx, cy, s, c) =>
    [
      rect(cx - s * 0.36, cy - s * 0.45, s * 0.05, s * 0.28, c, s * 0.025),
      rect(cx - s * 0.27, cy - s * 0.45, s * 0.05, s * 0.28, c, s * 0.025),
      rect(cx - s * 0.18, cy - s * 0.45, s * 0.05, s * 0.28, c, s * 0.025),
      rect(cx - s * 0.36, cy - s * 0.2, s * 0.23, s * 0.1, c, s * 0.05),
      rect(cx - s * 0.28, cy - s * 0.12, s * 0.07, s * 0.57, c, s * 0.035),
      rect(cx + s * 0.12, cy - s * 0.45, s * 0.17, s * 0.46, c, s * 0.085),
      rect(cx + s * 0.15, cy - s * 0.04, s * 0.08, s * 0.49, c, s * 0.04),
    ].join(''),
  pizza: (cx, cy, s, c, k) =>
    [
      `<polygon points="${n(cx - s * 0.38)},${n(cy - s * 0.28)} ${n(cx + s * 0.38)},${n(cy - s * 0.28)} ${n(cx)},${n(cy + s * 0.48)}" fill="${c}"/>`,
      rect(cx - s * 0.44, cy - s * 0.42, s * 0.88, s * 0.15, c, s * 0.075),
      dot(cx - s * 0.13, cy - s * 0.1, s * 0.07, k),
      dot(cx + s * 0.13, cy - s * 0.06, s * 0.07, k),
      dot(cx, cy + s * 0.14, s * 0.06, k),
    ].join(''),
  cake: (cx, cy, s, c, k) =>
    [
      rect(cx - s * 0.4, cy - s * 0.04, s * 0.8, s * 0.46, c, s * 0.06),
      rect(cx - s * 0.4, cy + s * 0.12, s * 0.8, s * 0.05, k),
      rect(cx - s * 0.04, cy - s * 0.3, s * 0.08, s * 0.24, c, s * 0.02),
      `<ellipse cx="${n(cx)}" cy="${n(cy - s * 0.41)}" rx="${n(s * 0.06)}" ry="${n(s * 0.09)}" fill="${c}"/>`,
    ].join(''),
  percent: (cx, cy, s, c) =>
    [
      `<circle cx="${n(cx - s * 0.2)}" cy="${n(cy - s * 0.22)}" r="${n(s * 0.11)}" fill="none" stroke="${c}" stroke-width="${n(s * 0.08)}"/>`,
      `<circle cx="${n(cx + s * 0.2)}" cy="${n(cy + s * 0.22)}" r="${n(s * 0.11)}" fill="none" stroke="${c}" stroke-width="${n(s * 0.08)}"/>`,
      `<line x1="${n(cx + s * 0.3)}" y1="${n(cy - s * 0.38)}" x2="${n(cx - s * 0.3)}" y2="${n(cy + s * 0.38)}" stroke="${c}" stroke-width="${n(s * 0.09)}" stroke-linecap="round"/>`,
    ].join(''),
  star: (cx, cy, s, c) => starShape(cx, cy + s * 0.03, s * 0.48, c),
};

export function iconSvg(icon: string | null | undefined, cx: number, cy: number, s: number, c: string, k: string) {
  const name = (REWARD_ICONS as readonly string[]).includes(icon ?? '') ? (icon as RewardIcon) : 'gift';
  return ICONS[name](cx, cy, s, c, k);
}

/** A standalone icon for the portal's icon picker. */
export function iconPreviewSvg(icon: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">${iconSvg(icon, 50, 52, 84, 'currentColor', '#ffffff')}</svg>`;
}

// --- The ladder ---

type ArtOptions = {
  bg: string;
  fg: string;
  balance: number;
  rewards: ProgressReward[];
  /** Cover photo: a URL on the web card, a data: URI when rendering the Wallet PNG. */
  photo?: string | null;
  /** Animate the "you are here" marker (web card, after a stamp). */
  pop?: boolean;
  /** Picture height (the width is always ART_WIDTH). Taller pictures put the ladder at the bottom. */
  height?: number;
};

/** The rewards on the ladder and the stamp count where it starts. */
function ladderWindow(rewards: ProgressReward[], balance: number) {
  const sorted = byCost(rewards);
  if (sorted.length <= LADDER_SIZE) return { shown: sorted, startValue: 0 };
  const next = sorted.findIndex((r) => r.cost > balance);
  const from = Math.max(0, Math.min((next === -1 ? sorted.length : next) - 2, sorted.length - LADDER_SIZE));
  return { shown: sorted.slice(from, from + LADDER_SIZE), startValue: from > 0 ? sorted[from - 1].cost : 0 };
}

/** The card picture as an SVG string. Text-free: only numbers, validated colours and an escaped photo URL. */
export function stampArtSvg(o: ArtOptions) {
  const bg = safeColor(o.bg, '#1f2937');
  const fg = safeColor(o.fg, '#ffffff');
  const W = ART_WIDTH;
  const H = o.height ?? ART_HEIGHT;
  const tall = H > ART_HEIGHT;
  const out: string[] = [rect(0, 0, W, H, bg)];

  if (o.photo && tall) {
    // Photo on top, fading into the card colour where the ladder sits.
    const fade = `fade-${bg.slice(1)}`;
    out.push(
      `<defs><linearGradient id="${fade}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${bg}" stop-opacity="0"/><stop offset="0.45" stop-color="${bg}" stop-opacity="0.15"/>` +
        `<stop offset="0.8" stop-color="${bg}" stop-opacity="0.85"/><stop offset="1" stop-color="${bg}" stop-opacity="0.95"/></linearGradient></defs>`,
      `<image href="${escapeAttr(o.photo)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`,
      `<rect width="${W}" height="${H}" fill="url(#${fade})"/>`,
    );
  } else if (o.photo) {
    out.push(
      `<image href="${escapeAttr(o.photo)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`,
      // Tint the photo with the card colour so the ladder stays readable on any picture.
      rect(0, 0, W, H, bg, 0, ' fill-opacity="0.5"'),
    );
  } else {
    out.push(dot(W * 0.86, -20, 190, fg, ' fill-opacity="0.06"'), dot(W * 0.08, H + 40, 150, fg, ' fill-opacity="0.05"'));
  }

  const { shown, startValue } = ladderWindow(o.rewards, o.balance);
  if (shown.length) {
    const cy = tall ? H - 110 : H / 2;
    const x0 = 78;
    const xEnd = W - 78;
    const R = 50;
    const xs = shown.map((_, i) => x0 + ((i + 1) * (xEnd - x0)) / shown.length);

    // Where the customer is: between the last reward they've passed and the next one.
    let tip = xEnd;
    let prevX = x0;
    let prevV = startValue;
    for (let i = 0; i < shown.length; i++) {
      if (o.balance < shown[i].cost) {
        tip = prevX + ((xs[i] - prevX) * Math.max(0, o.balance - prevV)) / (shown[i].cost - prevV);
        break;
      }
      prevX = xs[i];
      prevV = shown[i].cost;
    }

    out.push(
      rect(x0, cy - 6, xEnd - x0, 12, fg, 6, ' fill-opacity="0.35"'),
      rect(x0, cy - 6, Math.max(12, tip - x0), 12, fg, 6),
      dot(x0, cy, 13, fg),
    );
    shown.forEach((r, i) => {
      const reached = o.balance >= r.cost;
      out.push(
        reached
          ? `${dot(xs[i], cy, R, fg)}${iconSvg(r.icon, xs[i], cy, R * 1.05, bg, fg)}`
          : `${dot(xs[i], cy, R - 3, bg, ` stroke="${fg}" stroke-width="6"`)}${iconSvg(r.icon, xs[i], cy, R * 1.05, fg, bg)}`,
      );
    });
    // "You are here", unless it sits on a reward circle already.
    if (!xs.some((x) => Math.abs(x - tip) < R + 24)) {
      const pop = o.pop ? ' class="pop" style="transform-box:fill-box;transform-origin:center"' : '';
      out.push(dot(tip, cy, 21, fg, ` stroke="${bg}" stroke-width="8"${pop}`));
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${out.join('')}</svg>`;
}
