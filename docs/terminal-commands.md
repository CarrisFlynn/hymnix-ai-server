# Hymnix 终端命令参考

Hymnix 客户端「终端」页既是网关 / 隧道的实时控制台，也是一个可用的命令行。
输入命令后回车（或点 EXEC）执行，支持 ↑ / ↓ 调历史、Tab 补全、Ctrl+L 清屏。
未知命令会回显 `unknown command: X (try: help)`。

## 命令一览

| 命令 | 说明 | 用法 |
| --- | --- | --- |
| `help` | Show command guide | `help` |
| `clear` | Clear terminal output | `clear` |
| `status` | Show gateway and tunnel status | `status` |
| `version` | Show application version | `version` |
| `models` | List installed models | `models` |
| `model` | Set active model | `model <name>` |
| `sharemodel` | Set shared model | `sharemodel <name>` |
| `config` | Read or update configuration | `config get|set <key> [value]` |
| `path` | Show or change working path | `path [set <dir>]` |
| `tunnel` | Control public tunnel | `tunnel on|off|restart|status` |
| `quota` | Set daily token quota | `quota <n>` |
| `billing` | Enable or disable billing | `billing on|off` |
| `lang` | Set interface language | `lang <zh|en|fr|ru|es>` |
| `service` | Control local gateway service | `service start|stop|restart` |
| `hardware` | Show hardware information | `hardware` |
| `export` | Export terminal transcript | `export [file]` |
| `history` | Show command history | `history` |
| `logtail` | Show recent tunnel logs | `logtail <n>` |
| `ps` | List Hymnix processes | `ps` |

## 示例

```
> status
> models
> model qwen3:8b
> sharemodel qwen3:8b
> tunnel on
> quota 200000
> lang en
> export
```

## 注意

- `model` / `sharemodel` 只接受 `models` 列出的名称。
- `tunnel on` 需要同目录存在 `cloudflared.exe` 或 `ngrok.exe`。
- 危险命令（format / rd / del / shutdown / reg delete / bcdedit / diskpart）会二次确认。
- `export` 把当前终端缓冲导出到数据目录下的 txt 文件。
