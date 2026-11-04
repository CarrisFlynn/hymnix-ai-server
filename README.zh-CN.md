# Hymnix Local AI Server（本地 AI 服务器）

在自己电脑上跑一个私有的 AI 网关：模型跑在本机，通过隧道把地址分享给朋友，同时你能实时看到每一轮请求。

- 🖥 **本地优先**：模型在你自己的电脑上，Ollama 驱动，不需要云端账号
- 🔑 **密钥接入**：每个请求都要验证 API Key，Key 由你生成
- 🌍 **可分享**：内置 Cloudflare Tunnel（默认）/ ngrok，朋友拿到公网 HTTPS 地址就能连
- 📊 **实时监控**：终端轨迹、请求列表、每轮 GPU 占用 / 耗电 / 耗时
- 🧰 **OpenAI 兼容**：`/v1/chat/completions`，支持工具调用，任何 OpenAI 风格客户端都能接
- 🤖 **配套客户端**：给被邀请的人用的桌面客户端
- 🔌 **AI 接口**：客户端可以指向本服务器，也可以填任何 OpenAI 兼容服务

## 快速开始（约 5 分钟）

### 1. 安装 Ollama 并拉模型

```powershell
winget install Ollama.Ollama
ollama pull qwen3:8b
```

> 8G 显存可跑 `qwen3:8b`（16K 上下文）；显存更小就换小模型。

### 2. 启动服务端

- **Windows 用户**：从 Releases 下载 `Hymnix-AI-Server.exe`，双击运行
- **源码运行**：
  ```powershell
  pip install pyinstaller
  .\build.ps1
  ```

服务端监听 `127.0.0.1:11435`，配置、密钥、日志都在 exe 同目录。

### 3. 启动隧道并分享

1. 点状态栏的 **启动隧道**
2. 等公网地址出现，点 **复制地址**（会连地址 + API Key 一起复制）
3. 发给朋友

隧道是**按需申请**的：每次申请都会占一个公网地址，所以程序启动时不会自动开。

### 4. 朋友那边

把 `Hymnix-Client.exe`、地址和密钥发给他。客户端里 **设置 → AI 接口** 填：

| 字段 | 填什么 |
|---|---|
| 接口地址 | `https://<你的隧道>/v1` |
| API Key | 你复制的密钥 |
| 模型 | `qwen3:8b`（或你拉的其他模型） |

然后就能聊了，他的每次请求都会出现在你的服务端监控里。

## 仓库结构

```
server/    服务端（网关 + 隧道 + 监控），Tkinter
client/    给被邀请的人用的客户端
config/    配置示例
examples/  curl / Python / Node 调用示例
docs/      安装、客户端、安全、FAQ 文档
build.ps1  一键打包两个 exe
```

## 工作原理

```
朋友的客户端 ──HTTPS──> Cloudflare 隧道
                          │
                    Hymnix 网关 (127.0.0.1:11435)
                          │
                     Ollama (127.0.0.1:11434)
```

网关提供 OpenAI 兼容接口，转发给 Ollama，并记录每轮请求轨迹（提示词、工具、回复、token、GPU、功耗）。同一局域网也可以不开隧道，直接连 `http://<主机>:11435`。


> **数据位置**：配置、密钥、日志和下载的隧道组件都在 `%LOCALAPPDATA%\Hymnix\`（为微软商店打包做的调整）。删除该文件夹即可清空所有数据。

## 安全

- 网关只监听本机，朋友通过隧道访问
- API Key / 管理 Key 首次运行自动生成，存在 `gateway_config.json`
- **不要提交** `gateway_config.json`、`huimeng_config.json`、`logs/`、`tunnel_url.txt`
- 日志包含完整对话，属隐私数据，用内置的筛选清理功能处理

详见 [docs/SECURITY.zh-CN.md](docs/SECURITY.zh-CN.md)。

## 许可证

AGPL-3.0，见 [LICENSE](LICENSE)。

修改后作为网络服务对外提供时，AGPL 要求公开修改后的源码。
