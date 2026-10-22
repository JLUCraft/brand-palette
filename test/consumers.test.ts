import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildBrand, type Brand } from "../src/brand";
import { main } from "../src/cli";
import { toChakraTheme } from "../src/emit-chakra";
import { composeContrastFailures, toComposeTheme } from "../src/emit-compose";
import { extractPalette } from "../src/extract";
import { encodePng } from "../src/icons";

const SLOT_NAMES = [
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
];

function brandFrom(colors: [number, number, number][]): Brand {
  const size = 40;
  const rgba = new Uint8Array(size * size * 4);
  colors.forEach((color, index) => {
    const from = Math.round((index * size) / colors.length);
    const to = Math.round(((index + 1) * size) / colors.length);
    for (let x = from; x < to; x += 1) {
      for (let y = 0; y < size; y += 1) {
        const offset = (y * size + x) * 4;
        rgba[offset] = color[0];
        rgba[offset + 1] = color[1];
        rgba[offset + 2] = color[2];
        rgba[offset + 3] = 255;
      }
    }
  });
  return buildBrand({
    id: "jlu",
    name: "吉林大学",
    extracted: extractPalette(rgba, size, size),
  });
}

test("Chakra 生成物导出完整色阶与两套语义令牌", () => {
  const source = toChakraTheme(brandFrom([[35, 78, 157]]));
  assert.ok(source.includes("export const brandColors = {"));
  assert.ok(source.includes("export const brandSemantic = {"));
  assert.ok(source.includes("50: \"#"), "缺少 50 级");
  assert.ok(source.includes("950: \"#"), "缺少 950 级");
  assert.ok(source.includes("light: {") && source.includes("dark: {"));
  assert.ok(!source.includes("undefined"));
  // 语义键必须出现在两套令牌里
  for (const key of ["primary", "on-primary", "primary-text"]) {
    // 合法标识符写裸键，带连字符的写引号键，与 prettier 的习惯一致
    const rendered = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${key}:` : `"${key}":`;
    assert.equal(
      source.split(rendered).length - 1,
      2,
      `${rendered} 应各出现一次于 light/dark`
    );
  }
});

test("Compose 生成物覆盖 Material3 的全部槽位且是 Kotlin 色值", () => {
  const source = toComposeTheme(brandFrom([[35, 78, 157]]));
  assert.ok(source.includes("package com.jlucraft.manager.nativecore"));
  assert.ok(source.includes("internal val BrandLightColors = lightColorScheme("));
  assert.ok(source.includes("internal val BrandDarkColors = darkColorScheme("));
  const lightBlock = source.slice(
    source.indexOf("BrandLightColors"),
    source.indexOf("BrandDarkColors")
  );
  for (const slot of SLOT_NAMES) {
    assert.ok(lightBlock.includes(`${slot} = Color(0xFF`), `浅色缺少 ${slot}`);
  }
  const hexes = source.match(/Color\(0xFF[0-9A-F]{6}\)/g) ?? [];
  assert.equal(hexes.length, SLOT_NAMES.length * 2);
});

test("Compose 配色不产生不可读的按钮组合", () => {
  const cases: [number, number, number][][] = [
    [[35, 78, 157]],
    [[210, 170, 40]],
    [[200, 40, 40], [30, 90, 60]],
    [[110, 130, 170]],
    [[60, 180, 90]],
  ];
  for (const colors of cases) {
    const failures = composeContrastFailures(brandFrom(colors));
    assert.deepEqual(failures, [], `配色 ${JSON.stringify(colors)} 有不可读组合`);
  }
});

test("CLI 可以把生成物直接写到消费端路径", () => {
  const dir = mkdtempSync(join(tmpdir(), "brand-palette-consumers-"));
  const emblem = join(dir, "emblem.png");
  const rgba = new Uint8Array(24 * 24 * 4);
  for (let i = 0; i < 24 * 24; i += 1) {
    rgba[i * 4] = 35;
    rgba[i * 4 + 1] = 78;
    rgba[i * 4 + 2] = 157;
    rgba[i * 4 + 3] = 255;
  }
  writeFileSync(emblem, encodePng({ rgba, width: 24, height: 24 }));

  const chakra = join(dir, "brand-theme.gen.ts");
  const compose = join(dir, "BrandColors.kt");
  const exit = main([
    emblem,
    "--id", "jlu",
    "--name", "吉林大学",
    "--out", join(dir, "brand"),
    "--chakra", chakra,
    "--compose", compose,
  ]);
  assert.equal(exit, 0);
  assert.match(readFileSync(chakra, "utf8"), /export const brandColors/);
  assert.match(readFileSync(compose, "utf8"), /BrandDarkColors/);

  // --check 也要校验这两个文件
  assert.equal(
    main([
      emblem,
      "--id", "jlu",
      "--name", "吉林大学",
      "--out", join(dir, "brand"),
      "--chakra", chakra,
      "--compose", compose,
      "--check",
    ]),
    0
  );

  writeFileSync(chakra, "// tampered\n");
  assert.equal(
    main([
      emblem,
      "--id", "jlu",
      "--name", "吉林大学",
      "--out", join(dir, "brand"),
      "--chakra", chakra,
      "--compose", compose,
      "--check",
    ]),
    1
  );

  rmSync(dir, { recursive: true, force: true });
});
