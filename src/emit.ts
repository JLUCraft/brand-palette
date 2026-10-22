/**
 * 生成物：tokens.css（网页直接用）、brand.json（品牌清单，跨端共享）、
 * tokens.json（给 Compose / 启动器的主题生成器读）。
 *
 * 数值统一取整（色相 0.1°、彩度 4 位、对比度 2 位），保证同样的输入生成
 * 逐字节相同的文件，`--check` 才有意义。
 */

import { RAMP_STEPS, type Brand } from "./brand";
import { LAYOUT_TOKENS } from "./ramp";

export const GENERATOR_ID = "brand-palette";

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export interface BrandJson {
  id: string;
  name: string;
  generatedBy: string;
  monochrome: boolean;
  source: { pixels: number; used: number; sampled: number };
  palette: Record<
    "primary" | "secondary" | "accent" | "neutral",
    {
      hue: number;
      chroma: number;
      base: number;
      ramp: Record<string, string>;
    }
  >;
  contrast: Record<
    "light" | "dark",
    { label: string; fg: string; bg: string; ratio: number; min: number; met: boolean }[]
  >;
}

function rampRecord(ramp: Record<number, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const step of RAMP_STEPS) out[String(step)] = ramp[step];
  return out;
}

export function toBrandJson(brand: Brand): BrandJson {
  const role = (key: "primary" | "secondary" | "accent" | "neutral") => {
    const value = brand.palette[key];
    return {
      hue: round(value.hue, 1),
      chroma: round(value.chroma, 4),
      base: value.base,
      ramp: rampRecord(value.ramp),
    };
  };

  const modes = (key: "light" | "dark") =>
    brand.modes[key].checks.map((c) => ({
      label: c.label,
      fg: c.fg,
      bg: c.bg,
      ratio: round(c.ratio, 2),
      min: c.min,
      met: c.met,
    }));

  return {
    id: brand.id,
    name: brand.name,
    generatedBy: `${GENERATOR_ID}`,
    monochrome: brand.monochrome,
    source: brand.source,
    palette: {
      primary: role("primary"),
      secondary: role("secondary"),
      accent: role("accent"),
      neutral: role("neutral"),
    },
    contrast: { light: modes("light"), dark: modes("dark") },
  };
}

export function toBrandJsonText(brand: Brand): string {
  return `${JSON.stringify(toBrandJson(brand), null, 2)}\n`;
}

function declarations(tokens: Record<string, string>, indent: string): string {
  return Object.entries(tokens)
    .map(([name, value]) => `${indent}--${name}: ${value};`)
    .join("\n");
}

export function toTokensCss(brand: Brand): string {
  const base = brand.palette.primary.base;
  const ramp = [
    ...RAMP_STEPS.map(
      (step) => `  --brand-${step}: ${brand.palette.primary.ramp[step]};`
    ),
    // 与徽标本色最接近的一级：品牌形象出现的地方用它，交互控件用下面的 --primary。
    `  --brand-base: ${brand.palette.primary.ramp[base]};`,
  ].join("\n");

  return `/* 生成文件，请勿手改。
 * 来源：brands/${brand.id}/brand.json
 * 生成器：${GENERATOR_ID}（bun run palette）
 */
:root {
${ramp}
${declarations(brand.modes.light.tokens, "  ")}
${declarations(LAYOUT_TOKENS, "  ")}
}

@media (prefers-color-scheme: dark) {
  :root {
${declarations(brand.modes.dark.tokens, "    ")}
  }
}
`;
}

export function toTokensJson(brand: Brand): string {
  return `${JSON.stringify(
    {
      id: brand.id,
      light: brand.modes.light.tokens,
      dark: brand.modes.dark.tokens,
      layout: LAYOUT_TOKENS,
      brandRamp: rampRecord(brand.palette.primary.ramp),
    },
    null,
    2
  )}\n`;
}

/** 生成物的相对路径与内容，CLI 与 `--check` 共用。 */
export function artifacts(brand: Brand): Record<string, string> {
  return {
    "tokens.css": toTokensCss(brand),
    "brand.json": toBrandJsonText(brand),
    "tokens.json": toTokensJson(brand),
  };
}
