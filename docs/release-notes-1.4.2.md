# Hymnix Orbit 1.4.2

## English

### Highlights
- Fixes the regression 1.4.1 introduced: an approved `fs.write` that used `data`/`text` failed because the alias was normalised after the approval digest.
- The proxy-trust flag is no longer persisted, and a malformed `Content-Length` is rejected instead of being read as zero.

### Fixed
- **Alias arguments survive the approval boundary.** Normalisation now happens before the digest at both the gateway and the tool registry, so what the user approves is exactly what runs.
- **Proxy trust is runtime-only.** `_save_cfg` strips it and startup forces it off, so a crash during a tunnel cannot leave the next launch trusting forwarded headers.

### Security
- A non-numeric `Content-Length` returns `400 invalid_content_length` and closes the connection.

### Housekeeping
- Dead `translateText` / `ATTRS` / `observer` leftovers removed.
- HANDOFF reflects the current tool loop and persistence.

## 中文

### 重点
- 修掉 1.4.1 引入的回归：用 `data`/`text` 的 `fs.write` 在批准后失败，因为别名在审批摘要之后才归一。
- 转发头信任标志不再落盘；非法 `Content-Length` 直接拒绝，不再当成 0。

### 修复
- **别名参数能跨过审批边界。** 网关与工具层都在计算摘要之前归一，用户批准的就是实际执行的那一份。
- **转发头信任改为纯运行时状态。** `_save_cfg` 不写它，启动时强制关闭，隧道期间崩溃也不会让下次启动信任转发头。

### 安全
- 非数字 `Content-Length` 返回 `400 invalid_content_length` 并关闭连接。

### 清理
- 删除 `translateText` / `ATTRS` / `observer` 死代码。
- HANDOFF 与实际工具循环、持久化状态一致。
