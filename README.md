# Repo Bot

可复用的 GitHub Repo Bot，集中处理 issue 模板校验、重复 issue 检测、标签同步、AI 帮助回复和 Issue 评论指令。

## 功能

- Issue 模板校验：支持历史模板 marker、Issue Forms 标题前缀、段落标题匹配、必填 section、占位文本检测
- 重复 issue 检测：规则初筛 + 可选 AI 复判；未自动关单时可折叠展示相似 issue
- 标签同步：只管理配置中声明的托管标签
- AI 帮助回复：支持 OpenAI-compatible API、`responses`/`chat_completions`
- Issue 评论指令：支持 `@bot /refresh` 重跑完整 issue 流程，以及 `@bot /fix` 生成修复建议和补丁草案
- 语言模式：默认中文；英文 issue 输出中英双语

## AI 帮助上下文

AI 帮助会按以下层级自动补上下文：

1. 当前仓库身份：`owner/repo`、issue URL、模板类型
2. 仓库元数据：description、topics、homepage
3. README 摘要：本地规范化后截断
4. 人工项目档案：项目名、别名、简介、技术栈

推荐在业务仓库的 `.github/repo-bot.yml` 中填写 `issues.aiHelp.projectContext.profile`，尤其是项目存在缩写、品牌名或别名时。

## AI 提示说明

AI 生成的帮助评论和 `/fix` 建议评论会固定追加注释式提示：

- 中文 issue：`> 注：以上内容由 AI 生成，仅供参考，请结合项目文档、代码和维护者意见进一步确认。`
- 英文 issue：中英双语评论中同时附带中文和英文 note

## 配置示例

示例配置见：

- [`.github/repo-bot.example.yml`](.github/repo-bot.example.yml)
- [`examples/consumer-workflow.yml`](examples/consumer-workflow.yml)

`issues.aiHelp.projectContext` 关键字段：

```yml
issues:
  aiHelp:
    enabled: true
    triggerLabels: []
    commentAnchor: issue-bot:ai
    projectContext:
      enabled: true
      includeRepositoryMetadata: true
      includeReadme: true
      readmeMaxChars: 3000
      profile:
        name: BetterGI
        aliases:
          - BGI
          - Better Genshin Impact
        summary: Desktop automation assistant for Genshin Impact.
        techStack:
          - C#
          - WPF
          - .NET
```

`issues.commands` 关键字段：

```yml
issues:
  commands:
    enabled: true
    mentions:
      - "@bot"
    access: collaborators
    fix:
      enabled: true
      commentAnchor: issue-bot:fix
    refresh:
      enabled: true
```

命令规则：

- 仅处理 plain issue 的 `issue_comment` 事件，不处理 PR 评论
- 必须显式 mention，例如 `@bot /refresh`、`@bot /fix`
- 默认仅协作者可执行，未授权评论会被静默忽略
- `/refresh` 重跑模板校验、重复检测、标签同步和 AI 评论，但不会刷新 `/fix` 评论
- `/fix` 会维护单独的锚点评论，输出仓库上下文驱动的修复建议和补丁草案，不会自动提交代码

## AI 接口

- `apiStyle: auto`：优先请求 `responses`，不支持时回退到 `chat/completions`
- `apiStyle: responses`：只使用 `responses`
- `apiStyle: chat_completions`：只使用 `chat/completions`
- 配置文件中的 `providers.openAiCompatible.baseUrl` 可被环境变量 `REPO_BOT_AI_BASE_URL` 覆盖

## 接入方式

1. 在业务仓库放置 `.github/repo-bot.yml`
2. 在业务仓库放置接入 workflow，参考 [`examples/consumer-workflow.yml`](examples/consumer-workflow.yml)
3. 配置 `REPO_BOT_AI_API_KEY` secret
4. 如需覆盖网关地址，配置 `REPO_BOT_AI_BASE_URL` variable
5. 如需深度覆盖 YAML，配置 `REPO_BOT_CONFIG_OVERRIDES_JSON` variable
6. 如需启用评论指令，业务仓库 workflow 还需要订阅 `issue_comment` 的 `created` / `edited`

## 运行说明

- Action 入口运行时：`node24`
- 主文件：`dist/index.cjs`
- 可复用 workflow 入口：[`/.github/workflows/repo-bot.yml`](.github/workflows/repo-bot.yml)

## 开发

```bash
npm install
npm run lint
npm test
npm run build
```
