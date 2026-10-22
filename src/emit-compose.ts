/**
 * Compose Material 3 配色生成物（union-manager 用）。
 *
 * Material3 的 ColorScheme 有固定的槽位语义，这里把品牌令牌映射进去：
 * 容器色取自品牌色阶，表面色取自中性色阶，前景色由对比度计算得出而不是手填。
 */

import type { Brand } from "./brand";
import { contrastRatio, hexToRgb, rgbToHex, rgbToOklab, WHITE_RGB } from "./color";
import { ensureContrast, MIN_TEXT } from "./ramp";

/** Compose 的 ColorScheme 槽位顺序，同时也是生成文件里的书写顺序。 */
const SLOTS = [
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "background",
  "onBackground",
  "surface",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "outline",
  "outlineVariant",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
] as const;

type Slot = (typeof SLOTS)[number];

/**
 * Compose 槽位上的前景色：先在白与最深中性色之间挑，都达不到 AA 就把前景
 * 沿无彩度亮度轴推开。M3 不管这件事，配色错了只能靠这里兜住。
 */
function onColor(fgCandidates: string[], background: string, hue: number): string {
  const bg = hexToRgb(background);
  let best = fgCandidates[0];
  let bestRatio = contrastRatio(hexToRgb(best), bg);
  for (const candidate of fgCandidates.slice(1)) {
    const ratio = contrastRatio(hexToRgb(candidate), bg);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  if (bestRatio >= MIN_TEXT) return best;
  return ensureContrast(hue, 0, rgbToOklab(hexToRgb(best)).L, bg, MIN_TEXT).hex;
}

function slots(brand: Brand, mode: "light" | "dark"): Record<Slot, string> {
  const dark = mode === "dark";
  const t = brand.modes[mode].tokens;
  const ramp = brand.palette.primary.ramp;
  const secondaryRamp = brand.palette.secondary.ramp;
  const accentRamp = brand.palette.accent.ramp;
  const neutralRamp = brand.palette.neutral.ramp;

  const tertiary = accentRamp[dark ? 300 : 600];
  const onTertiary = onColor(
    [rgbToHex(WHITE_RGB), neutralRamp[dark ? 50 : 950]],
    tertiary,
    brand.palette.accent.hue
  );

  return {
    primary: t.primary,
    onPrimary: t["on-primary"],
    primaryContainer: ramp[dark ? 800 : 100],
    onPrimaryContainer: ramp[dark ? 100 : 900],
    secondary: t.secondary,
    onSecondary: t["on-secondary"],
    secondaryContainer: secondaryRamp[dark ? 800 : 100],
    onSecondaryContainer: secondaryRamp[dark ? 100 : 900],
    tertiary,
    onTertiary,
    background: t.bg,
    onBackground: t.ink,
    surface: t.surface,
    onSurface: t.ink,
    surfaceVariant: t["surface-alt"],
    onSurfaceVariant: t.muted,
    surfaceContainerLowest: dark ? neutralRamp[950] : t.surface,
    surfaceContainerLow: dark ? neutralRamp[900] : t.surface,
    surfaceContainer: neutralRamp[dark ? 800 : 100],
    surfaceContainerHigh: neutralRamp[dark ? 700 : 200],
    surfaceContainerHighest: neutralRamp[dark ? 600 : 300],
    outline: t["line-strong"],
    outlineVariant: t.line,
    error: t.error,
    onError: t["on-error"],
    errorContainer: t["error-bg"],
    onErrorContainer: t.error,
  };
}

/** Kotlin 的 Color(0xFFRRGGBB) 字面量。 */
function kotlinColor(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const part = (v: number) => v.toString(16).padStart(2, "0").toUpperCase();
  return `Color(0xFF${part(r)}${part(g)}${part(b)})`;
}

export function toComposeTheme(brand: Brand): string {
  const light = slots(brand, "light");
  const dark = slots(brand, "dark");

  const scheme = (name: string, values: Record<Slot, string>, builder: string) =>
    `internal val ${name} = ${builder}(\n${SLOTS.map(
      (slot) => `    ${slot} = ${kotlinColor(values[slot])},`
    ).join("\n")}\n)\n`;

  return `// 生成文件，请勿手改。
// 来源：brands/${brand.id}/brand.json
// 生成器：brand-palette --compose

package com.jlucraft.manager.nativecore

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

${scheme("BrandLightColors", light, "lightColorScheme")}
${scheme("BrandDarkColors", dark, "darkColorScheme")}`;
}

/** 生成文件的对比度自检：Compose 槽位不参与 WCAG 校验，但按钮与背景必须可读。 */
export function composeContrastFailures(brand: Brand): string[] {
  const failures: string[] = [];
  for (const mode of ["light", "dark"] as const) {
    const values = slots(brand, mode);
    const pairs: [Slot, Slot][] = [
      ["primary", "onPrimary"],
      ["secondary", "onSecondary"],
      ["tertiary", "onTertiary"],
      ["error", "onError"],
      ["background", "onBackground"],
      ["surface", "onSurface"],
    ];
    for (const [bgSlot, fgSlot] of pairs) {
      const ratio = contrastRatio(hexToRgb(values[fgSlot]), hexToRgb(values[bgSlot]));
      if (ratio < MIN_TEXT) {
        failures.push(
          `${mode} ${bgSlot}/${fgSlot} = ${ratio.toFixed(2)} < ${MIN_TEXT}`
        );
      }
    }
  }
  return failures;
}
