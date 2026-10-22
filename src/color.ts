/**
 * 纯色彩空间与对比度运算，无依赖：sRGB ↔ OKLab/OKLCh、sRGB 色域映射、WCAG 对比度。
 *
 * 全部使用 OKLab 作为工作空间的原因：它的 L 通道是感知均匀的，同一 L 曲线
 * 跨不同色相看起来亮度一致；RGB/HSL 做不到（蓝色在 HSL 里会被判得很亮）。
 */

export interface Rgb {
  /** 0..255，已取整 */
  r: number;
  g: number;
  b: number;
}

export interface Oklab {
  /** 0..1 感知亮度 */
  L: number;
  a: number;
  b: number;
}

export interface Oklch {
  /** 0..1 感知亮度 */
  L: number;
  /** 0..~0.4 彩度，sRGB 内不会超过约 0.37 */
  C: number;
  /** 色相角度 0..360 */
  h: number;
}

/** sRGB 线性化上限：色域外判定容差，避免浮点误差把合法颜色判成色域外。 */
const GAMUT_EPSILON = 1e-4;

/** 彩度二分搜索的搜索上界；OKLCh 在 sRGB 内的最大值低于它。 */
const MAX_SEARCH_CHROMA = 0.45;

/** 彩度二分搜索的迭代次数，精度约 3e-8，远高于 8 位 sRGB 需要的精度。 */
const GAMUT_SEARCH_STEPS = 24;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const WHITE_RGB: Rgb = { r: 255, g: 255, b: 255 };

export function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgbChannel(linear: number): number {
  const c = clamp01(linear);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(clamp01(s) * 255);
}

export function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const lr = srgbChannelToLinear(r);
  const lg = srgbChannelToLinear(g);
  const lb = srgbChannelToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** 未做色域映射的线性化 sRGB；返回值可能落在 [0,1] 之外，仅用于色域判定与映射。 */
function oklabToLinear({ L, a, b }: Oklab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function inGamut(lab: Oklab): boolean {
  const [r, g, b] = oklabToLinear(lab);
  return [r, g, b].every(
    (c) => c >= -GAMUT_EPSILON && c <= 1 + GAMUT_EPSILON
  );
}

export function oklabToRgb(lab: Oklab): Rgb {
  const [r, g, b] = oklabToLinear(lab);
  return {
    r: linearToSrgbChannel(r),
    g: linearToSrgbChannel(g),
    b: linearToSrgbChannel(b),
  };
}

export function oklabToOklch({ L, a, b }: Oklab): Oklch {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

export function oklchToOklab({ L, C, h }: Oklch): Oklab {
  const rad = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

/** 给定色相下，该亮度在 sRGB 内可达到的最大 C。 */
export function maxChroma(L: number, h: number): number {
  if (L <= 0 || L >= 1) return 0;
  let lo = 0;
  let hi = MAX_SEARCH_CHROMA;
  if (inGamut(oklchToOklab({ L, C: hi, h }))) return hi;

  for (let i = 0; i < GAMUT_SEARCH_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToOklab({ L, C: mid, h }))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** 色域映射：保持 L 与 h，把 C 压到能显示为止。 */
export function oklchToRgbMapped({ L, C, h }: Oklch): Rgb {
  const cappedChroma = Math.min(C, maxChroma(L, h));
  return oklabToRgb(oklchToOklab({ L, C: cappedChroma, h }));
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/** WCAG 2.x 对比度，1..21。 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

export function hexToRgb(hex: string): Rgb {
  const normalized = hex.trim().replace(/^#/, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** 两个色相的圆周距离，0..180。 */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}
