# AGENTS.md — brand-palette

从校徽图片推导一套品牌令牌（颜色 + 对比度报告 + 各端主题文件）。纯前端计算，
无后端，图片不离开用户设备。

## 1. 单一事实源

- **颜色只在 `brands/<id>/brand.json` 里定义一次**。`tokens.css`、`tokens.json`、
  Chakra 主题、Compose 配色全部由它派生；任何一处手改都会被 `--check` 判为过期。
- 生成物文件头都写明「生成文件，请勿手改」。改算法就重跑生成器，不补丁生成物。
- 语义令牌名清单在 `src/brand.ts` 的 `SEMANTIC_TOKENS`；新增令牌要同时进
  `resolveSemantic()` 的 `tokens` 对象和 `checks` 的对比度校验，否则等于放行未校验的颜色。

## 2. 校徽原图不入库

校徽版权归各校所有，其中吉大校徽在维基百科标注为「合理使用」。仓库里只存
**派生的颜色**（颜色本身不受版权保护），不存徽标图片、不存从徽标导出的图标。

- 本地跑：`bun run palette <emblem.png> --id <id> --name <名称> --out brands/<id>`
- 图标同理：`--icons` 只在本地生成，不要把 `icons/*.png` 提交进本仓库或消费端。
- 消费端要图标时，由该仓库自己持有已获授权的原始素材。

## 3. 算法不变量（改动前先看这里，改完跑测试）

- **确定性**：无随机数、无时间戳、无平台相关精度。同样的输入必须生成逐字节
  相同的文件，`--check` 才成立。
- **对比度不降级**：`resolveModes()` 输出的每一对前景/背景都必须过 WCAG 下限
  （正文 7、次要文字与按钮 4.5、焦点环 3）。达不到要如实报 `met: false`，
  不许放宽阈值换绿色通过。
- **亮度曲线固定**：品牌只决定色相与峰值彩度，`LIGHTNESS` / `CHROMA_MULTIPLIER`
  是跨品牌一致的层次基准。改它们会让所有已发布的品牌同时变样。
- **交互主色优先校色**：`choosePrimaryStep()` 先试与徽标本色最接近的那一级，
  只有按钮文字读不清才退到 600/400。
- **语义色不取自校徽**：成功/失败用固定色相，避免某校的校色让"错误"看起来像"正常"。

## 4. 验证

```
bun run build && bun run test        # tsc --noEmit + vite build，node:test
```

覆盖：色彩空间往返、色域映射、对比度已知值、聚类确定性、单色徽标、透明/灰阶
输入、色阶单调、任意色相下 22 项对比度、CLI 的 `--check` 与退出码、Chakra/
Compose 生成物的槽位完整性、已提交清单与令牌的自洽。

## 5. 消费端约定

| 生成物 | 消费端 | 落地方式 |
|---|---|---|
| `tokens.css` | federated-skinstation | `web/tokens.css`，`style.css` 只保留旧类名到令牌的映射 |
| Chakra 主题 | FollyLauncher | `src/styles/brand-theme.gen.ts`，在 `chakra-theme.ts` 里挂到 `colors.brand` |
| Compose 配色 | union-manager | `nativecore/BrandColors.kt`，`Theme.kt` 只选模式 |

写入消费端用绝对/相对路径参数，例如：

```
bun run palette <emblem.png> --id jlu --name 吉林大学 --out brands/jlu \
  --chakra ../FollyLauncher/src/styles/brand-theme.gen.ts \
  --compose ../union-manager/app/src/main/kotlin/com/jlucraft/manager/nativecore/BrandColors.kt
```

`--check` 会一并校验这些消费端文件，可在各仓 CI 里作为漂移检测。

## Documentation ownership

Keep project documentation in the root `AGENTS.md` and `README.md` only. Product content and required license files retain their existing locations. Workspace progress and evidence belong in `../TODO.md`; unresolved issues belong in `../PROBLEMS.md`. These workspace records are machine-local and are not published.
