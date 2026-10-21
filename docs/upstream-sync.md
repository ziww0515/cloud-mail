# Upstream 3.3.0 同步与审查机制

本仓库的可审查更新分支为 `chore/upstream-sync-v3.3.0`。上游远端固定为
`https://github.com/maillab/cloud-mail.git`，本地定制（包括 Worker、D1、KV、CSP/WAF/DNS 相关配置）必须在 PR 中逐文件审查后才可合并。

## 当前核实结果

- `upstream/main` 的前端设置页明确显示 `v3.3.0`；本地设置页也为 `v3.3.0`，不是只改版本号。
- 上游当前历史与本地历史无共同祖先（`git merge upstream/main` 会拒绝 unrelated histories），因此本次不做盲目合并；直接覆盖会丢失本地定制。
- 每次同步先执行 `git fetch upstream --prune`，再从 `main` 创建 `chore/upstream-sync-<version>`，以文件级 diff 和构建/测试结果生成 PR。
- PR 只允许人工审查后合并；本任务不触发部署，也不改 Worker/D1/KV 绑定。

## 建议的持续流程

```sh
git fetch upstream --prune
git switch main
git switch -c chore/upstream-sync-<version>
# 对 upstream/main 做文件级审查；禁止无审查的整树覆盖
git diff --no-index <(git show upstream/main:path) path
git push -u origin chore/upstream-sync-<version>
# 使用 GitHub connector 创建 PR，确认 diff、测试和资源绑定后再决定是否合并
```

若上游继续保持无共同祖先，应先由维护者确认迁移范围，再逐项 cherry-pick/手工移植；不要使用 `--allow-unrelated-histories` 直接覆盖本地工作树。
