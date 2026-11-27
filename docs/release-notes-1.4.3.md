# Hymnix Orbit 1.4.3

## English

### Highlights
- The agent can now use the tools it was offered: background jobs, scheduled tasks, web search, image reading, a real language server, git worktrees, session search and programs that call other tools.
- Editing a large file no longer destroys it. `fs.edit` and `patch.apply` used to read the first 256 KB and write that back over the original, turning every LF into CRLF; a 380 000 byte file came back 270 882 bytes.
- In a packaged build the file and shell tools were scoped to the install directory, so they could only touch the app itself. They now work on the folder you picked.

### Added
- Background jobs from the agent: `job.start`, `job.list`, `job.output`, `job.kill`. `job.start` asks for approval first.
- Scheduled tasks from the agent: `schedule.list`, `schedule.create`, `schedule.update`, `schedule.remove`.
- `web.search` returns titles, URLs and snippets. Bing first, Baidu as fallback, and a relevance gate so an unrelated page is reported as no result rather than as an answer.
- `ask_user_question` puts up to four questions in front of you with options and a free-text field.
- `present` declares finished files and shows them above the composer, openable and locatable.
- `read_image` reads a picture from disk and attaches it to the next turn; attached images now reach the model instead of arriving as a file name.
- `lsp` asks a real TypeScript language server for definitions, references and outlines. The server ships inside the app.
- `run_code` runs a Node program whose only reach is the tool bridge, so every call inside it still asks for approval.
- `agent.send` no longer blocks; `agent.wait` collects results with one shared deadline; `agent.interrupt` aborts the request.
- `session_search` and `list_session` search your saved conversations.
- `worktree.list`, `worktree.create` and `worktree.remove` manage git worktrees.

### Changed
- Approvals show the whole command or program, and say how many characters are being withheld when a payload is clipped.
- The subagent tree folds for real, and `agent.spawn` can name a parent.
- Goal continuation prompts and the weekday separator follow the interface language.

### Fixed
- Editing a large file no longer truncates it or rewrites its line endings.
- `fs.read` reports truncation instead of trimming silently.
- Tools that were offered but permanently refused by the default policy now work: `patch.apply`, `web.fetch`, `term.read`, `term.list`, and plugin tools.
- `lsp` called on a folder no longer crashes the main process.
- "Allow this session" now answers the request in front of it instead of leaving it to expire.
- An agent named `__proto__` no longer breaks the session panel.
- Chinese output from `shell.run` and the terminal is decoded with the console code page.

### Security
- Web search reads response bodies with a 2 MB budget.
- Content-carrying tools accept up to 1 MB of arguments instead of being rejected at 8 KB.
- The development hook is compiled out of release builds, and a smoke test asserts it is absent.

## 中文

### 重点
- 模型终于能用上已经给它的那些工具：后台任务、定时任务、联网检索、看图、真语言服务器、Git 工作树、会话检索，以及能调用其它工具的程序。
- 编辑大文件不再毁文件。`fs.edit` / `patch.apply` 原本只读前 256 KB 再整份写回，还把每个 LF 变成 CRLF——380,000 字节的文件变回 270,882 字节。
- 打包版里文件与命令工具被限制在安装目录，只能碰应用自身；现在作用于你选的文件夹。

### 新增
- 后台任务：`job.start`、`job.list`、`job.output`、`job.kill`，`job.start` 先过审批。
- 定时任务：`schedule.list`、`schedule.create`、`schedule.update`、`schedule.remove`。
- `web.search` 返回标题、链接与摘要，Bing 优先、Baidu 兜底，并有相关性闸门——不相关就报「无结果」，不拿垃圾当答案。
- `ask_user_question` 最多四个问题，带选项与自由输入。
- `present` 声明交付文件并在输入框上方展示，可直接打开或定位。
- `read_image` 从磁盘读图并附到下一轮；贴进去的图片现在真的会送给模型，而不只是一个文件名。
- `lsp` 走真正的 TypeScript 语言服务器，做定义、引用与结构；服务器随应用发布。
- `run_code` 在独立进程里跑 Node 程序，唯一出口是工具桥，内部调用照样走审批。
- `agent.send` 不再阻塞；`agent.wait` 用共享 deadline 收集；`agent.interrupt` 真的中断。
- `session_search` 与 `list_session` 检索已保存的会话。
- `worktree.list`、`worktree.create`、`worktree.remove` 管理 Git 工作树。

### 变更
- 审批展示完整命令或程序；参数被裁剪时会说明还藏了多少字符。
- 子代理树真的能折叠；`agent.spawn` 可以指定父节点。
- 目标续跑提示与周几分隔符跟随界面语言。

### 修复
- 编辑大文件不再截断、不再改写行尾。
- `fs.read` 会标记截断，不再静默裁剪。
- 默认策略下被永久拒绝的已广告工具修好了：`patch.apply`、`web.fetch`、`term.read`、`term.list` 以及插件工具。
- `lsp` 传目录不再崩主进程。
- 「本次会话允许」会立刻批当前这条，而不是等它 55 秒后过期。
- 叫 `__proto__` 的代理不再让会话面板崩溃。
- 中文 Windows 上 `shell.run` 与终端的中文按控制台代码页解码。

### 安全
- 联网检索响应体按 2 MB 预算读取。
- 携带内容的工具参数上限提到 1 MB，不再在 8 KB 处拒绝。
- 开发钩子已从发布构建编译掉，并有冒烟测试断言它不存在。
