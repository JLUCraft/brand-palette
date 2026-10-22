/**
 * Chakra UI 主题生成物（FollyLauncher 用）。
 *
 * 只输出颜色：组件的交互行为归上游 fork 所有，这里不碰。启动器用
 * `mode("brand.700", "brand.300")` 的既有写法消费它。
 */

import { RAMP_STEPS, type Brand } from "./brand";

/** 只有带连字符的令牌名需要引号；其余按 prettier 的习惯写成裸键。 */
function propertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function indent(record: Record<string, string>, pad: string): string {
  return Object.entries(record)
    .map(
      ([name, value]) =>
        `${pad}${propertyName(name)}: ${JSON.stringify(value)},`
    )
    .join("\n");
}

export function toChakraTheme(brand: Brand): string {
  const ramp = RAMP_STEPS.map(
    (step) => `  ${step}: ${JSON.stringify(brand.palette.primary.ramp[step])},`
  ).join("\n");

  return `/* 生成文件，请勿手改。
 * 来源：brands/${brand.id}/brand.json
 * 生成器：brand-palette --chakra
 */

/** 徽标取色得到的完整色阶。用于 \`colors.brand\`，例如 \`brand.600\`。 */
export const brandColors = {
${ramp}
} as const;

/** 语义令牌，light/dark 两套。需要按模式取值时用 Chakra 的 mode() 取对应项。 */
export const brandSemantic = {
  light: {
${indent(brand.modes.light.tokens, "    ")}
  },
  dark: {
${indent(brand.modes.dark.tokens, "    ")}
  },
} as const;

export type BrandColorStep = keyof typeof brandColors;
`;
}
