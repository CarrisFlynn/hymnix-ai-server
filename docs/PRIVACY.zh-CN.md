# 隐私政策

Hymnix AI Server 是本地优先程序，不包含遥测、统计或崩溃上报。

## 存了什么、存在哪

| 数据 | 位置 | 用途 |
|---|---|---|
| 程序配置（含 API Key） | %LOCALAPPDATA%\Hymnix\ | 重启后能恢复 |
| 对话日志 | %LOCALAPPDATA%\Hymnix\logs\ | 主控端查看请求（设计如此） |
| 隧道地址 | %LOCALAPPDATA%\Hymnix\tunnel_url.txt | 显示当前公网地址 |
| 下载的隧道组件 | %LOCALAPPDATA%\Hymnix\bin\ | 可选的公网访问 |

不会上传到作者。唯一的对外连接是：

1. Ollama 127.0.0.1:11434（本机）
2. Cloudflare / ngrok，仅在你主动点「启动隧道」时
3. GitHub（可选、仅一次），首次用隧道时下载 cloudflared.exe

## 日志与他人数据

邀请别人使用你的服务器，他们的提示词和回复会存在你的电脑上，这些数据由你负责。用内置筛选清理（删前自动归档）处理。

## 删除数据

删除 %LOCALAPPDATA%\Hymnix\ 并卸载程序即可。

## 联系方式

在 GitHub 仓库提 issue。
