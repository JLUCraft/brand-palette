/**
 * PNG 解码 / 缩放 / 编码。缩放在预乘 alpha 下做盒式滤波，
 * 否则半透明边缘会把透明像素的黑色混进来，出现黑边。
 */

import { PNG } from "pngjs";

export interface DecodedImage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

/** 各端需要的图标尺寸：Tauri 打包与网页 favicon 的并集。 */
export const ICON_SIZES = [32, 64, 128, 256] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export function decodePng(buffer: Buffer): DecodedImage {
  const png = PNG.sync.read(buffer);
  return {
    rgba: new Uint8Array(png.data),
    width: png.width,
    height: png.height,
  };
}

export function encodePng(image: DecodedImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.rgba);
  return PNG.sync.write(png);
}

/** 盒式下采样到正方形。仅支持缩小：放大校徽只会得到模糊图标，不是本工具的目标。 */
export function downscaleSquare(image: DecodedImage, size: number): DecodedImage {
  if (image.width === size && image.height === size) return image;
  const out = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    const y0 = Math.floor((y * image.height) / size);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / size));
    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor((x * image.width) / size);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / size));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weight = 0;
      for (let sy = y0; sy < y1 && sy < image.height; sy += 1) {
        for (let sx = x0; sx < x1 && sx < image.width; sx += 1) {
          const offset = (sy * image.width + sx) * 4;
          const alpha = image.rgba[offset + 3] / 255;
          r += image.rgba[offset] * alpha;
          g += image.rgba[offset + 1] * alpha;
          b += image.rgba[offset + 2] * alpha;
          a += alpha;
          weight += 1;
        }
      }

      const target = (y * size + x) * 4;
      if (a > 0) {
        out[target] = Math.round(r / a);
        out[target + 1] = Math.round(g / a);
        out[target + 2] = Math.round(b / a);
        out[target + 3] = Math.round((a / Math.max(weight, 1)) * 255);
      }
    }
  }

  return { rgba: out, width: size, height: size };
}

export function iconSet(image: DecodedImage): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  for (const size of ICON_SIZES) {
    files[`icon-${size}.png`] = encodePng(downscaleSquare(image, size));
  }
  return files;
}
