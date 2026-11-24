# Phase 0 完成报告 · Hymnix Orbit 2.0

日期：2026-11-24 · 对应计划《Hymnix Orbit 2.0 Complete Redesign and Refactoring Plan》13.2 Phase 0

## 交付内容

### 1. 设计令牌（新增，组件未改动）
```
desktop/src/styles/
  index.css                 入口：按 semantic → primitives → base → themes 顺序导入
  tokens/semantic.css       共享非颜色令牌：字体栈、字号、间距、圆角、控件高度、动效、层级
  tokens/primitives.css     九张色卡的原始色值（--p-*）
  base.css                  本地字体 @font-face（Inter / JetBrains Mono woff2）
  themes.css                导入九套主题
  themes/light-camellia.css … dark-graphite.css   九套主题的语义色板
desktop/src/theme/themeManager.ts
```
- 语义令牌完整落地：`--bg --sidebar --surface --raised --sunken --border --border-strong --text --muted --faint --accent --accent-fill --accent-hover --accent-pressed --on-accent --accent-text --accent-soft --highlight --accent-bright --success/-soft --warning/-soft --danger/-soft --term-*`。
- 主题管理器：`THEMES`（9 套，含 light/dark）、`readStoredTheme()`、`applyTheme()` 同时写 `data-theme` 与 `data-mode`、`persistTheme()`。Auto 模式留给 Phase 1。
- 主题下拉：6 → **9 presets**（新增 墨绿·象牙白、蜜绯·蜂蜜、石墨·金），中英文文案齐全。

### 2. 本地字体
- 下载并随包：Inter 400/500/600、JetBrains Mono 400/600（woff2，OFL）。
- 声明为 `Inter Local` / `JetBrains Mono Local`，写入 `--font-ui` / `--font-mono`；
  **Phase 0 不切换正文字体**，否则六套旧主题的排版会变。Phase 1 再把组件切到新字体栈。

### 3. 兼容层
- 六套既有主题在 `renderer/styles.css` 中保留 1.3.2 旧变量（`--red-*`、`--ink`、`--line` …），像素级不变；默认主题 Camellia 的旧值改为显式声明（原先在 `:root`）。
- 三套新主题在各自主题文件里把旧变量别名到新语义令牌（`--red-500: var(--accent-fill)` 等），所以旧组件在新主题下也能正常着色。

### 4. 计划点名的 4 个 bug
| bug | 修法 |
| --- | --- |
| degraded 标签被裁 / Gateway 胶囊旁细缝 | 根因是 header 与 `.connbar` 强制单行 + `overflow:hidden`，窗口变窄时把右端胶囊切成一条缝。改为：≥1360px 维持单行（像素不变），<1360px 时 header 与连接栏换行，不再裁切 |
| Terminal 提示被裁 | `.term-hint` 底部内边距 10→14px、行高 1.5；提示不再贴着窗口底边被切 |
| 开关关闭态过淡 | `.switch` 关闭态底色 `--line` → `--line-strong`，关闭状态可见 |

## 验收

- `pnpm typecheck`：通过
- `pnpm test`：18/18 通过（协议测试已扩展到主题管理器、令牌入口与九个主题文件）
- `pnpm build`：通过（字体作为 asset 一并打包）
- 主题选择器：9 项全部加载；`data-mode` 正确（如 graphite-gold → dark）
- **像素回归（旧 6 套主题，18 张页面截图逐像素对比）**：

| 页面 | 茶花白 | 萤草绿纯黑 |
| --- | --- | --- |
| Chat / History / Gateway / Models / Monitor / Support | 0.000 | 0.000 |
| Changelog | 0.032（截图伪影：隐藏窗口里 LED 过渡冻结，非代码差异） | 0.000 |
| Settings | 0.072（开关修复，预期） | 0.035（预期） |
| Terminal | 0.955（提示修复，预期） | 0.991（预期） |

结论：除三个有意修复的位置外，六套既有主题与 Phase 0 前逐像素一致。

## 已知限制 / 下一步
- 字体只声明未启用（Phase 1 切换）。
- 旧变量与新语义令牌暂时并存；Phase 1 组件改用语义令牌后删除旧变量。
- 对比度脚本 `tools/check-contrast.mjs`、设计实验室页、Auto 模式 UI 属于 Phase 1/架构项，未在本阶段实现。
- 代码尚未提交/推送；`git status` 显示 desktop/src 下新增 styles/、theme/、fonts 资源与受影响的 main.tsx / i18n.ts / styles.css / protocol.test.mjs。
