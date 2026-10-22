/**
 * 生成纯色测试图。用途：为工具自身界面生成令牌，以及给测试提供可控输入。
 */

import { hexToRgb } from "./color";

export interface SeedImage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

export function solidImage(hex: string, size = 64): SeedImage {
  const { r, g, b } = hexToRgb(hex);
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, width: size, height: size };
}
