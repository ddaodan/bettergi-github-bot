# Repo Bot

一个可组织级复用的 GitHub Bot 中央仓库，用于处理 Issue 模板校验、重复 Issue 关闭、标签同步和 AI 帮助回复。

## 功能

- Issue 模板校验，支持多模板、多规则和中英别名段落标题。
- 重复 Issue 检测，先做规则初筛，再按需走 OpenAI-compatible 复判。
- 托管标签同步，只增删配置中声明的标签。
- AI 帮助回复，默认关闭，使用触发标签控制。
- PR 功能预留了配置和上下文接口，当前版本不启用。

## 语言规则

- 默认输出中文。
- 当 issue 标题和正文判定为英文主导时，所有用户可见评论统一输出中英双语，中文在前、英文在后。
- 标签名、配置键、工作流名不自动翻译。

## 仓库职责

- 中央仓库：保存 Action、可复用 Workflow、配置 schema、示例模板和测试。
- 业务仓库：保存 `.github/repo-bot.yml` 和一份最小接入 workflow。

## 接入方式

1. 在业务仓库创建 `.github/repo-bot.yml`，可从 [`.github/repo-bot.example.yml`](.github/repo-bot.example.yml) 开始修改。
2. 在业务仓库新增 workflow，参考 [`examples/consumer-workflow.yml`](examples/consumer-workflow.yml)。
3. 若要启用 AI，在业务仓库配置 `REPO_BOT_AI_API_KEY` secret。
4. 如需动态覆盖配置，在业务仓库配置 `REPO_BOT_CONFIG_OVERRIDES_JSON` variable。

## 运行说明

- 入口 Action 使用 `node24` 运行时，主文件为 `dist/index.js`。
- 可复用 Workflow 监听 `workflow_call`，由业务仓库的 issue 事件触发。
- 中央 workflow 默认会从同一组织下拉取 `bettergi-github-bot` 仓库到 `.repo-bot` 目录。如果仓库名不同，需要同步修改 [`.github/workflows/repo-bot.yml`](.github/workflows/repo-bot.yml) 中的 `repository` 字段。

## 开发

```bash
npm install
npm run lint
npm test
npm run build
```
