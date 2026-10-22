# Cloud Mail 上游稳定版审查

当前升级分支为 `chore/upstream-sync-v3.3.0`，审查 PR 为 https://github.com/ziww0515/cloud-mail/pull/1 。本次以真实 `v3.0.0` 树作为显式三方基线，将完整 `v3.3.0`（`4770960314875d45e7826e8c8350402b0c37ae05`）与本地定制合并。合并提交 `009844c` 保留上游 tag 为第二 parent，之后已有真实共同祖先；不是仅改 UI 版本号。

## 后续如何同步

`.github/workflows/upstream-review.yml` 在进入默认分支后，每周一 UTC 03:17（北京时间 11:17）及手动执行时，调用 `.github/scripts/upstream-review.sh`。脚本只从固定的 `maillab/cloud-mail` 远端发现最新 `v数字.数字.数字` 稳定 tag，不锁死在 3.3.0，也不跟随未发布 main。

已整合的版本直接结束。新版本创建固定版本分支和 draft PR；现有分支和任何已开/已关闭 PR 不覆盖、不重复创建。可以正常三方合并时保留本地定制；发生冲突则中止合并，仅提交可审查的上游 patch 与说明，不把冲突标记写入应用代码。脚本绝不使用 `--allow-unrelated-histories`、强制推送或自动部署。

所有更新均需人工审查并运行测试。迁移前备份现有 D1；保留现有 Worker、D1、KV、R2、用户数据、CSP/WAF/DNS。不得自动启用第三方登录、Webhook 或自动删除邮件。真实升级上线与长期 workflow 激活仍以默认分支合并、仓库 Actions 权限与生产部署回执为准；仅提交此文件不等于已经运行。

## 无副作用检查

在干净仓库执行 `UPSTREAM_REVIEW_DRY_RUN=1 bash .github/scripts/upstream-review.sh`，只读取远端并更新本地 Git fetch 引用，不提交、推送、创建 PR 或部署。Worker 单测使用 `mail-worker/wrangler-vitest.toml` 的隔离资源；`mail-worker` 的 `pnpm test` 是真正的 `vitest run`，不是部署命令。

## 本次生产迁移约束

3.3.0 不能只更新静态页面。现有 v3.0 D1 需增添 setting 新字段、oauth.platform 和邮件列表索引。上线前先备份现有 cloudmail，并通过 PRAGMA table_info / index_list 比对，逐项只执行缺少的新增字段和索引；不要无差别重跑包含旧迁移的 /api/init/:secret，也不要把 JWT secret 放入 URL 或运行日志。sync_delete 默认 1（关闭），auto_clean_days 默认 0（关闭），新增第三方登录和 Webhook 默认 1（关闭）。已有邮件、账号、配置和绑定不删除、不重建。

私有 Sent 正文保留完整验证码、登录域名和可信来源 IP；收件地址从运行时 owner 配置读取，不在公开源代码或前端资产中硬编码。旧的已脱敏历史记录没有可逆信息，不能凭空恢复。验收需在现有 Worker 更新后实发 my/cn 各一封，并通过 owner-only Sent 验证原文；本地测试通过不等于生产邮件已验收。

现有部署 workflow 已改为仅手动触发，必须明确确认旧库已备份并完成审查迁移。缺少现有 D1/KV 的精确 ID 即失败，删除了自动创建数据库/KV、自动初始化旧库和删除 workflow 运行记录的步骤。上游审查 workflow 本身没有部署步骤。
