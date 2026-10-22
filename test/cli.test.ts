import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { main } from "../src/cli";
import { encodePng } from "../src/icons";

/** 生成一张"校徽"：白底 + 深蓝块 + 红色块，与单元测试的口径一致。 */
function writeEmblem(path: string) {
  const size = 32;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const isNavy = x < size * 0.7;
      rgba[offset] = isNavy ? 22 : 179;
      rgba[offset + 1] = isNavy ? 69 : 38;
      rgba[offset + 2] = isNavy ? 126 : 30;
      rgba[offset + 3] = 255;
    }
  }
  writeFileSync(path, encodePng({ rgba, width: size, height: size }));
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "brand-palette-"));
}

test("CLI 写出三份生成物和图标，再 --check 一致通过", () => {
  const dir = tempDir();
  const emblem = join(dir, "emblem.png");
  const out = join(dir, "brand");
  writeEmblem(emblem);

  const exit = main([emblem, "--id", "jlu", "--name", "吉林大学", "--out", out, "--icons"]);
  assert.equal(exit, 0, "对比度全部达标时退出码应为 0");

  const tokens = readFileSync(join(out, "tokens.css"), "utf8");
  assert.ok(tokens.includes("--brand-500:"));

  const manifest = JSON.parse(readFileSync(join(out, "brand.json"), "utf8"));
  assert.equal(manifest.id, "jlu");
  assert.equal(manifest.name, "吉林大学");

  // 图标：4 个尺寸，且都是合法 PNG（魔数）
  for (const size of [32, 64, 128, 256]) {
    const icon = readFileSync(join(out, "icons", `icon-${size}.png`));
    assert.equal(icon.subarray(1, 4).toString("ascii"), "PNG", `icon-${size}.png 不是 PNG`);
  }

  assert.equal(main([emblem, "--id", "jlu", "--name", "吉林大学", "--out", out, "--check"]), 0);

  rmSync(dir, { recursive: true, force: true });
});

test("--check 发现生成物被手改时报错，且不重写文件", () => {
  const dir = tempDir();
  const emblem = join(dir, "emblem.png");
  const out = join(dir, "brand");
  writeEmblem(emblem);
  main([emblem, "--id", "jlu", "--name", "吉林大学", "--out", out]);

  const tokensPath = join(out, "tokens.css");
  const tampered = `${readFileSync(tokensPath, "utf8")}\n/* 手改 */\n`;
  writeFileSync(tokensPath, tampered);

  assert.equal(main([emblem, "--id", "jlu", "--name", "吉林大学", "--out", out, "--check"]), 1);
  assert.equal(readFileSync(tokensPath, "utf8"), tampered, "--check 不应写盘");

  rmSync(dir, { recursive: true, force: true });
});

test("缺少必需参数时返回 2 而不是抛异常", () => {
  assert.equal(main([]), 2);
  assert.equal(main(["emblem.png", "--id", "jlu"]), 2);
});

test("非法品牌 id 被拒绝", () => {
  const dir = tempDir();
  const emblem = join(dir, "emblem.png");
  writeEmblem(emblem);
  assert.equal(main([emblem, "--id", "JLU", "--name", "x"]), 2);
  rmSync(dir, { recursive: true, force: true });
});

test("文件不存在时给出可读提示并返回 1", () => {
  assert.equal(main(["/nonexistent/emblem.png", "--id", "jlu", "--name", "x"]), 1);
});

test("非 PNG 输入返回 1 并提示只能读 PNG", () => {
  const dir = tempDir();
  const bogus = join(dir, "emblem.png");
  writeFileSync(bogus, "not really a png");
  assert.equal(main([bogus, "--id", "jlu", "--name", "x"]), 1);
  rmSync(dir, { recursive: true, force: true });
});
