# AUTOMATION-CHECKPOINT — 2026-11-17 05:00

## 发布产物（已验证可运行）

`release-1.3.0/`

    README.md        英文为主，中文在后（含截图表格）
    CHANGELOG.md     1.3.0 / 1.2.0 / 1.1.0，英文 + 中文
    OPERATIONS.md    操作指南，英文 + 中文
    PROJECT.md       项目介绍、客户端/服务端合并说明、架构、隐私
    LICENSE          AGPL-3.0
    SHA256SUMS.txt
    assets/hero.png  1600x900 横幅（08d 风格）
    screenshots/     chat gateway models terminal settings support changelog history monitor
    installer/Hymnix-Orbit-1.3.0-Setup.exe  167,719,008 B  D9BF7DB1…
    portable/Hymnix-Orbit-1.3.0-Portable.exe 154,764,096 B  EC8CDE43…

## 测试结果（真机执行）

- 安装版：`/S` 静默安装到临时目录 → exit 0，主程序存在 → 启动存活 → `/health` ok（gateway 1.3.0, ollama true, 6 models）→ 静默卸载成功。
- 免安装版：直接启动存活 → `/health` ok。
- 源码：typecheck / test / build / electron-builder 全绿。

注意：在本机会话里跑 exe 必须清掉 `ELECTRON_RUN_AS_NODE`（父进程是 Electron 时会继承），否则 Electron 会以 Node 模式启动并立即退出。终端用户环境没有这个变量。

## 尚未完成

- **没有上传 GitHub**：仓库没配 remote，机器上也没有 gh CLI 和 token。需要 remote + 凭据（见下）。
- 仓库里不要提交 320MB 的 exe；二进制走 GitHub Releases，仓库只放文档/截图。
- 正式签名仍未做（当前自签名），见 docs/SIGNING.md。

## 上传步骤

     cd "<项目根>"
     git remote add origin https://github.com/CarrisFlynn/hymnix-ai-server.git   # 已有可跳过
     git add README.md CHANGELOG.md LICENSE docs assets screenshots
     git commit -m "docs: 1.3.0 integrated host/guest release notes"
     git push origin main

然后在 GitHub Releases 新建 v1.3.0，上传：

- installer/Hymnix-Orbit-1.3.0-Setup.exe
- portable/Hymnix-Orbit-1.3.0-Portable.exe
- SHA256SUMS.txt

## 隐私处理

公开文档只保留 Hymnix 工作室邮箱与 X 账号；Carris 个人邮箱只留在应用内的反馈面板，不写进仓库文档。
