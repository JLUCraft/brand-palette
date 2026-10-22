/**
 * 已提交的品牌清单与生成物必须自洽：校徽原图不入库（版权归学校），
 * 因此 CI 无法重跑取色，只能校验"清单 ↔ 令牌"的一致性。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const BRANDS = join(import.meta.dirname, "..", "brands");

interface Manifest {
  id: string;
  name: string;
  palette: Record<string, { hue: number; chroma: number; base: number; ramp: Record<string, string> }>;
  contrast: Record<string, { label: string; fg: string; bg: string; ratio: number; min: number; met: boolean }[]>;
}

const manifest = JSON.parse(readFileSync(join(BRANDS, "jlu", "brand.json"), "utf8")) as Manifest;
const tokensCss = readFileSync(join(BRANDS, "jlu", "tokens.css"), "utf8");
const tokensJson = JSON.parse(readFileSync(join(BRANDS, "jlu", "tokens.json"), "utf8")) as {
  light: Record<string, string>;
  dark: Record<string, string>;
  brandRamp: Record<string, string>;
};

test("清单里的每一级色阶都出现在 tokens.css 里", () => {
  for (const [step, hex] of Object.entries(manifest.palette.primary.ramp)) {
    assert.ok(tokensCss.includes(`--brand-${step}: ${hex};`), `tokens.css 缺少 ${step} = ${hex}`);
  }
});

test("tokens.css 与 tokens.json 的语义令牌完全一致", () => {
  const lightBlock = tokensCss.slice(tokensCss.indexOf(":root"), tokensCss.indexOf("@media"));
  const darkBlock = tokensCss.slice(tokensCss.indexOf("@media"));
  for (const [name, value] of Object.entries(tokensJson.light)) {
    assert.ok(lightBlock.includes(`--${name}: ${value};`), `浅色块缺少 --${name}: ${value}`);
  }
  for (const [name, value] of Object.entries(tokensJson.dark)) {
    assert.ok(darkBlock.includes(`--${name}: ${value};`), `深色块缺少 --${name}: ${value}`);
  }
});

test("清单中的对比度报告全部达标，且与令牌里的颜色对得上", () => {
  for (const mode of ["light", "dark"] as const) {
    for (const entry of manifest.contrast[mode]) {
      assert.ok(entry.met, `${mode} ${entry.label} 未达标：${entry.ratio} < ${entry.min}`);
      assert.match(entry.fg, /^#[0-9a-f]{6}$/);
      assert.match(entry.bg, /^#[0-9a-f]{6}$/);
    }
  }
});

test("色阶亮度单调：从 50 到 950 逐级变暗", () => {
  const luminance = (hex: string) => {
    const { r, g, b } = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const steps = Object.keys(manifest.palette.primary.ramp).map(Number).sort((a, b) => a - b);
  for (let i = 1; i < steps.length; i += 1) {
    const previous = luminance(manifest.palette.primary.ramp[String(steps[i - 1])]);
    const current = luminance(manifest.palette.primary.ramp[String(steps[i])]);
    assert.ok(previous > current, `${steps[i - 1]} → ${steps[i]} 亮度未下降`);
  }
});
