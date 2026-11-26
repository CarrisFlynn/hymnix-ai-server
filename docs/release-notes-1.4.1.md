# Hymnix Orbit 1.4.1

## English

### Highlights
- Four defects found in the 1.4.0 review are fixed: "always allow" silently revoked itself, the approval row never disabled while answering, plugin handlers could run their side effects twice, and `automation.update()` mutated before validating.
- Two request-boundary holes are closed: duplicate `Content-Length` and bodies on GET/HEAD/DELETE.

### Fixed
- **"Always allow" is no longer a toggle.** An already auto-approved tool shows **Revoke always-allow**, which only revokes; it never decides a request as a side effect.
- **The approval row disables while answering**, so a double click cannot decide the same request twice.
- **Plugin handlers are called exactly once.** The signature decides the convention; an exception inside a handler now propagates instead of being retried without arguments.
- **`automation.update()` validates into locals first**, so a rejected patch leaves the task untouched.
- **`fs.write` exposes one contract**: `data`/`text` are normalised to `content` before validation, and the schema requires `path` + `content`.

### Security
- Duplicate `Content-Length` headers are rejected with `400 conflicting_content_length` and the connection closes (one response on a raw socket).
- GET / HEAD / DELETE with a body are rejected with `400 body_not_allowed`.
- `_save_cfg()` now exists and writes atomically; before this the tunnel code called a missing function inside `try/except: pass`.
- Tunnel trust for forwarded headers is set only after cloudflared spawns, and a failed start leaves it off.

## 中文

### 重点
- 修掉 1.4.0 复审发现的四个缺陷：「总是允许」会静默撤销自己、审批行作答时从不禁用、插件 handler 可能重复副作用、`automation.update()` 先改后校验。
- 关闭两处请求边界漏洞：重复 `Content-Length` 与 GET/HEAD/DELETE 带 body。

### 修复
- **「总是允许」不再是切换。** 已自动放行的工具显示**撤销总是允许**，点击只撤销，不会顺带决策请求。
- **审批行在作答期间禁用**，连点不会对同一请求决策两次。
- **插件 handler 只执行一次。** 调用方式由签名决定，内部异常直接抛出，不再无参重试。
- **`automation.update()` 先校验到局部变量**，被拒的补丁不会改动任务。
- **`fs.write` 只暴露一个契约**：`data`/`text` 在校验前归一成 `content`，schema 要求 `path` + `content`。

### 安全
- 重复 `Content-Length` 返回 `400 conflicting_content_length` 并关闭连接（原始 socket 实测 1 个响应）。
- GET / HEAD / DELETE 带 body 返回 `400 body_not_allowed`。
- `_save_cfg()` 现在真实存在并原子写入；此前隧道代码在 `try/except: pass` 里调用一个不存在的函数。
- 转发头的隧道信任只在 cloudflared 成功启动后开启，启动失败保持关闭。
