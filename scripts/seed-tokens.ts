/**
 * 为工具自身的界面生成 web/tokens.css。
 *
 * 工具界面也必须用令牌（AGENTS.md：禁止硬编码颜色），所以它由同一个生成器
 * 产出，种子色是 JLUCraft 的主色深蓝。改了算法就重跑本脚本。
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildBrand } from "../src/brand";
import { toTokensCss } from "../src/emit";
import { DEFAULT_EXTRACT, extractPalette } from "../src/extract";
import { solidImage } from "../src/seed";

const SEED = "#16457e";
const OUTPUT = join(import.meta.dirname, "../web/tokens.css");

const image = solidImage(SEED);
const extracted = extractPalette(image.rgba, image.width, image.height, DEFAULT_EXTRACT);
const brand = buildBrand({ id: "jlucraft-tool", name: "校徽取色工具", extracted });

writeFileSync(OUTPUT, toTokensCss(brand));
console.log(`写入 ${OUTPUT}（种子色 ${SEED}，主色 ${brand.palette.primary.ramp[600]}）`);
