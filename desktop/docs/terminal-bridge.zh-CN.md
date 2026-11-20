# 内置终端回复桥接（实验性）

Hymnix Orbit 可以接收本机脚本主动推送的回复。脚本通过 OpenAI 或 Gemini 的官方 API、支持导出的命令行工具或你自己的适配器取得回复后，再把文本发送给 Hymnix。此功能需要发送方提供回复文本，目前无法直接从 ChatGPT 或 Gemini 桌面窗口读取对话。

## 终端指令

| 指令 | 操作 |
| --- | --- |
| `bridge on` | 启用桥接。在终端展开「本机回复桥接连接信息」，查看地址和令牌。 |
| `bridge status` | 查看开关及待收取的回复数量。 |
| `bridge inbox` | 取出当前待收取的回复，在内置终端显示为纯文本。 |
| `bridge off` | 停止监听，清空待收取和已显示的回复。 |

## 用 PowerShell 推送一条回复

在本机 PowerShell 运行下面的示例。两个 `Read-Host` 会提示输入 Hymnix 内置终端里显示的地址和令牌，令牌输入时显示为遮挡字符。

```powershell
$endpoint = Read-Host 'Hymnix bridge endpoint'
if ($endpoint -cnotmatch '^http://127\.0\.0\.1:[0-9]{1,5}/reply$') { throw 'Use the local Hymnix endpoint.' }
$secure = Read-Host 'Hymnix bridge token' -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$json = @{ provider = 'gpt'; text = '这是一条桥接测试回复。' } | ConvertTo-Json -Compress
Invoke-WebRequest -Uri $endpoint -Method Post -Headers @{ Authorization = "Bearer $token" } `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($json)) -UseBasicParsing
```

适用于 Windows PowerShell 5.1 及 PowerShell 7。请求返回 HTTP 202 后，在 Hymnix 输入 `bridge inbox` 即可看到文本。把 `text` 换成适配器取得的回复，并按来源将 `provider` 设为 `gpt`、`gemini` 或 `other`。`provider` 只用于终端显示标签。

桥接默认关闭，只监听本机 `127.0.0.1` 的临时端口。退出、重新加载窗口或执行 `bridge off` 后，本轮连接信息失效。下一次启用会生成新令牌。每次最多发送 64 KiB 的 UTF-8 JSON，队列最多保存 8 条待收取回复。收到 HTTP 429 时，先运行 `bridge inbox` 清出位置再重试。
