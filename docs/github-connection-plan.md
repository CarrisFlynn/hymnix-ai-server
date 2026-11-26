# 用 GitHub 登录并连接仓库 —— 策划稿（待确认）

状态：草案，等待确认后再动代码。
目标读者：项目负责人（你）。
一句话：用 GitHub 设备授权码（Device Flow）登录，token 只存在主进程的加密库里，之后可以列仓库、克隆到工作区、提交/推送并开 PR——全部走审批。

---

## 1. 先说结论：能做，但有一个前提

设备授权码流程（Device Authorization Grant）是**桌面应用的标准做法**：应用只带一个公开的 `client_id`，没有 `client_secret`，用户在自己浏览器里输入 8 位码完成授权。GitHub 官方支持，OAuth App 里勾选 "Enable Device Flow" 即可。

**唯一硬前提**：需要一个已注册的 GitHub OAuth App 来提供 `client_id`。这不能由程序自动创建，必须有人在 GitHub 上点一次。

三种选择（需要你选一个）：

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A. 产品自带 client_id（推荐）** | 你在 GitHub 建一个 OAuth App（Hymnix Orbit），把 client_id 写进应用 | 用户打开即用，输入 8 位码就行 | 这个 client_id 是公开的；任何人可以拿它做同样的登录页（对公开客户端是常态，GitHub 也允许） |
| **B. 用户自填 client_id** | 设置页填自己的 client_id | 完全自托管、无关联 | 对普通用户太麻烦，等于劝退 |
| **C. 只支持粘贴 PAT** | 用户手动建 Personal Access Token 粘贴 | 零配置即可实现 | 体验差、权限容易给太大、无“登录”感 |

我的建议：**A 为主，C 作为兜底**（设备流程失败/离线/企业策略受限时还能用）。

---

## 2. 登录流程（技术细节）

```
1. 主进程 POST https://github.com/login/device/code
   body: client_id, scope="repo read:user"
   → { device_code, user_code, verification_uri, expires_in, interval }

2. 界面显示：user_code（如 ABCD-1234）+ 「在浏览器中打开」按钮
   打开 https://github.com/login/device，用户输入码并授权

3. 主进程按 interval 轮询 POST https://github.com/login/oauth/access_token
   body: client_id, device_code, grant_type=urn:ietf:params:oauth:grant-type:device_code
   → 等待时返回 authorization_pending / slow_down（按返回的区间加长）
   → 成功返回 access_token（形如 gho_…），失败返回 expired_token / access_denied

4. 主进程 GET https://api.github.com/user 拿 login / name / avatar_url
   → 渲染层只拿到「已登录为 @xxx + 头像」，**永远拿不到 token**

5. token 用 Electron safeStorage 加密后写进现有的 orbit-credentials.bin
   （沿用现在的 CredentialsApi，不新增存储机制）
```

取消与超时：15 分钟过期；用户关窗口、点取消、授权被拒，都要回到未登录状态且不残留轮询。

---

## 3. 权限（scope）

第一版建议 `repo` + `read:user`：
- `read:user`：显示是谁登录了。
- `repo`：列私有仓库、克隆、推送、开 PR。

如果你只想要公开仓库，可用 `public_repo read:user`，权限小很多——**需要你决定**。
组织开启了 SSO 时，用户还得在 GitHub 上给这个 OAuth App 授权组织访问，否则私有仓库会 404；界面上要把这个提示写清楚。

---

## 4. 登录之后能做什么（分三期）

### P1 登录态（最小闭环，约 1 天）
- 设置页 / 共享页旁边新增「GitHub」卡片：未登录 → 登录按钮；已登录 → @用户名、头像、断开连接。
- token 加密存盘，应用重启仍登录；token 失效（401）自动转为未登录并提示。
- PAT 兜底入口。
- 验收：断网、取消授权、码过期、token 被撤销四种情况都不崩、不残留。

### P2 仓库与工作区（约 1.5 天）
- 列出账号可见仓库（按最近更新排序，支持搜索）。
- 「克隆到工作区」→ 变成一个**后台任务**（复用 Jobs 面板），实时输出。
- 克隆时不把 token 写进命令行：用 `GIT_CONFIG_COUNT/GIT_CONFIG_KEY_n/GIT_CONFIG_VALUE_n` 环境变量把 `http.extraheader` 传给 git 子进程，token 不进 argv、不进 .git/config。
- 工作区识别成 Git 仓库后，显示当前分支、脏文件数，提供「提交并推送」（**走审批收件箱**）。

### P3 PR 与 Issues（约 2 天，可选）
- 看自己仓库的 open PR / issue，点进去用浏览器开。
- 从当前分支创建 PR（标题/正文/目标分支），同样走审批。

---

## 5. 安全边界（必须写死在实现里）

1. token 只在主进程；渲染层、日志、崩溃报告里都不能出现。
2. 不把 token 拼进 URL（`https://TOKEN@github.com` 会进 reflog 和错误信息）。
3. 不用命令行参数传 token（进程列表可见）；用环境变量或凭据助手。
4. 退出登录要真的删掉加密记录，并清掉 git 凭据缓存。
5. 推送/开 PR 属于外部可见操作 → 必须经过审批收件箱，且审批里显示仓库、分支、提交数。
6. 所有 GitHub API 调用带上 `Accept: application/vnd.github+json` 与 `X-GitHub-Api-Version`，便于以后升级。

---

## 6. 工作量与风险

- 总计 P1+P2 约 2.5 个工作日（不含 UI 打磨），P3 再加 2 天。
- 风险：
  - **OAuth App 必须你来注册**（我无法代替；注册后把 client_id 给我，或你自己填进配置）。
  - 企业网络可能屏蔽 github.com 或 device flow 端点 → PAT 兜底。
  - 私有仓库 + 组织 SSO 需要在 GitHub 侧额外授权，属于用户操作。
  - 设备流有轮询频率限制，实现里必须遵守 `interval` 与 `slow_down`。

---

## 7. 需要你现在确认的三件事

1. **client_id 谁来提供**：你注册一个 OAuth App（推荐），还是先只做 PAT？
2. **scope**：`repo`（含私有）还是 `public_repo`（只公开）？
3. **P2 是否包含“提交并推送”**，还是只到“克隆”为止？（推送会改远端，我倾向于做，但必须走审批。）

确认后我按 P1 → P2 的顺序实现，并把每一步的门禁、截图和失败路径都跑给你看。
