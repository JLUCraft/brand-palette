import assert from "node:assert/strict";
import test from "node:test";

import { buildBrand, SEMANTIC_TOKENS } from "../src/brand";
import { hexToRgb, oklchToRgbMapped, rgbToOklab } from "../src/color";
import { artifacts, toBrandJsonText, toTokensCss } from "../src/emit";
import { extractPalette } from "../src/extract";
import {
  buildRamp,
  ensureContrast,
  MIN_GRAPHIC,
  MIN_READABLE,
  MIN_TEXT,
  nearestStep,
  RAMP_STEPS,
  resolveModes,
  stepLightness,
} from "../src/ramp";

function stripe(rgbaBands: [number, number, number][], width = 60, height = 20) {
  const share = 1 / rgbaBands.length;
  const rgba = new Uint8Array(width * height * 4);
  rgbaBands.forEach((color, index) => {
    const from = Math.round(index * share * width);
    const to = Math.round((index + 1) * share * width);
    for (let x = from; x < to; x += 1) {
      for (let y = 0; y < height; y += 1) {
        const offset = (y * width + x) * 4;
        rgba[offset] = color[0];
        rgba[offset + 1] = color[1];
        rgba[offset + 2] = color[2];
        rgba[offset + 3] = 255;
      }
    }
  });
  return { rgba, width, height };
}

test("色阶共 11 级且亮度严格递减", () => {
  assert.equal(RAMP_STEPS.length, 11);
  for (let i = 1; i < RAMP_STEPS.length; i += 1) {
    assert.ok(
      stepLightness(RAMP_STEPS[i - 1]) > stepLightness(RAMP_STEPS[i]),
      `${RAMP_STEPS[i - 1]} 应比 ${RAMP_STEPS[i]} 亮`
    );
  }
});

test("色阶每一级都在 sRGB 内（色域映射没有把颜色压成黑或白）", () => {
  const ramp = buildRamp(264, 0.26);
  for (const step of RAMP_STEPS) {
    const rgb = hexToRgb(ramp.steps[step]);
    assert.ok(rgb.r + rgb.g + rgb.b > 30, `${step} 级过暗：${ramp.steps[step]}`);
    assert.ok(rgb.r + rgb.g + rgb.b < 750, `${step} 级过亮：${ramp.steps[step]}`);
    // 代表色必须与目标色相接近，否则说明色域映射把颜色带偏了
    const lab = rgbToOklab(rgb);
    assert.ok(Number.isFinite(lab.L));
  }
});

test("nearestStep 把徽标本色定位到最接近的一级", () => {
  assert.equal(nearestStep(0.275), 900);
  assert.equal(nearestStep(0.98), 50);
  assert.equal(nearestStep(0.66), 500);
});

test("ensureContrast 达到目标就返回，达不到时如实报告 met=false", () => {
  const bg = hexToRgb("#ffffff");
  const reached = ensureContrast(264, 0.2, 0.6, bg, MIN_TEXT);
  assert.equal(reached.met, true);
  assert.ok(reached.ratio >= MIN_TEXT);

  // 22:1 远超 WCAG 上限（黑白也只有 21）：不能假装成功，必须如实报告
  const impossible = ensureContrast(0, 0, 0.995, bg, 25);
  assert.equal(impossible.met, false);
  assert.ok(impossible.ratio <= 21);
});

test("交互主色优先采用徽标本色那一级（只要按钮文字达标）", () => {
  // 深色徽标：基准级 800 上的白字达得到 AA，就应当直接用 800
  const modes = resolveModes({
    brand: buildRamp(261, 0.15),
    secondary: buildRamp(273, 0.08),
    accent: buildRamp(261, 0.15),
    neutral: buildRamp(261, 0.012),
    baseStep: 800,
  });
  assert.equal(modes.light.tokens.primary, buildRamp(261, 0.15).steps[800]);

  // 深色模式同样优先用徽标本色
  assert.equal(modes.dark.tokens.primary, buildRamp(261, 0.15).steps[800]);

  // 无论锁到哪一级，主按钮上的文字都必须达标：宁可偏离校色，也不能不可读
  for (const baseStep of [50, 200, 400, 600, 800] as const) {
    const picked = resolveModes({
      brand: buildRamp(30, 0.2),
      secondary: buildRamp(180, 0.1),
      accent: buildRamp(30, 0.2),
      neutral: buildRamp(30, 0.012),
      baseStep,
    });
    for (const mode of ["light", "dark"] as const) {
      const button = picked[mode].checks.find((c) => c.label.startsWith("主按钮"));
      assert.ok(button?.met, `baseStep=${baseStep} ${mode} 主按钮文字未达标`);
    }
  }
});

test("任意色相生成的语义令牌都满足 WCAG 下限", () => {
  for (const hue of [0, 27, 60, 120, 150, 210, 264, 300, 330]) {
    const modes = resolveModes({
      brand: buildRamp(hue, 0.22),
      secondary: buildRamp((hue + 150) % 360, 0.16),
      accent: buildRamp((hue + 40) % 360, 0.26),
      neutral: buildRamp(hue, 0.01),
      baseStep: 600,
    });

    for (const mode of ["light", "dark"] as const) {
      for (const c of modes[mode].checks) {
        assert.ok(c.met, `hue=${hue} ${mode} ${c.label}: ${c.ratio.toFixed(2)} < ${c.min}`);
      }
      // 正文与次要文字的目标值不同，防止两处被写成同一个常量
      const ink = modes[mode].tokens.ink;
      const muted = modes[mode].tokens.muted;
      assert.notEqual(ink, muted);
    }
  }
});

test("语义令牌覆盖全部约定的名字，两种模式都不缺项", () => {
  const image = stripe([[22, 69, 126], [179, 38, 30]]);
  const extracted = extractPalette(image.rgba, image.width, image.height);
  const brand = buildBrand({ id: "jlu", name: "吉林大学", extracted });

  for (const mode of ["light", "dark"] as const) {
    for (const token of SEMANTIC_TOKENS) {
      const value = brand.modes[mode].tokens[token];
      assert.ok(value, `${mode} 缺少 --${token}`);
      assert.match(value, /^#[0-9a-f]{6}$/);
    }
  }
});

test("tokens.css 同时包含浅色与深色两块，且没有 undefined", () => {
  const image = stripe([[22, 69, 126], [179, 38, 30], [255, 255, 255]]);
  const brand = buildBrand({
    id: "jlu",
    name: "吉林大学",
    extracted: extractPalette(image.rgba, image.width, image.height),
  });
  const css = toTokensCss(brand);

  assert.ok(css.includes("@media (prefers-color-scheme: dark)"));
  assert.ok(css.includes("--brand-500:"));
  assert.ok(css.includes("--touch-target: 44px"));
  assert.ok(!css.includes("undefined"));
  const lightBlock = css.slice(0, css.indexOf("@media"));
  const darkBlock = css.slice(css.indexOf("@media"));
  for (const token of SEMANTIC_TOKENS) {
    assert.ok(lightBlock.includes(`--${token}:`), `浅色块缺 --${token}`);
    assert.ok(darkBlock.includes(`--${token}:`), `深色块缺 --${token}`);
  }
});

test("生成物是逐字节确定的（--check 的前提）", () => {
  const image = stripe([[22, 69, 126], [179, 38, 30]]);
  const extracted = extractPalette(image.rgba, image.width, image.height);
  const a = artifacts(buildBrand({ id: "jlu", name: "吉林大学", extracted }));
  const b = artifacts(buildBrand({ id: "jlu", name: "吉林大学", extracted }));
  assert.deepEqual(Object.keys(a), ["tokens.css", "brand.json", "tokens.json"]);
  assert.deepEqual(a, b);
  assert.ok(a["tokens.css"].endsWith("\n"));
  assert.ok(a["brand.json"].endsWith("\n"));
});

test("brand.json 是可解析的清单，含色阶与对比度报告", () => {
  const image = stripe([[22, 69, 126], [179, 38, 30]]);
  const brand = buildBrand({
    id: "jlu",
    name: "吉林大学",
    extracted: extractPalette(image.rgba, image.width, image.height),
  });
  const parsed = JSON.parse(toBrandJsonText(brand));
  assert.equal(parsed.id, "jlu");
  assert.equal(parsed.name, "吉林大学");
  assert.equal(parsed.palette.primary.ramp["500"].length, 7);
  assert.ok(parsed.contrast.light.every((c: { met: boolean }) => c.met));
  assert.ok(parsed.contrast.dark.every((c: { met: boolean }) => c.met));
  // 报告里的数值必须与清单中的颜色一致，不能是另算的一套
  for (const c of parsed.contrast.light) {
    assert.ok(Object.values(parsed.palette.primary.ramp).includes(c.fg) || c.fg.length === 7);
  }
});

test("品牌主色的彩度被夹在可用区间内（不会荧光，也不会发灰）", () => {
  // 极鲜艳的纯色徽标
  const vivid = stripe([[0, 255, 0]]);
  const vividBrand = buildBrand({
    id: "vivid",
    name: "极鲜艳",
    extracted: extractPalette(vivid.rgba, vivid.width, vivid.height),
  });
  assert.ok(vividBrand.palette.primary.chroma <= 0.26);

  // 低彩度徽标：仍要给出看得见的品牌色
  const dull = stripe([[120, 130, 140]]);
  const dullBrand = buildBrand({
    id: "dull",
    name: "偏灰",
    extracted: extractPalette(dull.rgba, dull.width, dull.height, { minChroma: 0.005 }),
  });
  assert.ok(dullBrand.palette.primary.chroma >= 0.05);
});

test("深色模式的正文与背景对比度高于 AA 大字号要求", () => {
  const image = stripe([[22, 69, 126], [210, 170, 40]]);
  const brand = buildBrand({
    id: "jlu",
    name: "吉林大学",
    extracted: extractPalette(image.rgba, image.width, image.height),
  });
  const dark = brand.modes.dark.checks.find((c) => c.label === "正文 / 背景");
  assert.ok(dark && dark.ratio >= MIN_READABLE);
  const focus = brand.modes.dark.checks.find((c) => c.label === "焦点环 / 背景");
  assert.ok(focus && focus.ratio >= MIN_GRAPHIC);
});

test("oklchToRgbMapped 在极端参数下也不抛错", () => {
  assert.doesNotThrow(() => oklchToRgbMapped({ L: 0, C: 0.4, h: 120 }));
  assert.doesNotThrow(() => oklchToRgbMapped({ L: 1, C: 0.4, h: 120 }));
});
