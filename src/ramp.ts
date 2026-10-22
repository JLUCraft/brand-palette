/**
 * 由色相/彩度生成 11 级色阶（50…950），再把色阶解析成语义令牌并做 WCAG 校验。
 *
 * 色阶的亮度曲线是固定的：同一级在所有品牌下感知亮度一致，组件的层次关系
 * 因此不随校色变深变浅而失效。品牌只决定色相与峰值彩度。
 */

import {
  contrastRatio,
  hexToRgb,
  oklchToRgbMapped,
  rgbToHex,
  rgbToOklab,
  WHITE_RGB,
  type Rgb,
} from "./color";

export const RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type RampStep = (typeof RAMP_STEPS)[number];

/** 每级的目标感知亮度。 */
const LIGHTNESS: Record<RampStep, number> = {
  50: 0.975,
  100: 0.945,
  200: 0.895,
  300: 0.82,
  400: 0.72,
  500: 0.62,
  600: 0.53,
  700: 0.44,
  800: 0.35,
  900: 0.275,
  950: 0.2,
};

/** 彩度相对峰值（500/600）的比例：两端收敛，避免浅色发灰、深色发脏。 */
const CHROMA_MULTIPLIER: Record<RampStep, number> = {
  50: 0.28,
  100: 0.4,
  200: 0.56,
  300: 0.72,
  400: 0.88,
  500: 1,
  600: 1,
  700: 0.92,
  800: 0.76,
  900: 0.6,
  950: 0.48,
};

export interface Ramp {
  hue: number;
  /** 峰值彩度（500/600 级的目标彩度） */
  chroma: number;
  steps: Record<RampStep, string>;
}

export function buildRamp(hue: number, chroma: number): Ramp {
  const steps = {} as Record<RampStep, string>;
  for (const step of RAMP_STEPS) {
    steps[step] = rgbToHex(
      oklchToRgbMapped({
        L: LIGHTNESS[step],
        C: chroma * CHROMA_MULTIPLIER[step],
        h: hue,
      })
    );
  }
  return { hue, chroma, steps };
}

/** 与目标亮度最接近的色阶，用于把徽标本色定位到某一级。 */
export function nearestStep(targetLightness: number): RampStep {
  let best: RampStep = 500;
  let bestDistance = Infinity;
  for (const step of RAMP_STEPS) {
    const d = Math.abs(LIGHTNESS[step] - targetLightness);
    if (d < bestDistance) {
      bestDistance = d;
      best = step;
    }
  }
  return best;
}

/** 色阶的感知亮度，供对比度修复时比较距离用。 */
export function stepLightness(step: RampStep): number {
  return LIGHTNESS[step];
}

export interface ContrastCheck {
  /** 人可读的配对名，例如「正文 / 背景」 */
  label: string;
  fg: string;
  bg: string;
  ratio: number;
  /** 目标比值 */
  min: number;
  met: boolean;
}

/**
 * 对比度修复：保持色相与彩度，只沿亮度轴移动前景色，直到达到目标比值。
 *
 * 达到目标就返回；到不了（极端鲜艳的中间色）就返回最接近的一个，并让
 * 调用方通过 ContrastCheck.met 报告，而不是悄悄放行一个不合规的组合。
 */
export function ensureContrast(
  hue: number,
  chroma: number,
  fromLightness: number,
  against: Rgb,
  min: number
): { hex: string; ratio: number; met: boolean } {
  const candidates: number[] = [fromLightness];
  for (let i = 1; i <= 200; i += 1) {
    const step = i * 0.005;
    candidates.push(fromLightness - step, fromLightness + step);
  }

  let best = { hex: "", ratio: 0, met: false };
  for (const L of candidates) {
    if (L <= 0.02 || L >= 0.995) continue;
    const hex = rgbToHex(oklchToRgbMapped({ L, C: chroma, h: hue }));
    const ratio = contrastRatio(hexToRgb(hex), against);
    if (ratio >= min) return { hex, ratio, met: true };
    if (ratio > best.ratio) best = { hex, ratio, met: false };
  }
  return best;
}

/** 从白与深色两个候选里挑对比度更高的前景色。 */
export function bestForeground(
  backgrounds: Rgb,
  options: { light: Rgb; dark: Rgb }
): Rgb {
  const lightRatio = contrastRatio(options.light, backgrounds);
  const darkRatio = contrastRatio(options.dark, backgrounds);
  return lightRatio >= darkRatio ? options.light : options.dark;
}

/**
 * 按钮上的文字：先在白与深色之间挑对比度更高的一个；两者都不达标（按钮底色
 * 刚好落在中间亮度）时，沿无彩度亮度轴把文字推开到达标为止。
 */
function onColor(bgHex: string, candidates: Rgb[], neutralHue: number): string {
  const bg = hexToRgb(bgHex);
  let best = candidates[0];
  let bestRatio = contrastRatio(best, bg);
  for (const candidate of candidates.slice(1)) {
    const ratio = contrastRatio(candidate, bg);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  if (bestRatio >= MIN_TEXT) return rgbToHex(best);
  return ensureContrast(neutralHue, 0, rgbToOklab(best).L, bg, MIN_TEXT).hex;
}

export interface ResolvedMode {
  tokens: Record<string, string>;
  checks: ContrastCheck[];
}

function check(
  label: string,
  fg: string,
  bg: string,
  min: number
): ContrastCheck {
  const ratio = contrastRatio(hexToRgb(fg), hexToRgb(bg));
  return { label, fg, bg, ratio, min, met: ratio >= min + 1e-9 };
}

/** WCAG AA 正文、AA 大字号/图形、AAA 正文。 */
export const MIN_TEXT = 4.5;
export const MIN_GRAPHIC = 3;
export const MIN_READABLE = 7;

export interface ModeInput {
  brand: Ramp;
  secondary: Ramp;
  accent: Ramp;
  neutral: Ramp;
  /** 与徽标本色最接近的色阶；交互主色优先用它，让界面保留校色本身 */
  baseStep: RampStep;
}

/**
 * 选交互主色：优先用徽标本色那一级，只要按钮上的文字还能达标；
 * 达不到才退到标准的 600（深色模式为 400），保证不会为了忠于校色牺牲可读性。
 */
function choosePrimaryStep(
  ramp: Ramp,
  baseStep: RampStep,
  mode: "light" | "dark"
): { step: RampStep; hover: RampStep } {
  const candidates: RampStep[] =
    mode === "light" ? [baseStep, 600, 700] : [baseStep, 400, 300];
  const readable: RampStep[] = [];

  for (const step of candidates) {
    const rgb = hexToRgb(ramp.steps[step]);
    const white = contrastRatio(WHITE_RGB, rgb);
    const dark = contrastRatio(hexToRgb(ramp.steps[950]), rgb);
    if (Math.max(white, dark) >= MIN_TEXT) readable.push(step);
  }

  const picked = readable[0] ?? (mode === "light" ? 600 : 400);
  const index = RAMP_STEPS.indexOf(picked);
  const hoverIndex = mode === "light" ? index + 1 : index - 1;
  const hover = RAMP_STEPS[Math.min(Math.max(hoverIndex, 0), RAMP_STEPS.length - 1)];
  return { step: picked, hover };
}

function resolveSemantic(
  input: ModeInput,
  mode: "light" | "dark"
): ResolvedMode {
  const { brand, secondary, accent, neutral, baseStep } = input;
  const dark = mode === "dark";

  const bg = neutral.steps[dark ? 950 : 50];
  const bgRgb = hexToRgb(bg);
  const surface = dark ? neutral.steps[900] : rgbToHex(WHITE_RGB);
  const surfaceRgb = hexToRgb(surface);

  const ink = ensureContrast(
    neutral.hue,
    neutral.chroma * CHROMA_MULTIPLIER[900],
    stepLightness(dark ? 50 : 900),
    bgRgb,
    MIN_READABLE
  );
  const muted = ensureContrast(
    neutral.hue,
    neutral.chroma * CHROMA_MULTIPLIER[700],
    stepLightness(dark ? 300 : 700),
    bgRgb,
    MIN_TEXT
  );

  const primary = choosePrimaryStep(brand, baseStep, mode);
  const primaryBase = brand.steps[primary.step];
  // 链接色要同时压在背景与卡片上；卡片更亮（浅色模式）时通常更苛刻，逐个校验。
  let primaryText = ensureContrast(
    brand.hue,
    brand.chroma * CHROMA_MULTIPLIER[dark ? 300 : 700],
    stepLightness(dark ? 300 : 700),
    bgRgb,
    MIN_TEXT
  );
  if (contrastRatio(hexToRgb(primaryText.hex), surfaceRgb) < MIN_TEXT) {
    const onSurface = ensureContrast(
      brand.hue,
      brand.chroma * CHROMA_MULTIPLIER[dark ? 300 : 700],
      stepLightness(dark ? 300 : 700),
      surfaceRgb,
      MIN_TEXT
    );
    if (onSurface.ratio < primaryText.ratio || !onSurface.met) {
      primaryText = onSurface.met ? onSurface : primaryText;
    }
  }

  const onPrimaryHex = onColor(
    primaryBase,
    [WHITE_RGB, hexToRgb(neutral.steps[950])],
    neutral.hue
  );

  const secondaryBase = secondary.steps[dark ? 400 : 600];
  const onSecondaryHex = onColor(
    secondaryBase,
    [WHITE_RGB, hexToRgb(neutral.steps[950])],
    secondary.hue
  );

  const focus = ensureContrast(
    accent.hue,
    accent.chroma,
    stepLightness(dark ? 400 : 600),
    bgRgb,
    MIN_GRAPHIC
  );

  // 语义色不取自校徽：成功/失败必须与品牌无关，只用固定色相保持调性一致。
  const successRamp = buildRamp(150, 0.13);
  const errorRamp = buildRamp(27, 0.16);
  const success = successRamp.steps[dark ? 300 : 700];
  const error = errorRamp.steps[dark ? 300 : 700];
  const onSuccess = onColor(
    success,
    [WHITE_RGB, hexToRgb(neutral.steps[950])],
    neutral.hue
  );
  const onError = onColor(error, [WHITE_RGB, hexToRgb(neutral.steps[950])], neutral.hue);

  const tokens: Record<string, string> = {
    bg,
    surface,
    "surface-alt": neutral.steps[dark ? 800 : 100],
    line: neutral.steps[dark ? 800 : 200],
    "line-strong": neutral.steps[dark ? 700 : 300],
    ink: ink.hex,
    muted: muted.hex,
    primary: primaryBase,
    "primary-hover": brand.steps[primary.hover],
    "primary-text": primaryText.hex,
    "on-primary": onPrimaryHex,
    secondary: secondaryBase,
    "on-secondary": onSecondaryHex,
    accent: accent.steps[dark ? 300 : 600],
    focus: focus.hex,
    success,
    "on-success": onSuccess,
    "success-bg": successRamp.steps[dark ? 900 : 50],
    error,
    "on-error": onError,
    "error-bg": errorRamp.steps[dark ? 900 : 50],
  };

  const checks: ContrastCheck[] = [
    check("正文 / 背景", tokens.ink, bg, MIN_READABLE),
    check("次要文字 / 背景", tokens.muted, bg, MIN_TEXT),
    check("正文 / 卡片", tokens.ink, tokens.surface, MIN_READABLE),
    check("次要文字 / 卡片", tokens.muted, tokens.surface, MIN_TEXT),
    check("链接 / 背景", tokens["primary-text"], bg, MIN_TEXT),
    check("链接 / 卡片", tokens["primary-text"], tokens.surface, MIN_TEXT),
    check("主按钮文字 / 主按钮", tokens["on-primary"], tokens.primary, MIN_TEXT),
    check("次按钮文字 / 次按钮", tokens["on-secondary"], tokens.secondary, MIN_TEXT),
    check("焦点环 / 背景", tokens.focus, bg, MIN_GRAPHIC),
    check("成功文字 / 成功底色", tokens.success, tokens["success-bg"], MIN_TEXT),
    check("错误文字 / 错误底色", tokens.error, tokens["error-bg"], MIN_TEXT),
    check("成功按钮文字 / 成功按钮", tokens["on-success"], tokens.success, MIN_TEXT),
    check("错误按钮文字 / 错误按钮", tokens["on-error"], tokens.error, MIN_TEXT),
  ];

  return { tokens, checks };
}

/** 两种模式共用的、与品牌无关的尺寸与字体令牌。 */
export const LAYOUT_TOKENS: Record<string, string> = {
  "font-sans": 'system-ui, -apple-system, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  "font-mono": 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  "text-xs": "12px",
  "text-sm": "13px",
  "text-md": "14px",
  "text-lg": "16px",
  "text-xl": "20px",
  "text-hero": "clamp(28px, 5vw, 44px)",
  "radius-sm": "8px",
  "radius-md": "10px",
  "radius-lg": "14px",
  "radius-pill": "999px",
  "space-2": "2px",
  "space-4": "4px",
  "space-6": "6px",
  "space-8": "8px",
  "space-10": "10px",
  "space-12": "12px",
  "space-14": "14px",
  "space-16": "16px",
  "space-18": "18px",
  "space-20": "20px",
  "space-24": "24px",
  "space-32": "32px",
  "space-40": "40px",
  "space-48": "48px",
  "space-64": "64px",
  "touch-target": "44px",
  "focus-ring": "3px",
  "focus-ring-offset": "2px",
  "content-max": "880px",
  "page-max": "1120px",
};

export function resolveModes(input: ModeInput): {
  light: ResolvedMode;
  dark: ResolvedMode;
} {
  return {
    light: resolveSemantic(input, "light"),
    dark: resolveSemantic(input, "dark"),
  };
}
