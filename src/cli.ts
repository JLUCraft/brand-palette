#!/usr/bin/env node
/**
 * 用法：
 *   bun run palette path/to/emblem.png --id jlu --name 吉林大学 [--out brands/jlu] [--icons]
 *   bun run palette path/to/emblem.png --id jlu --name 吉林大学 --out brands/jlu --check
 *
 * `--check` 不写盘，只比较已提交的生成物是否与当前算法一致；CI 用它防止漂移。
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { buildBrand, type Brand } from "./brand";
import { artifacts } from "./emit";
import { toChakraTheme } from "./emit-chakra";
import { composeContrastFailures, toComposeTheme } from "./emit-compose";
import { decodePng, iconSet } from "./icons";
import { DEFAULT_EXTRACT, extractPalette, EmblemError } from "./extract";

interface Args {
  image: string;
  id: string;
  name: string;
  out: string;
  check: boolean;
  icons: boolean;
  /** 额外的生成物目标路径：Chakra 主题 / Compose 配色 */
  chakra?: string;
  compose?: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(name, next);
      i += 1;
    } else {
      flags.set(name, true);
    }
  }

  const image = positional[0];
  const id = flags.get("id");
  const name = flags.get("name");
  if (!image || typeof id !== "string" || typeof name !== "string") {
    throw new Error(
      "用法：bun run palette <emblem.png> --id <品牌 id> --name <显示名> [--out <目录>] [--icons] [--check]"
    );
  }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error(`品牌 id 必须是小写字母开头的短横线串：${id}`);
  }

  const out = flags.get("out");
  const chakra = flags.get("chakra");
  const compose = flags.get("compose");
  return {
    image,
    id,
    name,
    out: typeof out === "string" ? out : join("brands", id),
    check: flags.has("check"),
    icons: flags.has("icons"),
    ...(typeof chakra === "string" ? { chakra } : {}),
    ...(typeof compose === "string" ? { compose } : {}),
  };
}

function printReport(brand: Brand): boolean {
  const primary = brand.palette.primary;
  console.log(
    `品牌 ${brand.name}（${brand.id}）：主色 h=${primary.hue.toFixed(1)}° C=${primary.chroma.toFixed(3)} ` +
      `基准级 ${primary.base} = ${primary.ramp[primary.base]}，` +
      `交互主色 --primary = ${brand.modes.light.tokens.primary}/${brand.modes.dark.tokens.primary}` +
      `${brand.monochrome ? "，单色徽标（次要色为派生）" : ""}`
  );
  console.log(
    `取样：${brand.source.pixels} 像素，${brand.source.used} 个彩色像素，${brand.source.sampled} 个参与聚类`
  );

  let ok = true;
  for (const mode of ["light", "dark"] as const) {
    const checks = brand.modes[mode].checks;
    const failed = checks.filter((c) => !c.met);
    console.log(
      `\n${mode === "light" ? "浅色" : "深色"}模式：${checks.length - failed.length}/${checks.length} 项对比度达标`
    );
    for (const c of checks) {
      const mark = c.met ? "ok  " : "FAIL";
      console.log(
        `  ${mark} ${c.label.padEnd(12, "　")} ${c.fg} on ${c.bg} = ${c.ratio.toFixed(2)}（目标 ${c.min}）`
      );
      if (!c.met) ok = false;
    }
  }
  return ok;
}

/** 生成物的绝对路径 → 内容。json/css 落在 --out 下，消费端文件按传入路径解析。 */
function targets(brand: Brand, args: Args): Map<string, string> {
  const files = new Map<string, string>();
  for (const [name, content] of Object.entries(artifacts(brand))) {
    files.set(resolve(args.out, name), content);
  }
  if (args.chakra) files.set(resolve(args.chakra), toChakraTheme(brand));
  if (args.compose) files.set(resolve(args.compose), toComposeTheme(brand));
  return files;
}

function runCheck(files: Map<string, string>): boolean {
  let ok = true;
  for (const [path, expected] of files) {
    if (!existsSync(path)) {
      console.error(`缺少生成物：${path}`);
      ok = false;
      continue;
    }
    if (readFileSync(path, "utf8") !== expected) {
      console.error(`生成物已过期：${path}（重跑 bun run palette 即可）`);
      ok = false;
    }
  }
  return ok;
}

export function main(argv: string[]): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }

  let brand: Brand;
  let image;
  try {
    const buffer = readFileSync(args.image);
    image = decodePng(buffer);
    const extracted = extractPalette(image.rgba, image.width, image.height, DEFAULT_EXTRACT);
    brand = buildBrand({ id: args.id, name: args.name, extracted });
  } catch (error) {
    if (error instanceof EmblemError) {
      console.error(`${error.message}（${error.code}）`);
      return 1;
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      console.error(`找不到文件：${args.image}`);
      return 1;
    }
    console.error(
      `读取失败：${(error as Error).message}。只支持 PNG；JPEG/WebP 请先转成 PNG（网页版可直接拖入任意浏览器能解码的格式）。`
    );
    return 1;
  }

  let contrastOk = printReport(brand);
  const files = targets(brand, args);

  const composeFailures = composeContrastFailures(brand);
  if (composeFailures.length > 0) {
    contrastOk = false;
    for (const failure of composeFailures) {
      console.error(`  FAIL Compose 配色 ${failure}`);
    }
  }

  if (args.check) {
    const ok = runCheck(files);
    return ok && contrastOk ? 0 : 1;
  }

  for (const [path, content] of files) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`写入 ${path}`);
  }

  if (args.icons) {
    const iconsDir = join(args.out, "icons");
    mkdirSync(iconsDir, { recursive: true });
    for (const [name, buffer] of Object.entries(iconSet(image))) {
      writeFileSync(join(iconsDir, name), buffer);
      console.log(`写入 ${join(iconsDir, name)}`);
    }
  }

  console.log(
    `\n完成。下一步：把 ${join(args.out, "tokens.css")} 引入站点，或用 ${basename(
      join(args.out, "brand.json")
    )} 生成启动器/管理端的主题。`
  );
  return contrastOk ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
