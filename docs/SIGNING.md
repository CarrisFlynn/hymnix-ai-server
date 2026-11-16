# 代码签名：现状与三条可行路线

## 现在是什么状态

已经打通签名流水线（electron-builder + 自带 signtool）：

- 主程序 `Hymnix Orbit.exe` 与安装包都已签名
- 证书是**自签名**：`CN=Hymnix Orbit (Self-Signed)`
- `Get-AuthenticodeSignature` 结果：`UnknownError`（"证书链终止于不受信任的根"）——这是自签名的正常结果，不是失败

也就是说：签名机制没问题，缺的是**受信任的证书**。

## 自签名证书（内测用）

```powershell
cd desktop
pnpm run cert:selfsigned          # 生成 certs/hymnix-orbit-selfsigned.pfx
$env:CSC_LINK=(Resolve-Path "certs\hymnix-orbit-selfsigned.pfx").Path
$env:CSC_KEY_PASSWORD="HymnixOrbit-Dev-2026"
pnpm run dist:sign
```

让某台电脑信任它（否则 SmartScreen 仍报警）：

```powershell
Import-Certificate -FilePath "certs\hymnix-orbit-selfsigned.cer" -CertStoreLocation Cert:\LocalMachine\Root
```

适合：自己机器、内测朋友机。**不适合**公开发布。

## 路线 A：SignPath（开源项目免费，推荐）

项目是开源的（GitHub CarrisFlynn/hymnix-ai-server），可以申请 SignPath Foundation 的免费签名：

1. https://signpath.org/apply 提交项目（GitHub 仓库地址、License、维护者账号）
2. 通过后在 SignPath 建 project + policy（如 `release-signing`）
3. 在 GitHub Actions 里加 `signpath/github-action-submit-signing-request`，产物走他们的 HSM 证书签
4. 成本 0，证书受信任，SmartScreen 正常

限制：必须开源、有 CI、审核 1-2 周。

## 路线 B：Azure Trusted Signing（便宜、需要 Azure 账号）

约 9.99 美元/月，微软托管证书，不需要买 USB token。

- 注册 Azure → 创建 Trusted Signing Account → 建 Certificate Profile（Individual 或 Organization）
- Individual 需要：身份验证（护照/身份证 + 自拍）、3 年? 实际为"个人身份验证"，通常 1-3 天
- Organization 需要：营业执照、注册满 3 年的公司主体（这是硬门槛）
- 配置到 electron-builder：`win.azureSignOptions = { publisherName, endpoint, certificateProfileName, codeSigningAccountName }`，并安装 `@azure/identity`

## 路线 C：商业 OV/EV 证书（最稳、最贵）

- Sectigo / DigiCert / SSL.com OV：约 200-400 美元/年，审核 1-5 天
- EV：约 400-700 美元/年，需要 USB 硬件 token 或云 HSM
- 拿到 .pfx 后同样用 `CSC_LINK` + `CSC_KEY_PASSWORD`，与自签名流程完全一致

## 结论

- 现在：签名流程已就绪，产物已签名（自签名），可内测
- 公开分发前：优先 SignPath（免费），其次 Azure Trusted Signing（便宜），最后商业证书
- 任何一条路线落地后，只需替换 `CSC_LINK`/`CSC_KEY_PASSWORD`（或 Azure 参数），构建命令不变
