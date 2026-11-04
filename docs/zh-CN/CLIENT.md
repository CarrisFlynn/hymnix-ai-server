# 客户端使用说明

`Hymnix-Client.exe` 是给被邀请的人用的桌面客户端。

## 连接服务器

打开 **设置 → AI 接口**：

| 字段 | 示例 | 说明 |
|---|---|---|
| 接口地址 | `https://abc-def.trycloudflare.com/v1` | 必须以 `/v1` 结尾 |
| API Key | `Hymnix...` | 以 `Authorization: Bearer` 发送 |
| 模型 | `qwen3:8b` | 服务器上有的任意模型 |

填完点 **测试连接**，再点 **保存**。

## 用别的 AI 服务

同样三个字段可以填任何 OpenAI 兼容地址：

- DeepSeek：`https://api.deepseek.com/v1`
- OpenAI：`https://api.openai.com/v1`

## 配置文件

客户端在同目录保存 `hymnix_client.json`：

```json
{
  "server_url": "https://your-tunnel/v1",
  "api_key": "YOUR_KEY",
  "model": "qwen3:8b",
  "user_name": "您",
  "ai_name": "Hymnix"
}
```

> 里面有你的 Key，不要外发、不要提交到仓库。
