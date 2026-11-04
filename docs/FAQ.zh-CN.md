# 常见问题

**Q: 点「启动隧道」没反应 / 一直分配中？**
- 确认 `cloudflared.exe` 和服务端 exe 同目录
- Cloudflare 临时隧道有频率限制，连续申请会被限流，等几分钟再试
- 想固定地址：买域名 + Cloudflare 命名隧道（docs/SETUP.zh-CN.md 有说明）

**Q: 朋友连不上，我这边监控看不到任何请求？**
- 说明请求根本没到你的机器：地址过期 / 他的网络访问不了隧道域名
- 让他浏览器打开 `https://你的地址/health`，能看到 JSON 说明网络通

**Q: 显存一直占满？**
- 默认 60 秒空闲自动卸载；如果频繁对话会一直占用，属于正常
- 换更小的模型：`ollama pull qwen2.5:3b`

**Q: 端口 11435 被占用**
- 关闭旧实例，或改 `gateway_config.json` 的 `listen_port`

**Q: 模型回答很慢**
- 第一次请求要加载模型（几秒）
- 8G 显存跑 8B 模型本来就偏紧，可以换 3B/4B 模型

**Q: 支持工具调用吗？**
- 支持。`/v1/chat/completions` 带 `tools` 会返回标准 `tool_calls`
- 也支持「文本工具模式」：把工具调用以 JSON 写在正文里，兼容老客户端

**Q: 能接 DeepSeek / GPT / Gemini 吗？**
- 网关本身是本地模型；客户端「AI 接口」里可以填任何 OpenAI 兼容地址
