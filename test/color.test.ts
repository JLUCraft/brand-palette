import assert from "node:assert/strict";
import test from "node:test";

import {
  contrastRatio,
  hexToRgb,
  hueDistance,
  inGamut,
  maxChroma,
  oklabToOklch,
  oklabToRgb,
  oklchToOklab,
  oklchToRgbMapped,
  rgbToHex,
  rgbToOklab,
} from "../src/color";

const SAMPLES = ["#16457e", "#2e6e52", "#b3261e", "#d2a72b", "#ffffff", "#000000", "#7f7f7f"];

test("sRGB → OKLab → sRGB 往返误差不超过 1", () => {
  for (const hex of SAMPLES) {
    const roundTrip = rgbToHex(oklabToRgb(rgbToOklab(hexToRgb(hex))));
    const a = hexToRgb(hex);
    const b = hexToRgb(roundTrip);
    assert.ok(Math.abs(a.r - b.r) <= 1, `${hex} r ${a.r} vs ${b.r}`);
    assert.ok(Math.abs(a.g - b.g) <= 1, `${hex} g ${a.g} vs ${b.g}`);
    assert.ok(Math.abs(a.b - b.b) <= 1, `${hex} b ${a.b} vs ${b.b}`);
  }
});

test("OKLCh ↔ OKLab 往返保持色相与彩度", () => {
  for (const hue of [0, 45, 150, 264, 300]) {
    const lch = { L: 0.6, C: 0.12, h: hue };
    const back = oklabToOklch(oklchToOklab(lch));
    assert.ok(Math.abs(back.C - 0.12) < 1e-9);
    assert.ok(hueDistance(back.h, hue) < 1e-6);
  }
});

test("WCAG 对比度：黑白 21、同色 1", () => {
  assert.equal(Math.round(contrastRatio(hexToRgb("#000000"), hexToRgb("#ffffff"))), 21);
  assert.equal(contrastRatio(hexToRgb("#2e6e52"), hexToRgb("#2e6e52")), 1);
});

test("对比度与前景背景顺序无关", () => {
  const a = hexToRgb("#16457e");
  const b = hexToRgb("#f3f6f1");
  assert.equal(contrastRatio(a, b), contrastRatio(b, a));
});

test("色域映射的结果一定在 sRGB 内", () => {
  for (const hue of [0, 60, 120, 180, 240, 300]) {
    for (const L of [0.2, 0.5, 0.8]) {
      const mapped = oklchToRgbMapped({ L, C: 0.4, h: hue });
      assert.ok(inGamut(rgbToOklab(mapped)), `h=${hue} L=${L} 映射后仍在色域外`);
    }
  }
});

test("maxChroma 单调：亮度越极端的颜色可用彩度越小", () => {
  const hue = 264;
  const mid = maxChroma(0.6, hue);
  const dark = maxChroma(0.2, hue);
  const light = maxChroma(0.9, hue);
  assert.ok(mid > dark);
  assert.ok(mid > light);
  assert.ok(dark > 0);
});

test("非法 hex 抛错而不是返回垃圾值", () => {
  assert.throws(() => hexToRgb("#12"), /Invalid hex color/);
  assert.throws(() => hexToRgb("nope"), /Invalid hex color/);
});

test("三位简写 hex 等价于六位", () => {
  assert.deepEqual(hexToRgb("#fff"), hexToRgb("#ffffff"));
  assert.deepEqual(hexToRgb("2e6e52"), hexToRgb("#2e6e52"));
});
