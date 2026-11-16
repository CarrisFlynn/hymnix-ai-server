# Operations guide

## 1. First launch

1. Double-click `Hymnix-Orbit-1.3.0-Setup.exe` (or run the portable exe).
2. Windows may show SmartScreen because the build is self-signed; choose More info → Run anyway, or install the certificate first (see SIGNING.md).
3. The welcome sheet appears once: pick language, pick **Host a server** or **Connect to a friend**, then **Start using Hymnix Orbit**.

## 2. Local models

1. Open **Models**.
2. If a pink card says the model service is offline, press **Start Ollama**.
3. **Installed models** lists everything on this machine: use Select, Start, Stop or Delete.
4. **Downloadable models** lists the catalog. Type in the search box to filter, press Download on a row. Large models take a while; the button shows Working… until it finishes.

## 3. Host a server

1. Open **Gateway**.
2. Under **Host a server**, set the share name and a share password, then press Save. Generate creates a random password.
3. Press **Start tunnel**. The state moves Not started → Starting → Ready.
4. When Ready, press Copy next to the public address and send it with the name and password.
5. Restart rebuilds the tunnel if it drops; the backend also reconnects automatically when the process dies.

Notes:
- The tunnel does nothing until a share password exists. This is deliberate.
- The public address changes every time the tunnel restarts.
- Tunnel traffic is logged in the Terminal page; run `tunnel status` there for the current state.

## 4. Connect to a friend

1. Open **Gateway** → **Connect to a friend**.
2. Enter the address, share name and connection password you received.
3. Press **Connect**. On success the model list refreshes from their machine and chat requests go there.
4. Open **Models** to confirm the list belongs to the host. Open **Chat** and send a message.

## 5. Cloud API

1. In **Gateway**, find **Cloud API**.
2. Choose **Cloud API** as the source, enter the endpoint (for example `https://api.deepseek.com`), a model name and your key.
3. Press Save, then Test. A successful test reports how many models the endpoint offers.
4. The key is stored locally and shown masked afterwards.

## 6. Terminal commands

Open **Terminal**. The header shows connection, current folder, process state, model, tunnel state and hardware numbers.

| Command | Purpose |
|---|---|
| `help` | list commands |
| `status` | gateway, model count, current model, folder, tunnel state |
| `version` | app and gateway version |
| `models` | installed models, * marks the loaded one |
| `model NAME` | switch the current model |
| `start NAME` / `stop NAME` | load or unload a model |
| `pull NAME` | download a model |
| `tunnel on` / `tunnel off` / `tunnel restart` / `tunnel status` | tunnel control |
| `hardware` | GPU, VRAM and RAM figures |
| `config` | print editable gateway settings |
| `get KEY` | read one setting |
| `set KEY VALUE` | write one setting (whitelisted keys only) |
| `quota N` / `billing on` / `billing off` | quota and billing switches |
| `logtail` | last tunnel log lines |
| `ps` / `dir` | process list and folder listing |
| `lang en` / `lang zh` | switch language |
| `export` | export the current conversation |
| `open URL` | open a link in the browser |

Anything that is not a built-in command is passed to the workspace shell.

## 7. Settings worth knowing

- **Run at system startup** registers a login item; it starts hidden.
- **Start in fullscreen** applies on the next launch.
- **Scale text and icons** applies a zoom factor based on the primary display scale.
- **Enable GPU accelerated rendering** takes effect after a restart. Turn it off only if you see flicker.
- **Cache storage location** is applied at startup; restart after changing it.
- **How to open previews**: In-app preview uses the embedded Chromium pane on the right; Default browser hands the file to Windows.
- **Update automatically** is shown as enabled but is currently locked, because updates are managed by the installer.

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| Window does not open | Make sure no other instance is running; the app is single-instance. |
| Models page empty | Press Start Ollama, then Refresh models. |
| Tunnel stuck at Starting | Check the tunnel log in Terminal; cloudflared must be able to reach the network. |
| Friend cannot connect | The address expires when the tunnel restarts; resend the new address and password. |
| No thinking panel | Only reasoning models emit reasoning tokens. |

---

# 操作指南（中文）

## 1. 第一次启动

1. 双击 `Hymnix-Orbit-1.3.0-Setup.exe`（或直接运行免安装版）。
2. 因为是自签名，Windows 可能弹 SmartScreen：选“更多信息 → 仍要运行”，或先安装证书（见 SIGNING.md）。
3. 首次会出现欢迎弹层：选语言，选 **作为主机** 或 **连接朋友**，然后 **开始使用 Hymnix Orbit**。

## 2. 本地模型

1. 打开 **模型**。
2. 如果出现粉色提示“模型服务未启动”，点 **启动 Ollama**。
3. **已安装** 列出本机全部模型，可 选择 / 启动 / 停止 / 删除。
4. **可下载** 是内置清单：搜索框可过滤，点某一行的 **下载** 开始拉取；大模型需要较久，按钮会显示“处理中…”。

## 3. 给朋友当主机

1. 打开 **网关**。
2. 在 **作为主机** 里填共享名称和共享密码，点保存；“生成”可随机生成一个密码。
3. 点 **启动隧道**，状态会从 未启动 → 启动中 → 已就绪。
4. 就绪后点公网地址旁的 **复制**，把地址、名称、密码一起发给朋友。
5. 隧道掉线时点 **重启**；后端进程死掉时也会自动重连。

注意：
- 没有共享密码时隧道不会启动，这是有意的限制。
- 每次重启隧道公网地址都会变。
- 隧道日志在 **终端** 页，输入 `tunnel status` 可看当前状态。

## 4. 连接朋友

1. 打开 **网关** → **连接朋友**。
2. 填对方给的地址、共享名称、连接密码。
3. 点 **连接**，成功后模型列表会换成对方机器的，对话请求也发到对方。
4. 到 **模型** 页确认列表属于对方，然后回 **对话** 发消息。

## 5. 云端 API

1. 在 **网关** 页找到 **云端 API**。
2. 来源选 **云端 API**，填地址（如 `https://api.deepseek.com`）、模型名和密钥。
3. 点保存，再点测试；测试会回报可用模型数量。
4. 密钥保存在本机，保存后只显示打码结果。

## 6. 终端命令

打开 **终端**，顶部显示连接状态、当前目录、进程状态、模型、隧道状态和硬件数字。

| 命令 | 作用 |
|---|---|
| `help` | 列出命令 |
| `status` | 网关、模型数、当前模型、目录、隧道状态 |
| `version` | 应用与网关版本 |
| `models` | 已安装模型，带 * 表示已加载 |
| `model 名称` | 切换当前模型 |
| `start 名称` / `stop 名称` | 加载 / 卸载模型 |
| `pull 名称` | 下载模型 |
| `tunnel on/off/restart/status` | 隧道控制 |
| `hardware` | GPU、VRAM、内存数字 |
| `config` | 打印可改的网关配置 |
| `get 键` | 读一项配置 |
| `set 键 值` | 改一项配置（仅白名单内） |
| `quota N` / `billing on/off` | 配额与计费开关 |
| `logtail` | 最近隧道日志 |
| `ps` / `dir` | 进程列表与目录 |
| `lang en` / `lang zh` | 切换语言 |
| `export` | 导出当前对话 |
| `open 网址` | 用浏览器打开 |

不是内置命令的内容会交给工作区 shell 执行。

## 7. 设置里值得注意的

- **开机时运行**：注册登录启动项，启动时隐藏。
- **以全屏模式启动**：下次启动生效。
- **缩放文本与图标**：按主显示器缩放比例调整。
- **GPU 加速渲染**：重启后生效，出现花屏才需要关。
- **缓存储存位置**：启动时应用，改完请重启。
- **预览时使用的方式**：应用内预览用右侧内嵌 Chromium；默认浏览器交回 Windows。
- **有新版本自动更新**：显示为开启但当前锁定，因为更新由安装器统一管理。

## 8. 常见问题

| 现象 | 排查 |
|---|---|
| 窗口没出现 | 确认没有另一个实例在跑，应用是单实例的。 |
| 模型页空的 | 点启动 Ollama，再点刷新模型。 |
| 隧道一直启动中 | 到终端看隧道日志，cloudflared 需要能联网。 |
| 朋友连不上 | 隧道重启后地址会失效，把新地址和密码重新发一次。 |
| 看不到思考过程 | 只有推理模型才会输出思考内容。 |
