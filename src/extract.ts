/**
 * 校徽取色：确定性的 OKLab 聚类，不引入随机数，同样的输入永远得到同样的调色板。
 *
 * 输入是解码后的 RGBA 像素，因此核心逻辑同时被 CLI（pngjs）和网页（canvas）复用。
 */

import {
  hueDistance,
  oklabToOklch,
  oklchToRgbMapped,
  rgbToHex,
  rgbToOklab,
  type Oklab,
} from "./color";

/** 取色失败的原因，调用方据此给出可诊断的提示。 */
export type EmblemErrorCode = "no_pixels" | "no_color" | "too_few_colors";

export class EmblemError extends Error {
  constructor(
    message: string,
    readonly code: EmblemErrorCode
  ) {
    super(message);
    this.name = "EmblemError";
  }
}

export interface ExtractOptions {
  /** 聚类中心数量。多于实际色块时多余的簇会被丢弃。 */
  clusters?: number;
  /** Lloyd 迭代上限；收敛后提前结束。 */
  iterations?: number;
  /** 参与聚类的像素上限，超出后等距抽样，保证大图不会拖慢浏览器。 */
  maxSamples?: number;
  /** 亮度下限：低于它的像素视为线条/阴影，不参与取色。 */
  minLightness?: number;
  /** 亮度上限：高于它的像素视为背景纸色，不参与取色。 */
  maxLightness?: number;
  /** 彩度下限：低于它的像素视为灰阶，不参与取色。 */
  minChroma?: number;
  /** alpha 低于它的像素被丢弃（半透明描边会污染均值）。 */
  minAlpha?: number;
}

export interface Cluster {
  /** 簇内像素的 OKLab 均值 */
  lab: Oklab;
  /** 由均值算出的色相角 */
  hue: number;
  /** 簇内像素的平均彩度（不是均值的彩度：彩色像素的中和会互相抵消） */
  chroma: number;
  /** 簇内像素数 */
  count: number;
  /** 排序权重 = count × (0.5 + 2 × chroma)：面积为主，鲜艳度做微调 */
  weight: number;
  /** 该簇的代表色（已做 sRGB 色域映射） */
  hex: string;
}

export interface Extracted {
  /** 按权重降序 */
  clusters: Cluster[];
  primary: Cluster;
  /** 与 primary 色相拉开 ≥ 40° 的最强簇；没有则按 primary 派生 */
  secondary: Cluster;
  /** 最鲜艳的簇，用于焦点环等高可见度元素 */
  accent: Cluster;
  /** 徽标只有一个彩色色相时为 true（secondary 是派生的，不是取出来的） */
  monochrome: boolean;
  stats: {
    /** 解码得到的像素总数 */
    pixels: number;
    /** 通过过滤的像素数 */
    used: number;
    /** 实际参与聚类的像素数（抽样后） */
    sampled: number;
  };
}

/** 默认参数：跳过纸色与描边，只留下真正的品牌色。 */
export const DEFAULT_EXTRACT: Required<ExtractOptions> = {
  clusters: 6,
  iterations: 24,
  maxSamples: 20000,
  minLightness: 0.16,
  maxLightness: 0.94,
  minChroma: 0.025,
  minAlpha: 0.6,
};

/** secondary 与 primary 的最小色相间隔，低于它就说明徽标本身只有一种彩色。 */
const SECONDARY_HUE_GAP = 40;

/** 派生 secondary 时的色相偏移，让单色徽标也有层次而不假装有两个主色。 */
const DERIVED_SECONDARY_HUE_SHIFT = 12;

/** 派生 secondary 时的彩度比例。 */
const DERIVED_SECONDARY_CHROMA_RATIO = 0.5;

const chromaWeight = (chroma: number): number => 0.5 + 2 * chroma;

function squaredDistance(a: Oklab, b: Oklab): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return dL * dL + da * da + db * db;
}

function meanOf(points: Oklab[]): Oklab {
  let L = 0;
  let a = 0;
  let b = 0;
  for (const p of points) {
    L += p.L;
    a += p.a;
    b += p.b;
  }
  const n = points.length || 1;
  return { L: L / n, a: a / n, b: b / n };
}

function clusterFrom(members: Oklab[], chromas: number[]): Cluster {
  const lab = meanOf(members);
  const oklch = oklabToOklch(lab);
  const count = members.length;
  let chromaSum = 0;
  for (const c of chromas) chromaSum += c;
  const chroma = count === 0 ? 0 : chromaSum / count;
  return {
    lab,
    hue: oklch.h,
    chroma,
    count,
    weight: count * chromaWeight(chroma),
    hex: rgbToHex(oklchToRgbMapped({ L: oklch.L, C: Math.min(oklch.C, chroma), h: oklch.h })),
  };
}

/**
 * 从 RGBA 像素中提取品牌色簇。
 *
 * 算法：过滤纸色/灰阶/透明像素 → 等距抽样 → 确定性最远点初始化 → OKLab k-means。
 * 全程无随机数，集群顺序按权重稳定排序。
 */
export function extractPalette(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: ExtractOptions = {}
): Extracted {
  const opts = { ...DEFAULT_EXTRACT, ...options };
  const pixels = Math.floor(Math.min(width * height, rgba.length / 4));
  if (pixels <= 0) {
    throw new EmblemError("处理失败：图像没有像素", "no_pixels");
  }

  const kept: Oklab[] = [];
  const keptChromas: number[] = [];
  for (let i = 0; i < pixels; i += 1) {
    const offset = i * 4;
    if (rgba[offset + 3] / 255 < opts.minAlpha) continue;
    const lab = rgbToOklab({
      r: rgba[offset],
      g: rgba[offset + 1],
      b: rgba[offset + 2],
    });
    const { C } = oklabToOklch(lab);
    if (lab.L < opts.minLightness || lab.L > opts.maxLightness) continue;
    if (C < opts.minChroma) continue;
    kept.push(lab);
    keptChromas.push(C);
  }

  if (kept.length === 0) {
    throw new EmblemError(
      "这幅徽标里没有可用的彩色像素：请上传带底色的校徽图（而不是纯线条稿或透明水墨）",
      "no_color"
    );
  }

  const stride = Math.max(1, Math.ceil(kept.length / opts.maxSamples));
  const points: Oklab[] = [];
  const pointChromas: number[] = [];
  for (let i = 0; i < kept.length; i += stride) {
    points.push(kept[i]);
    pointChromas.push(keptChromas[i]);
  }

  const k = Math.max(1, Math.min(opts.clusters, points.length));

  // 确定性最远点采样：种子取彩度最高的像素，其后每次取距已选中心最远者。
  const centers: Oklab[] = [];
  let seedIndex = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (pointChromas[i] > pointChromas[seedIndex]) seedIndex = i;
  }
  centers.push(points[seedIndex]);
  while (centers.length < k) {
    let bestIndex = -1;
    let bestDistance = -1;
    for (let i = 0; i < points.length; i += 1) {
      let nearest = Infinity;
      for (const center of centers) {
        const d = squaredDistance(points[i], center);
        if (d < nearest) nearest = d;
      }
      if (nearest > bestDistance) {
        bestDistance = nearest;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    centers.push(points[bestIndex]);
  }

  let assignments = new Int32Array(points.length).fill(-1);
  for (let iteration = 0; iteration < opts.iterations; iteration += 1) {
    let changed = false;
    for (let i = 0; i < points.length; i += 1) {
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < centers.length; c += 1) {
        const d = squaredDistance(points[i], centers[c]);
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }

    const members: Oklab[][] = centers.map(() => []);
    for (let i = 0; i < points.length; i += 1) {
      members[assignments[i]].push(points[i]);
    }
    for (let c = 0; c < centers.length; c += 1) {
      // 空簇保留原中心，下一轮仍可能抢回像素；最终 count=0 的簇会被丢弃。
      if (members[c].length > 0) centers[c] = meanOf(members[c]);
    }

    if (!changed) break;
  }

  const members: Oklab[][] = centers.map(() => []);
  const memberChromas: number[][] = centers.map(() => []);
  for (let i = 0; i < points.length; i += 1) {
    const c = assignments[i];
    members[c].push(points[i]);
    memberChromas[c].push(pointChromas[i]);
  }

  const clusters = centers
    .map((_, index) => clusterFrom(members[index], memberChromas[index]))
    .filter((cluster) => cluster.count > 0)
    .sort((a, b) => b.weight - a.weight);

  if (clusters.length === 0) {
    throw new EmblemError("这幅徽标里没有找到可用的颜色簇", "too_few_colors");
  }

  const primary = clusters[0];

  const distinct = clusters.find(
    (cluster) =>
      cluster !== primary &&
      cluster.chroma >= opts.minChroma &&
      hueDistance(cluster.hue, primary.hue) >= SECONDARY_HUE_GAP
  );
  const monochrome = distinct === undefined;
  const secondary: Cluster = distinct ?? {
    ...primary,
    hue: (primary.hue + DERIVED_SECONDARY_HUE_SHIFT) % 360,
    chroma: primary.chroma * DERIVED_SECONDARY_CHROMA_RATIO,
    count: 0,
    weight: 0,
    hex: rgbToHex(
      oklchToRgbMapped({
        L: primary.lab.L,
        C: primary.chroma * DERIVED_SECONDARY_CHROMA_RATIO,
        h: (primary.hue + DERIVED_SECONDARY_HUE_SHIFT) % 360,
      })
    ),
  };

  const accent = clusters.reduce(
    (best, cluster) => (cluster.chroma > best.chroma ? cluster : best),
    primary
  );

  return {
    clusters,
    primary,
    secondary,
    accent,
    monochrome,
    stats: { pixels, used: kept.length, sampled: points.length },
  };
}
