# Phase 1 完成报告 · Hymnix Orbit 2.0

日期：2026-11-25 · 对应计划《Hymnix Orbit 2.0 Complete Redesign and Refactoring Plan》13.2 Phase 1（设计系统 + 组件层 + 交互补齐）与 13.6 Phase 5（打磨与验收）

Phase 0 只做了令牌与字体。本阶段把组件真正切到语义令牌上，补齐计划里点名的交互，并把三条验收线（令牌、对比度、视觉基线）做成可重复执行的脚本。

## 1. 令牌契约

组件 CSS 里不允许出现颜色字面量，这条规则现在由脚本强制执行：

| 工具 | 作用 | 结果 |
| --- | --- | --- |
| `tools/check-css-tokens.mjs` | 扫描 `desktop/src/**/*.css`（跳过 `styles/themes`、`styles/tokens`），任何 `#rgb[a]` 或 `var(--p-*)` 都判失败 | 4 个组件样式表全部通过 |
| `tools/check-contrast.mjs` | 解析九套主题，展开一层 `var()`，按 sRGB 相对亮度算 WCAG 2.2 对比度，逐主题检查 21 组配对 | **189/189 通过（9 主题 × 21 对）** |
| `desktop/.stylelintrc.json` | 安装 stylelint 时的等价规则（`color-no-hex`、`color-named: never`、禁用 `--p-*` 属性），主题与令牌目录豁免 | 随包提供，不阻塞构建 |

`renderer/styles.css` 里 **269 处硬编码颜色全部清除**（`grep -c '#[0-9a-fA-F]{3,8}'` → 0），旧主题块整体删除，颜色只由 `src/styles/themes/*.css` 提供。为此九套主题调整了 11 个色值：

| 主题 | 令牌 | 原值 → 新值 | 原因 |
| --- | --- | --- | --- |
| light-camellia | `--border-strong` | `#DDBFC4` → `#BB7E88` | 3:1 边线对比 |
| light-camellia | `--faint` | `#8F767C` → `#836B71` | 4.5:1 正文 |
| light-deepsea | `--border-strong` | `#CFC3B8` → `#9D856E` | 3:1 |
| light-deepsea | `--faint` | `#7C829F` → `#646B89` | 4.5:1 |
| light-ink | `--border-strong` | `#CFCAA9` → `#9A9156` | 3:1 |
| light-ink | `--faint` | `#7C8478` → `#6D756A` | 4.5:1 |
| light-honey | `--border-strong` | `#E3C98B` → `#B1892B` | 3:1 |
| light-honey | `--faint` | `#8F6E55` → `#8B6B52` | 4.5:1 |
| 全部亮色 | `--warning` | `#A85F00` → `#A25C00` | 4.34:1 → 4.5:1 |
| 全部暗色 | `--border-strong` | `#2F4347`/`#475569`/`#2D4538`/`#3D3933`/`#4A2222` → `#4A6970`/`#61748F`/`#456956`/`#686157`/`#984646` | 暗色边线最低只有 1.54:1 |

## 2. 组件层

新增 `renderer/components.tsx`（共享组件）、`renderer/design-lab.tsx`（组件陈列）、`renderer/lib/pure.js`（可测的纯逻辑）。

- **六级按钮**：primary / secondary / tonal / ghost / danger / link，外加 icon、loading、success、pressed 状态。
- **悬浮提示**：`TooltipLayer` 全局委托，400 ms 延迟、相邻目标（`data-tip-group`）之间即时切换、键盘聚焦也显示，并把快捷键附在文案后（`data-tip-key`）。
- **骨架屏**：`Skeleton`、`SkeletonList`，模型列表在 `starting` 状态下不再空白。
- **模型下拉**：`ModelCombobox`（`role="combobox"`，方向键/回车/Esc、能力标签、`适配你的 N GB 显存` 标记、空态提供「下载模型」）。
- **密码强度**：`passwordStrength()` 四档评估 + `PasswordMeter` 四条进度条。
- **二维码**：`qr.js` 自研编码器（byte 模式、纠错 M、版本 1–10）。理由：CSP 只允许 `img-src 'self' data:`，离线应用不能调用在线二维码服务；正确性由 `tests/qr.test.mjs` 里的**独立解码器**验证（重算 BCH(15,5)、反交织、还原字节流、断言 finder/timing/dark module），而不是跟参考库对比。
- **错误面板**：`ErrorPanel`（图标 + 标题 + 原因 + 单一修复按钮 + 复制详情）。
- **ROG 切角**：唯一带 machined 切角的主题，`clip-path` 只作用于 primary 按钮、accent 胶囊与首启步骤标记。
- **无障碍**：`sr-only` + `aria-live` 只在生成完成时播报一次（此前每个 token 都播报）；`forced-colors` 与 `prefers-reduced-motion` 全量适配；`pointer: coarse` 下点击区域 44px。

## 3. 交互补齐（计划 §7 与审查清单）

| 项 | 实现位置 | 说明 |
| --- | --- | --- |
| 首次运行三步卡片 | `renderWelcome` | 启动服务 → 选模型 → 打招呼；语言与主题（悬停实时预览）内嵌；每步可跳过；两条安静出口（改用云端 / 连接朋友） |
| token 速度 | 气泡 `tok/s` + 输入框 `composer-rate` | 生成中按已收到字符实时估算，完成后写入消息 |
| 斜杠命令 | `/model` `/clear` `/export` `/system` | 输入 `/` 弹出列表，Tab/Enter 选中，方向键移动 |
| 附件 | `attachment-strip` | 按钮、拖放、粘贴三种入口，≤6 个文件、单个 ≤5 MB、文本内容截断 20 000 字符 |
| 从这条回复分支 | 气泡 ⑂ | 复制到该回复为止的上下文，开启新会话 |
| 代码块换行 / 保存 | `code-actions` | Wrap 切换 + `Save as file`（按语言映射扩展名） |
| 连接中断就地重试 | 气泡 `bubble-error` | 保留已收到的部分内容，提供 Retry 与复制详情 |
| 磁盘空间检查 | `pullModelByName` | 下载前 `system.disk` 预检，不足时提示「需要 X GB，当前可用 Y GB」 |
| 下载完成通知 | `system.notify` | 系统 Toast，点击回到窗口 |
| 卸载正在使用的模型 | 确认对话框 | 「{model} 仍在回复」→ Stop and unload / Keep generating |
| 关闭时仍有人连接 | 「在通知区域继续共享？」 | 勾选「记住我的选择」；继续共享时窗口隐藏并创建托盘图标，托盘可「打开 / 退出」 |
| 每个分区恢复默认 | `resetSection()` | 常规 / 外观 / 启动 / 模型 / 共享 / 快捷键 |
| 需要重启的修改 | `Restart needed` 标记 + 常驻重启条 | GPU 加速、缓存目录、DPI 缩放；重启条提供「立即重启 / 稍后」 |
| 新版变化卡片 | `hymnix.whatsNew` vs `__APP_VERSION__` | 每个版本首次启动显示一次 |
| 200% 文字缩放 | `data-text-scale="large"` | 行高改 min-height、头部与设置行换行、栅格降为单列 |

## 4. 侧边栏：会话列表改为 Claude / ChatGPT 的做法

原实现是侧栏里再套一个 `max-height: 220px; overflow-y: auto` 的滚动框，既出现第二条滚动条，又会在行高变化时把条目切成半行（用户截图里那条被裁掉的会话名）。改为：

- **整栏只有一个滚动区**（`.side`），会话列表不再有自己的高度上限与滚动条；
- **单行标题**：去掉每行的图标与「N 条消息」副行，只保留标题 + 溢出省略号，置顶项在右侧显示 ✦，完整名称与条数放在 `title` 提示里；
- **工作区选择**从描边卡片降为普通安静行（悬停才有底色）；
- **底部固定**：`.side-footer` 用 `position: sticky` 吸底，设置/帮助/连接始终可达；
- 细滚动条（9px、悬停加深），不再出现系统默认样式；
- 分组标题从「工作区」改为「导航」，避免与上方工作区选择同名。

## 5. 原生能力（主进程 / preload）

| 通道 | 用途 |
| --- | --- |
| `system:disk` | `statfsSync` 读可用/总空间（默认取 `userData`） |
| `system:notify` | Electron `Notification`，点击恢复并聚焦窗口 |
| `credentials:get/set/remove` | `safeStorage`（Windows DPAPI）加密后写 `orbit-credentials.bin`，权限 0600 |
| `network:clients` | 代理 `/admin/clients`，规范化字段 |
| `network:disconnect` | 新增网关路由 `POST /admin/clients/disconnect`，从 `CLIENTS` 摘除并写 `client_disconnect` 日志 |
| `window:control` | 新增 `hide`（建托盘后隐藏）与 `restart`（`app.relaunch()`） |

密钥不再明文落在 JSON 里：管理密钥与云端密钥读取时先试保险箱，写入时加密。

## 6. 验收

```
pnpm typecheck     通过
pnpm test          24/24 通过（新增 components.test.mjs 6 项、qr.test.mjs 5 项）
pnpm check:design  令牌检查通过；对比度 189/189
pnpm build         通过（577 kB renderer bundle, gzip 160 kB）
pnpm visual        1 passed，39 s，生成 99 张基线（11 页 × 9 主题）
```

- 新增测试：`tests/components.test.mjs`（token 估算、斜杠解析、连接错误分类、字节格式化、密码强度、**中文文案完整性**——所有 `t()/tf()` 字面量都必须有中文条目）、`tests/qr.test.mjs`（编解码往返）。
- 视觉基线：`docs/2.0-plan/phase1/screenshots/<theme>/<page>.png`，通过 `window.__hymnixDev` 驱动主题与页面，`dismissOverlays()` 关掉首启/新版/二维码浮层，保证基线拍的是页面本身。
- CI：`.github/workflows/build.yml` 在类型检查后插入 `pnpm check:design`，令牌或对比度回归会直接失败。

## 7. 已知限制 / 下一步

- **视觉基线需要人工审阅**：这次是首次生成，没有历史版本可比对；后续改动量应关注 diff 而非像素值。
- `pnpm visual` 依赖 Electron 以 GUI 方式启动。若 shell 里存在 `ELECTRON_RUN_AS_NODE=1`（部分 IDE 宿主会注入），Electron 会退化成纯 Node 并拒绝 Playwright 的调试参数；测试已在 launch 前删除该变量。
- 中文文案完整性测试只覆盖 `t()/tf()` 的直接字面量与三元表达式内的字面量；数组驱动的标签（如设置分区名）仍需人工检查一次，本次已补齐 25 条。
- 无障碍只做了实现层面的适配（aria-live、forced-colors、44px 目标、键盘可达），尚未做屏幕阅读器的实际走查。
- 计划 §13.6 的“真实设备矩阵”仍未执行：只在 1440×900 / Windows 上拍过基线。
