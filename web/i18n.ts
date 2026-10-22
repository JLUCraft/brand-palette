import messages from './locales/zh-CN';

/** 键就是中文原文：新增文案时先写进 locales/zh-CN.ts，再在组件里用 t('…')。 */
export function t(key: keyof typeof messages): string {
  return messages[key];
}

/** 带 `{name}` 占位符的文案。 */
export function tf(
  key: keyof typeof messages,
  values: Record<string, string | number>,
): string {
  return t(key).replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}
