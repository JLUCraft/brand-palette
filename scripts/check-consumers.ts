import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { brandFromManifest } from "../src/manifest";
import { artifacts, toTokensCss } from "../src/emit";
import { toChakraTheme } from "../src/emit-chakra";
import { toComposeTheme } from "../src/emit-compose";
import { runCheck } from "../src/cli";

const root = resolve(import.meta.dirname, "..");
const brand = brandFromManifest(JSON.parse(readFileSync(resolve(root, "brands/jlu/brand.json"), "utf8")));
const files = new Map<string, string>();
for (const [name, content] of Object.entries(artifacts(brand))) {
  files.set(resolve(root, "brands/jlu", name), content);
}
for (const path of ["federated-skinstation/web/tokens.css", "jlucraft-web/.vitepress/theme/tokens.css"]) {
  files.set(resolve(root, "..", path), toTokensCss(brand));
}
files.set(resolve(root, "../FollyLauncher/src/styles/brand-theme.gen.ts"), toChakraTheme(brand));
files.set(resolve(root, "../union-manager/app/src/main/kotlin/com/jlucraft/manager/nativecore/BrandColors.kt"), toComposeTheme(brand));
process.exitCode = runCheck(files) ? 0 : 1;
