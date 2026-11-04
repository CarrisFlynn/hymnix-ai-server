# 安装指南

## 1. 准备

| 项目 | 说明 |
|---|---|
| Windows 10/11 | 预编译 exe 仅支持 Windows x64 |
| [Ollama](https://ollama.com/download) | 本地模型运行时 |
| 8G 内存 / 8G 显存 | 够跑 `qwen3:8b`（16K 上下文）；显存小就用更小的模型 |
| cloudflared.exe | **要用公网隧道才需要**：从 Cloudflare 下载后放在服务端 exe 同目录 |

## 2. 装模型

```powershell
ollama pull qwen3:8b
```

## 3. 启动服务端

### 方式 A：直接用 exe

1. 从 Releases 下载 `Hymnix-AI-Server.exe`
2. 放到一个空文件夹（配置和日志会写在这里）
3. 双击运行，首次启动会自动生成 `gateway_config.json`（含随机密钥）
4. 等状态栏「网关 / 模型」变绿

### 方式 B：源码运行

```powershell
git clone https://github.com/<你的账号>/hymnix-local-ai-server.git
cd hymnix-local-ai-server
pip install pyinstaller
.\build.ps1
```

## 4. 公网访问（可选）

1. 把 `cloudflared.exe` 放到服务端 exe 同目录
2. 点状态栏 **启动隧道**
3. 地址出来后点 **复制地址**（地址 + API Key 一起复制）
4. 把这两样发给朋友

> 隧道是手动申请的：每次申请都会占一个公网地址，自动创建既浪费又容易被限流。

## 5. 只走局域网

不开隧道。同一网络的人直连：

```
http://<你的内网IP>:11435/v1   例如 http://192.168.1.20:11435/v1
```

第一次运行时 Windows 防火墙可能弹窗，选「允许专用网络」。

## 6. 改端口 / 密钥

编辑 exe 同目录的 `gateway_config.json`：

| 字段 | 含义 |
|---|---|
| `listen_port` | 网关端口，默认 11435 |
| `api_key` | 朋友请求要带的密钥 |
| `admin_key` | 监控/管理接口密钥，**绝对不要外发** |
| `model_aliases` | 把客户端模型名映射到真实 Ollama 模型 |
| `compat_mode` | `auto` / `openai` / `text_tools` / `plain` / `json_only` |
| `idle_unload_seconds` | 空闲多少秒卸载模型（默认 60，省显存） |
| `keep_alive_agent` | 工具型客户端的保活时间（默认 300） |

改完重启程序生效。

## 7. 自检

```powershell
curl http://127.0.0.1:11435/health
```
