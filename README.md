# Hymnix Orbit 1.3.0

**One app, two roles: run a local model server for friends, or connect to a friend and use their hardware.**

![Hymnix Orbit](assets/hero.png)

## What it is

Hymnix Orbit is a desktop application that bundles a local model gateway (Python, no Java, no Node required on the target machine) with an Electron client UI.

- **Host mode** — you run the gateway on your machine, share a name and a password, open a public tunnel, and friends chat against your hardware.
- **Guest mode** — you enter a friend address, the share name and the connection password, and your chats and model list come from their machine.
- **Local mode** — everything stays on your own machine, no tunnel, no account.

> Previous releases (1.0–1.2) shipped a separate server build and a separate client build. **1.3.0 merges them into one integrated product.** The old split builds are no longer required; hosting and connecting are two modes of the same app.

## Downloads

| Package | File | Notes |
|---|---|---|
| Installer | installer/Hymnix-Orbit-1.3.0-Setup.exe | NSIS, installs per user, ~168 MB |
| Portable | portable/Hymnix-Orbit-1.3.0-Portable.exe | Single file, no installation |

Checksums are in `SHA256SUMS.txt`. The binaries are signed with a self-signed certificate, so Windows SmartScreen may still warn until the certificate is trusted; see `SIGNING.md` in the repository for the public-signing plan.

## Quick start

### Use it alone

1. Launch Hymnix Orbit and keep the default language.
2. Open **Models**, press **Start Ollama** if the card says the model service is offline.
3. Pick a model from the installed list, or download one from the catalog.
4. Go back to **Chat** and type. Press **Enter** to send, **Shift+Enter** for a new line.

### Host for a friend

1. Open **Gateway** → **Host a server**.
2. Set a **share name** and a **share password** (the tunnel refuses to start without a password).
3. Press **Start tunnel**. When the state chip turns **Ready**, copy the public address.
4. Send the address, share name and password to your friend. Their chats now run on your GPU/CPU.

### Connect to a friend

1. Open **Gateway** → **Connect to a friend**.
2. Enter the address you received, the share name and the connection password.
3. Press **Connect**. The model list and chat requests switch to their machine.

## Features

- Local model management: list, load, unload, delete, download from a 30+ model catalog.
- Cloud API as an alternative source (any OpenAI-compatible endpoint).
- Terminal console: status strip, live tunnel log, command set including `status`, `models`, `tunnel`, `hardware`, `config`, `set <key> <value>`.
- Chat with markdown, code blocks with copy, and a collapsible **thinking process** panel for reasoning models.
- Right control panel: model, reasoning effort, conversation save/load/export, GPU / VRAM / AI / RAM telemetry.
- Settings: startup behaviour, fullscreen, display scaling, smooth scrolling, GPU acceleration, cache location, in-app preview vs default browser.
- In-app preview pane (Chromium) for files and model output.
- English and Simplified Chinese, five themes.

## Screenshots

| | |
|---|---|
| ![Chat](screenshots/chat.png) | ![Gateway](screenshots/gateway.png) |
| ![Models](screenshots/models.png) | ![Terminal](screenshots/terminal.png) |
| ![Settings](screenshots/settings.png) | ![Support](screenshots/support.png) |

## Requirements

- Windows 10/11 x64.
- No Java, no Node.js, no WebView2 installation required.
- For local models: Ollama installed, or use the bundled start button.

## Privacy

- No telemetry and no analytics.
- API keys and the share password stay in `%LOCALAPPDATA%\Hymnix\gateway_config.json` on your machine.
- When you connect to a friend, your prompts are processed on their machine. When they connect to you, theirs are processed on yours.

## License

GNU Affero General Public License v3.0. See `LICENSE`.

## Links

- Repository: https://github.com/CarrisFlynn/hymnix-ai-server
- X: https://x.com/ShayHymnix
- Sponsor: https://ifdian.net/a/hymnixstudio

---

# Hymnix Orbit 1.3.0（中文）

**一个应用，两种角色：用自己的机器给朋友当模型服务端，或者连朋友的机器用他的硬件。**

## 这是什么

Hymnix Orbit 是把本地模型网关（Python，目标机器不需要 Java、不需要 Node）和 Electron 客户端界面打包在一起的桌面应用。

- **作为主机**：网关跑在你的机器上，你设共享名称和密码、开公网隧道，朋友连进来用你的硬件对话。
- **连接朋友**：填对方地址、共享名称、连接密码，模型列表和对话都来自对方机器。
- **本地模式**：全部留在本机，不开隧道、不需要账号。

> 以前（1.0–1.2）是客户端和服务端两个包分开发布，**1.3.0 合并成一个集成产品**：托管和连接是同一个应用的两种模式，旧的分开版本不再需要。

## 下载

| 版本 | 文件 | 说明 |
|---|---|---|
| 安装版 | installer/Hymnix-Orbit-1.3.0-Setup.exe | NSIS 安装包，按用户安装，约 168 MB |
| 免安装版 | portable/Hymnix-Orbit-1.3.0-Portable.exe | 单文件，双击即用 |

校验值见 `SHA256SUMS.txt`。当前是自签名证书，正式公开签名前 Windows SmartScreen 仍可能提示。

## 快速开始

### 自己用

1. 打开 Hymnix Orbit。
2. 进 **模型**，如果提示模型服务未启动，点 **启动 Ollama**。
3. 从已安装列表里选一个模型，或从可下载清单里下载一个。
4. 回到 **对话** 输入，**回车发送**，Shift+回转换行。

### 给朋友当主机

1. 打开 **网关** → **作为主机**。
2. 设置 **共享名称** 和 **共享密码**（没有密码时隧道拒绝启动）。
3. 点 **启动隧道**，状态变成 **已就绪** 后复制公网地址。
4. 把地址、名称、密码发给朋友，他的对话就跑到你的硬件上。

### 连接朋友

1. 打开 **网关** → **连接朋友**。
2. 填对方给的地址、共享名称、连接密码。
3. 点 **连接**，模型列表与对话请求都切到对方机器。

## 功能

- 本地模型管理：列表、加载、卸载、删除，30+ 模型的可下载清单。
- 云端 API 作为另一种对话来源（任意 OpenAI 兼容地址）。
- 终端控制台：状态条、隧道实时日志，命令含 `status`、`models`、`tunnel`、`hardware`、`config`、`set <key> <value>`。
- 对话支持 Markdown、代码块复制、推理模型的 **思考过程** 折叠面板。
- 右侧控制栏：模型、推理强度、对话保存/加载/导出、GPU / VRAM / AI / RAM 遥测。
- 设置：启动行为、全屏、显示缩放、平滑滚动、GPU 加速、缓存位置、应用内预览或默认浏览器。
- 应用内预览（Chromium）用于文件和模型输出。
- 中英双语，5 套主题。

## 环境要求

- Windows 10/11 x64。
- 不需要预装 Java、Node.js、WebView2。
- 跑本地模型需要 Ollama，可直接用内置的启动按钮。

## 隐私

- 没有遥测、没有统计上报。
- API Key 与共享密码只存在本机的 `%LOCALAPPDATA%\Hymnix\gateway_config.json`。
- 你连朋友时，你的提问在对方机器上处理；对方连你时，他的提问在你的机器上处理。

## 许可证

GNU Affero General Public License v3.0，见 `LICENSE`。
