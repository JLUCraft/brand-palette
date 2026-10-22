/**
 * 把取色结果组装成一份品牌调色板：色相/彩度取自定义来源，亮度曲线固定，
 * 语义令牌与对比度报告由 ramp.ts 的解析器产出。
 */

import type { Extracted } from "./extract";
import {
  buildRamp,
  nearestStep,
  resolveModes,
  RAMP_STEPS,
  type Ramp,
  type RampStep,
  type ResolvedMode,
} from "./ramp";

/** 品牌色的彩度上限：超过它的色相在 sRGB 里会发荧光，且大量不满足对比度。 */
const PRIMARY_MAX_CHROMA = 0.26;
/** 品牌色彩度下限：徽标偏灰时也要给出看得见的品牌色。 */
const PRIMARY_MIN_CHROMA = 0.05;
const SECONDARY_MAX_CHROMA = 0.2;
const SECONDARY_MIN_CHROMA = 0.04;
const ACCENT_MAX_CHROMA = 0.3;
/** 中性色只借用一点品牌色相，避免整页发绿或发蓝。 */
const NEUTRAL_CHROMA_RATIO = 0.08;
const NEUTRAL_MAX_CHROMA = 0.012;
const NEUTRAL_MIN_CHROMA = 0.004;

const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export interface BrandRole {
  /** 色相角，0..360 */
  hue: number;
  /** 峰值彩度 */
  chroma: number;
  /** 与徽标本色最接近的色阶，用作该角色的默认级 */
  base: RampStep;
  ramp: Record<RampStep, string>;
}

export interface Brand {
  id: string;
  name: string;
  /** 徽标只有一个彩色色相；secondary 是按 primary 派生的，不是取出来的 */
  monochrome: boolean;
  source: { pixels: number; used: number; sampled: number };
  palette: {
    primary: BrandRole;
    secondary: BrandRole;
    accent: BrandRole;
    neutral: BrandRole;
  };
  modes: { light: ResolvedMode; dark: ResolvedMode };
}

export interface BuildBrandInput {
  id: string;
  name: string;
  extracted: Extracted;
}

function role(ramp: Ramp, base: RampStep): BrandRole {
  return { hue: ramp.hue, chroma: ramp.chroma, base, ramp: ramp.steps };
}

export function buildBrand({ id, name, extracted }: BuildBrandInput): Brand {
  const primaryChroma = clamp(
    extracted.primary.chroma,
    PRIMARY_MIN_CHROMA,
    PRIMARY_MAX_CHROMA
  );
  const secondaryChroma = clamp(
    extracted.secondary.chroma,
    SECONDARY_MIN_CHROMA,
    SECONDARY_MAX_CHROMA
  );
  const accentChroma = clamp(extracted.accent.chroma, PRIMARY_MIN_CHROMA, ACCENT_MAX_CHROMA);
  const neutralChroma = clamp(
    primaryChroma * NEUTRAL_CHROMA_RATIO,
    NEUTRAL_MIN_CHROMA,
    NEUTRAL_MAX_CHROMA
  );

  const primaryRamp = buildRamp(extracted.primary.hue, primaryChroma);
  const secondaryRamp = buildRamp(extracted.secondary.hue, secondaryChroma);
  const accentRamp = buildRamp(extracted.accent.hue, accentChroma);
  const neutralRamp = buildRamp(extracted.primary.hue, neutralChroma);

  const baseStep = nearestStep(extracted.primary.lab.L);
  const modes = resolveModes({
    brand: primaryRamp,
    secondary: secondaryRamp,
    accent: accentRamp,
    neutral: neutralRamp,
    baseStep,
  });

  return {
    id,
    name,
    monochrome: extracted.monochrome,
    source: extracted.stats,
    palette: {
      primary: role(primaryRamp, baseStep),
      secondary: role(secondaryRamp, nearestStep(extracted.secondary.lab.L)),
      accent: role(accentRamp, nearestStep(extracted.accent.lab.L)),
      neutral: role(neutralRamp, 500),
    },
    modes,
  };
}

/** 全部语义令牌名，供生成器与测试共用一份清单。 */
export const SEMANTIC_TOKENS = [
  "bg",
  "surface",
  "surface-alt",
  "line",
  "line-strong",
  "ink",
  "muted",
  "primary",
  "primary-hover",
  "primary-text",
  "on-primary",
  "secondary",
  "on-secondary",
  "accent",
  "focus",
  "success",
  "on-success",
  "success-bg",
  "error",
  "on-error",
  "error-bg",
] as const;

export { RAMP_STEPS };
