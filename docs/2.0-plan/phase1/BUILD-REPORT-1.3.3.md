# Hymnix Orbit 1.3.3 打包与验证报告

日期：2026-11-25（第二轮：正式安装包）
上一版报告（2026-11-24）只交付了 ZIP 解压包，原因是当时 NSIS 子系统报 `spawn UNKNOWN`。本轮该问题未复现，安装器和便携版均正常产出。

## 交付产物

全部位于 `release/`：

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `Hymnix-Orbit-1.3.3-Setup.exe` | 168,151,376 B | `49b62b4872bfc2d33195608a4b3b11fd127086c28adb3718caabe33f50a988c5` |
| `Hymnix-Orbit-1.3.3-Portable.exe` | 155,265,631 B | `fa8a7298bbc72c5e733d5bd7007b3ff9e4e902c2f8b3df019ca2695706136b55` |
| `Hymnix-Orbit-1.3.3-Setup.exe.blockmap` | 177,074 B | — |

- 安装器：NSIS，非一键、可改安装目录、创建桌面与开始菜单快捷方式，安装界面支持中文/英文切换。
- 便携版：单文件自解压，不写安装目录。
- 解包目录：`build/stage-1.3.3c/win-unpacked/`（如需免安装直接运行，保留整个目录）。

## 构建链

1. `pnpm build`：tsc + Vite 生产构建（渲染层 IIFE 单包）+ 重写 `index.html` 脚本标签。
2. PyInstaller 6.19.0（Python 3.14）：`server/hymnix-server.spec` → `build/hymnix-orbit2-backend/hymnix-server-1.3.3-x64.exe`（30,829,476 B），随后以 `backend-gateway-headless.exe` 进入 resources。
3. electron-builder 26.18.0，electron 45.3.3，win x64，target = nsis + portable。

> 说明：默认的 `python`（3.13）没有 PyInstaller，本轮改用 `py -3.14 -m PyInstaller`。`pnpm dist` 里的 `build:backend` 仍写死 `python`，换机器前建议改成可配置的解释器。

## 包内容核对

- `resources/app.asar` 9.7 MB，含 `dist/renderer`（组件层、设计实验室、二维码编码器、纯函数库）与 `dist/main`（`system:disk`、`system:notify`、`credentials:get`、`admin/clients` 等新通道）。
- `resources/backend-gateway-headless.exe` 为本轮重新构建，包含新增的 `POST /admin/clients/disconnect`。
- `resources/cloudflared.exe`、`resources/engine-java/build/hymnix-engine.jar`、`resources/assets/hymnix-red-white-star.png` 均就位。

## 验证

- TypeScript 类型检查：通过。
- 桌面端测试：25/25 通过；设计令牌检查通过（4 个组件样式表仅用语义令牌）；主题对比度 189/189（9 主题 × 21 对）。
- Vite 生产构建：通过。
- 视觉基线：135 张（15 页 × 9 主题）已按本轮样式重拍。
- 打包产物真实启动：以 `--remote-debugging-port` 启动 `win-unpacked/Hymnix Orbit.exe`，CDP 连入后确认窗口渲染、导航 9 项、主题切换正常，并截图留档。

## 打包前修掉的两个缺陷

1. **「加载模型」按钮永久显示「加载中…」**：`modelBusy` 与当前模型名在空闲时都是空字符串，`modelBusy === model` 恒为真。已加非空判断，三处调用点一并修正。
2. **侧栏导航仍带拟物键帽投影**：旧 `styles.css` 给 `.nav` 设了 `box-shadow` 与 `translateY` 按压位移，新的扁平行没有覆盖这两项，导致每行看起来像浮起的小卡片。已删除 61 行键帽规则，导航改为纯扁平行（仅底色与文字变化，激活行用强调色底 + 左侧竖条）。

## 已知限制

- **未做代码签名**：无证书，安装器与主程序未签名，Windows SmartScreen 首次运行会提示「未知发布者」。
- **未做真机矩阵**：只在当前这台机器上验证启动与渲染，多分辨率、多 DPI、干净虚拟机安装未测。
- **`window.__hymnixDev` 仍在正式包中暴露**（`navigate` / `applyTheme` / `dismissOverlays`）。视觉基线测试依赖它，后续应改为构建期开关或仅在 `HYMNIX_VISUAL_TEST=1` 时挂载。
- **打包环境的一个坑**：若输出目录已存在 `win-unpacked`，宿主安全策略会以「批量删除」为由中断 electron-builder。本轮改为输出到全新目录（`build/stage-1.3.3c`）规避，与产品本身无关。
- NSIS 安装包体积主要来自 electron 运行时与 cloudflared（55 MB）；如需减重，可考虑改为按需下载 cloudflared。
