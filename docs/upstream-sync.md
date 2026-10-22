# Cloud Mail 上游稳定版审查

升级审查 PR https://github.com/ziww0515/cloud-mail/pull/1 已合并到默认分支，现有 Worker 已部署真实 3.3.0。本次以真实 `v3.0.0` 树作为显式三方基线，将完整 `v3.3.0`（`4770960314875d45e7826e8c8350402b0c37ae05`）与本地定制合并。合并提交 `009844c` 保留上游 tag 为第二 parent，之后已有真实共同祖先；不是仅改 UI 版本号。

## 后续如何同步

`.github/workflows/upstream-review.yml` 的目标时间为每月第一天 00:00（Pacific/Auckland），也支持手动执行；正常定时调度每月只放行一个候选时段。为覆盖上月 28—31 日，UTC 候选为 11:00（NZDT）和 12:00（NZST），候选工作流会由 `.github/scripts/auckland_schedule.py` 严格筛选：只有当地日期为 1 日、处于 00:00—00:59、且使用与当前新西兰季节偏移匹配的 cron 槽位才会运行。月末候选中不属于当地第一日的调度会跳过；错误季节的候选即使延迟进入当地午夜，也会跳过，避免重复；正确槽位延迟达到当地 01:00 或更晚同样跳过。手动触发不受午夜时段限制；该时段筛选不是持久化的执行次数锁，已有按版本分支/PR 检查仍防止重复创建更新 PR。

GitHub 的定时工作流是尽力调度，可能延迟、丢弃或被暂停，因此这里保证的是候选筛选语义，不保证精确在 00:00 启动，也不保证每月一定成功执行。公开仓库连续 60 天没有仓库活动时还可能自动禁用定时工作流。参见 https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows 。没有为了保活重启任何已暂停的监控任务。

首次手动检查已成功：https://github.com/ziww0515/cloud-mail/actions/runs/39703755900 。脚本只从固定的 `maillab/cloud-mail` 远端发现最新 `v数字.数字.数字` 稳定 tag，不锁死在 3.3.0，也不跟随未发布 main。

已整合的版本直接结束。新版本创建固定版本审查分支并尝试创建 draft PR；若仓库策略禁止 Actions 创建 PR，不放宽安全设置，而是保留已同步的审查分支，并在运行摘要给出人工比较/建 PR 链接。现有分支和任何已开/已关闭 PR 不覆盖、不重复创建。可以正常三方合并时保留本地定制；发生冲突则中止合并，仅提交可审查的上游 patch 与说明，不把冲突标记写入应用代码。提交包含 `[skip ci]`，避免连接的构建服务意外部署。脚本绝不使用 `--allow-unrelated-histories`、强制推送或自动部署。

经 owner 明确批准，仅本仓库已打开 “Allow GitHub Actions to create and approve pull requests”，仓库默认工作流权限仍为 read。GitHub 将创建与批准合并为一个开关；本上游工作流仅为审查分支推送和创建草稿请求 contents: write、pull-requests: write，代码不调用批准审查或合并 PR 的接口，不更新 main，不迁移、不部署。这个组合开关本身不是禁止批准的技术隔离；约束来自经过审查的工作流及脚本，未来修改同样需要人工审查。

所有更新均需人工审查并运行测试。迁移前备份现有 D1；保留现有 Worker、D1、KV、R2、用户数据、CSP/WAF/DNS。不得自动启用第三方登录、Webhook 或自动删除邮件。同步的是可审查更新，不是未经授权的生产升级或数据库迁移。

## 无副作用检查

在干净仓库执行 `UPSTREAM_REVIEW_DRY_RUN=1 bash .github/scripts/upstream-review.sh`，只读取远端并更新本地 Git fetch 引用，不提交、推送、创建 PR 或部署。Worker 单测使用 `mail-worker/wrangler-vitest.toml` 的隔离资源；`mail-worker` 的 `pnpm test` 是真正的 `vitest run`，不是部署命令。

## 本次生产迁移约束

3.3.0 不能只更新静态页面。现有 v3.0 D1 需增添 setting 新字段、oauth.platform 和邮件列表索引。上线前先备份现有 cloudmail，并通过 PRAGMA table_info / index_list 比对，逐项只执行缺少的新增字段和索引；不要无差别重跑包含旧迁移的 /api/init/:secret，也不要把 JWT secret 放入 URL 或运行日志。sync_delete 默认 1（关闭），auto_clean_days 默认 0（关闭），新增第三方登录和 Webhook 默认 1（关闭）。已有邮件、账号、配置和绑定不删除、不重建。

成功邮件及私有 Sent 正文保留完整验证码、站点标签（仅“大陆站”或“全球站”）、可信来源完整 IP 和属地，不展示完整登录域名。发送失败记录也保留站点/IP/属地，但不记录未生效的验证码。收件地址从运行时 owner 配置读取，不在公开源代码或前端资产中硬编码。旧的已脱敏历史记录没有可逆信息，不能凭空恢复。验收需在现有 Worker 更新后实发 my/cn 各一封，并通过 owner-only Sent 验证原文；本地测试通过不等于生产邮件已验收。

现有部署 workflow 已改为仅手动触发，必须明确确认旧库已备份并完成审查迁移。缺少现有 D1/KV 的精确 ID 即失败，删除了自动创建数据库/KV、自动初始化旧库和删除 workflow 运行记录的步骤。上游审查 workflow 本身没有部署步骤。
