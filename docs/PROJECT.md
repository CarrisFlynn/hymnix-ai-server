# Project overview

## What changed: from two products to one

Until 1.2.x the project shipped two separate builds:

| Old model | What it was | Problem |
|---|---|---|
| Server build | Python gateway, admin dashboard, ran the models | No usable day-to-day UI |
| Client build | Desktop UI that connected to a gateway | Needed a separate copy, separate updates, and manual key handling |

In 1.3.0 there is one product with two roles:

| Role | Who runs it | Where the models run |
|---|---|---|
| Host | The person sharing hardware | On the host machine |
| Guest | The friend | On the host machine |
| Local | Anyone | On the local machine, no tunnel |

The host and guest screens live in the same app, behind the same Gateway page. There is no separate client download any more, and no manual API-key entry: the app reads and injects the local key itself, and guests authenticate with a share name plus a share password.

## Architecture

    Electron main process
      window, custom title bar, IPC, settings
      spawns and supervises the gateway
      hosts the in-app preview (Chromium WebContentsView)

    Renderer (React)
      chat, gateway, models, terminal, monitor, settings
      no direct network access; everything through IPC

    Python gateway (packaged exe)
      OpenAI-compatible endpoint on 127.0.0.1:11435
      model management, config, tunnel control, admin API
      talks to Ollama on 127.0.0.1:11434

    cloudflared
      spawned on demand for the public tunnel

Design constraints kept deliberately:

- The target machine needs no Java, no Node.js and no WebView2 installation.
- The renderer never touches the filesystem or the network directly.
- Admin operations require the admin key; guest operations require a share password and receive a scoped token.
- The gateway is a separate process, so a crash does not take the UI down with it.

## Repository layout

    desktop/            Electron + React application
      src/main          main process, IPC, settings, preview
      src/preload       the only bridge exposed to the renderer
      src/renderer      UI, i18n, chat components, design system
      scripts           screenshots, i18n rebuild, certificates
    server/             Python gateway and capability modules
      gateway_core.py   HTTP server, auth, models, tunnel, config
      hxcore/           file, session, diff, git, ocr, plugins modules
      legacy/           quarantined Tk UI, never packaged
    docs/               guides, screenshots, checkpoints
    release-1.3.0/      published folder (installer, portable, docs)

## Data and privacy

| Data | Location |
|---|---|
| Gateway config, keys, share password | `%LOCALAPPDATA%\Hymnix\gateway_config.json` |
| App settings | `%APPDATA%\Hymnix Orbit\orbit-settings.json` |
| Saved conversations | renderer local storage |

No telemetry. No analytics. Nothing is uploaded except the requests you make to the model endpoint.

## What the release folder contains

| Path | Content |
|---|---|
| `installer/` | NSIS installer |
| `portable/` | single-file portable build |
| `screenshots/` | screenshots used in the README |
| `assets/hero.png` | README banner |
| `README.md` | English first, Chinese below |
| `CHANGELOG.md` | user-visible changes only |
| `OPERATIONS.md` | step-by-step guide |
| `PROJECT.md` | this document |
| `SHA256SUMS.txt` | checksums |
| `LICENSE` | AGPL-3.0 |

---

# 项目介绍（中文）

## 从两个产品变成一个

1.2.x 之前是分开两个包：

| 旧模型 | 是什么 | 问题 |
|---|---|---|
| 服务端包 | Python 网关、管理面板，跑模型 | 没有可用的日常界面 |
| 客户端包 | 连网关的桌面 UI | 要装两份、更新两份、还要手填密钥 |

1.3.0 起是一个产品的两种角色：

| 角色 | 谁在用 | 模型跑在哪 |
|---|---|---|
| 主机 | 共享硬件的人 | 主机本机 |
| 访客 | 朋友 | 主机本机 |
| 本地 | 任何人 | 本机，不开隧道 |

主机和访客在同一个应用里，都在网关页。不再有单独的客户端下载，也不用自己填 API Key：应用自己读取并注入本机密钥，访客用“共享名称 + 共享密码”认证。

## 架构

    Electron 主进程
      窗口、自绘标题栏、IPC、设置
      启动并守护网关
      承载应用内预览（Chromium WebContentsView）

    Renderer（React）
      对话、网关、模型、终端、监控、设置
      不直接碰网络和文件系统，全部走 IPC

    Python 网关（打包成 exe）
      127.0.0.1:11435 上的 OpenAI 兼容接口
      模型管理、配置、隧道控制、管理接口
      与 127.0.0.1:11434 的 Ollama 通信

    cloudflared
      需要时启动，负责公网隧道

刻意保留的约束：

- 目标机器不需要 Java、Node.js、WebView2。
- 渲染层不直接访问文件和网络。
- 管理操作需要 admin key；访客操作需要共享密码并换取受限令牌。
- 网关是独立进程，崩了不会带走界面。

## 数据与隐私

| 数据 | 位置 |
|---|---|
| 网关配置、密钥、共享密码 | `%LOCALAPPDATA%\Hymnix\gateway_config.json` |
| 应用设置 | `%APPDATA%\Hymnix Orbit\orbit-settings.json` |
| 保存的对话 | 渲染层本地存储 |

没有遥测、没有统计。除了你自己发往模型端点的请求，不上传任何东西。

## 发布文件夹结构

| 路径 | 内容 |
|---|---|
| `installer/` | NSIS 安装包 |
| `portable/` | 免安装单文件版 |
| `screenshots/` | README 用到的截图 |
| `assets/hero.png` | README 横幅 |
| `README.md` | 英文为主，中文在后 |
| `CHANGELOG.md` | 只列用户可见改动 |
| `OPERATIONS.md` | 逐步操作指南 |
| `PROJECT.md` | 本文档 |
| `SHA256SUMS.txt` | 校验值 |
| `LICENSE` | AGPL-3.0 |
