import assert from "node:assert/strict";
import test from "node:test";

import { hexToRgb, hueDistance, oklabToOklch, rgbToOklab } from "../src/color";
import { EmblemError, extractPalette } from "../src/extract";

interface Band {
  color: [number, number, number, number?];
  /** 占图像宽度的比例 0..1，条带从左侧依次排开 */
  share: number;
}

/** 生成竖条带测试图：便于精确控制各色的面积占比。 */
function stripeImage(width: number, height: number, bands: Band[]) {
  const rgba = new Uint8Array(width * height * 4);
  let x = 0;
  for (const band of bands) {
    const bandWidth = Math.round(band.share * width);
    for (let bx = x; bx < Math.min(x + bandWidth, width); bx += 1) {
      for (let y = 0; y < height; y += 1) {
        const offset = (y * width + bx) * 4;
        rgba[offset] = band.color[0];
        rgba[offset + 1] = band.color[1];
        rgba[offset + 2] = band.color[2];
        rgba[offset + 3] = band.color[3] ?? 255;
      }
    }
    x += bandWidth;
  }
  return { rgba, width, height };
}

const NAVY: [number, number, number] = [22, 69, 126];
const RED: [number, number, number] = [179, 38, 30];
const WHITE: [number, number, number] = [255, 255, 255];

test("忽略纸色背景，主色取到徽标本身的深蓝", () => {
  const image = stripeImage(100, 100, [
    { color: WHITE, share: 0.6 },
    { color: NAVY, share: 0.3 },
    { color: RED, share: 0.1 },
  ]);
  const extracted = extractPalette(image.rgba, image.width, image.height);
  const navyHue = oklabToOklch(rgbToOklab({ r: NAVY[0], g: NAVY[1], b: NAVY[2] })).h;
  const redHue = oklabToOklch(rgbToOklab({ r: RED[0], g: RED[1], b: RED[2] })).h;

  assert.ok(
    hueDistance(extracted.primary.hue, navyHue) < 15,
    `主色 ${extracted.primary.hex} 应接近深蓝，实际色相 ${extracted.primary.hue.toFixed(1)}°`
  );
  assert.ok(hueDistance(extracted.secondary.hue, redHue) < 20);
  assert.equal(extracted.monochrome, false);
  // 白色背景被过滤掉，不应成为任何簇
  for (const cluster of extracted.clusters) {
    assert.ok(cluster.lab.L < 0.94, "纸色不应进入调色板");
  }
});

test("同样的输入永远得到同样的结果（无随机初始化）", () => {
  const image = stripeImage(80, 40, [
    { color: WHITE, share: 0.5 },
    { color: NAVY, share: 0.3 },
    { color: RED, share: 0.2 },
  ]);
  const first = extractPalette(image.rgba, image.width, image.height);
  const second = extractPalette(image.rgba, image.width, image.height);
  assert.deepEqual(first, second);
});

test("单色徽标：无法凑出第二个色相时标记 monochrome 并派生次要色", () => {
  const image = stripeImage(60, 60, [
    { color: [20, 60, 110], share: 0.5 },
    { color: [40, 90, 150], share: 0.5 },
  ]);
  const extracted = extractPalette(image.rgba, image.width, image.height);
  assert.equal(extracted.monochrome, true);
  assert.equal(extracted.secondary.count, 0);
  assert.ok(hueDistance(extracted.secondary.hue, extracted.primary.hue) > 0);
});

test("纯灰阶徽标报 no_color，而不是给出一个灰色品牌", () => {
  const image = stripeImage(50, 50, [
    { color: [128, 128, 128], share: 0.5 },
    { color: [40, 40, 40], share: 0.5 },
  ]);
  assert.throws(
    () => extractPalette(image.rgba, image.width, image.height),
    (error: unknown) =>
      error instanceof EmblemError && error.code === "no_color"
  );
});

test("透明像素不参与取色", () => {
  const image = stripeImage(40, 40, [
    { color: [...NAVY, 0] as [number, number, number, number], share: 0.5 },
    { color: NAVY, share: 0.5 },
  ]);
  const extracted = extractPalette(image.rgba, image.width, image.height);
  assert.equal(extracted.stats.used, 800);
  assert.equal(extracted.stats.sampled, 800);
});

test("大图按 maxSamples 抽样，且抽样结果仍然稳定", () => {
  const image = stripeImage(400, 400, [
    { color: NAVY, share: 0.5 },
    { color: RED, share: 0.5 },
  ]);
  const extracted = extractPalette(image.rgba, image.width, image.height, {
    maxSamples: 1000,
  });
  assert.equal(extracted.stats.sampled, 1000);
  assert.ok(extracted.clusters.length >= 2);
});

test("零像素输入报 no_pixels", () => {
  assert.throws(
    () => extractPalette(new Uint8Array(0), 0, 0),
    (error: unknown) => error instanceof EmblemError && error.code === "no_pixels"
  );
});

test("簇的像素数之和等于参与聚类的像素数", () => {
  const image = stripeImage(90, 30, [
    { color: WHITE, share: 0.4 },
    { color: NAVY, share: 0.3 },
    { color: RED, share: 0.2 },
    { color: [210, 170, 40], share: 0.1 },
  ]);
  const extracted = extractPalette(image.rgba, image.width, image.height);
  const total = extracted.clusters.reduce((sum, cluster) => sum + cluster.count, 0);
  assert.equal(total, extracted.stats.sampled);
  // 权重必须按降序排列
  for (let i = 1; i < extracted.clusters.length; i += 1) {
    assert.ok(extracted.clusters[i - 1].weight >= extracted.clusters[i].weight);
  }
});

test("代表色可被 hexToRgb 解析（不是空串或 NaN）", () => {
  const image = stripeImage(20, 20, [{ color: NAVY, share: 1 }]);
  const extracted = extractPalette(image.rgba, image.width, image.height);
  assert.match(extracted.primary.hex, /^#[0-9a-f]{6}$/);
  hexToRgb(extracted.primary.hex);
});
