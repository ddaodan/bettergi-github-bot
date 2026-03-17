# Repo Bot

可复用的 GitHub Repo Bot，用于在多个仓库中统一处理 Issue 质量、重复问题、标签同步与 AI 协助回复。

项目以 `JS Action + 可复用 Workflow` 形式交付，适合作为中央仓库维护，业务仓库通过 `@v1` 接入并复用能力。

## 为什么做这个项目

很多仓库都会重复遇到同一类问题：

- 新 Issue 缺少必要信息，维护者需要反复追问
- 重复 Issue 分散讨论，历史方案难以复用
- 标签依赖人工维护，容易不一致
- 用户需要基础排查建议，但维护者不希望被低价值重复问题占满时间

Repo Bot 的目标不是替代维护者，而是把这些标准化、可配置、可复用的流程前置自动化。

## 核心能力

### Issue 流程

- 模板校验：支持历史 Markdown 模板 marker、Issue Forms 标题前缀、段落标题匹配、必填 section 和占位文本检测
- 重复 Issue 检测：规则初筛 + 可选 AI 复判；高置信重复可自动关闭，未关单时可在 AI 评论顶部折叠展示相关 Issue
- 标签同步：仅管理配置中声明的托管标签，不影响维护者手工添加的非托管标签
- 内容自动打标：可让 AI 从当前仓库或指定仓库的标签目录中选择合适标签，并自动同步到当前 Issue
- AI 帮助回复：支持 OpenAI-compatible 接口，兼容 `responses`、`chat/completions` 和自动回退
- 评论指令：支持 `@bot /refresh` 与 `@bot /fix`

### 语言策略

- 默认中文
- 当 Issue 标题和正文判定为英文主导时，用户可见评论切换为中英双语，中文在前、英文在后
- 标签名、配置键、日志字段保持原样，不做双语化

### 架构预留

- 已预留 `pullRequests.review`、`pullRequests.labeling`、`pullRequests.summary`
- 当前 V1 仅实现 Issue 能力，PR 能力暂未落地

## 设计原则

- 中央维护，多仓复用
- 单功能可独立开关
- 无数据库依赖，默认仅依赖 GitHub API
- AI 能力可选，未配置时自动降级
- 用户可见评论尽量稳定、可更新、少刷屏

## 工作方式

推荐将本仓库作为中央 Bot 仓库，业务仓库只保留两类内容：

- 一个最小接入 workflow
- 一份 `.github/repo-bot.yml`

运行时的工作仓库并不是 Bot 仓库自己判断出来的，而是由调用方 workflow 决定。也就是说，哪个仓库触发了 workflow，Bot 就在那个仓库上下文里工作。

## 快速开始

### 1. 在业务仓库接入可复用 Workflow

推荐接入方式：

```yaml
name: Repo Bot

on:
  issues:
    types:
      - opened
      - edited
      - reopened
      - labeled
  issue_comment:
    types:
      - created
      - edited

jobs:
  repo-bot:
    uses: ddaodan/bettergi-github-bot/.github/workflows/repo-bot.yml@v1
    permissions:
      issues: write
      contents: read
    secrets:
      REPO_BOT_AI_API_KEY: ${{ secrets.REPO_BOT_AI_API_KEY }}
      REPO_BOT_GITHUB_APP_PRIVATE_KEY: ${{ secrets.REPO_BOT_GITHUB_APP_PRIVATE_KEY }}
    with:
      config-path: .github/repo-bot.yml
      config-overrides-json: ${{ vars.REPO_BOT_CONFIG_OVERRIDES_JSON }}
      ai-base-url: ${{ vars.REPO_BOT_AI_BASE_URL }}
      github-app-id: ${{ vars.REPO_BOT_GITHUB_APP_ID }}
```

更多示例见 [`examples/consumer-workflow.yml`](examples/consumer-workflow.yml)。

### 2. 在业务仓库添加配置文件

完整示例见 [`.github/repo-bot.example.yml`](.github/repo-bot.example.yml)。

当前示例默认使用中文标签名，并保留 `BUG` 作为缺陷标签，例如 `BUG`、`功能建议`、`问题咨询`、`需要更多信息`、`重复`。如果业务仓库已有既定标签体系，也可以在配置中自行覆盖。

最小配置示例：

```yml
runtime:
  languageMode: auto

providers:
  openAiCompatible:
    enabled: false
    baseUrl: https://api.openai.com/v1
    model: gpt-5.4
    apiStyle: auto

issues:
  validation:
    enabled: true
    fallbackTemplateKey: bug
    commentAnchor: issue-bot:validation
    templates: []
    duplicateDetection:
      enabled: true
  labeling:
    enabled: true
    autoCreateMissing: true
    managed: []
    definitions: {}
    aiClassification:
      enabled: false
  aiHelp:
    enabled: false
    triggerLabels: []
    commentAnchor: issue-bot:ai
  commands:
    enabled: false
    mentions:
      - "@bot"
    access: collaborators
    fix:
      enabled: false
      commentAnchor: issue-bot:fix
    refresh:
      enabled: false
```

### 3. 配置 Variables 与 Secrets

推荐使用下列配置：

- `REPO_BOT_AI_API_KEY`：AI 服务密钥
- `REPO_BOT_AI_BASE_URL`：AI 服务基地址，可覆盖配置文件中的 `providers.openAiCompatible.baseUrl`
- `REPO_BOT_CONFIG_OVERRIDES_JSON`：对 YAML 做深度覆盖的 JSON
- `REPO_BOT_GITHUB_APP_ID`：GitHub App ID
- `REPO_BOT_GITHUB_APP_PRIVATE_KEY`：GitHub App 私钥

### 4. 可选：启用基于内容的自动打标

如果希望 Bot 根据 Issue 内容自动附加业务标签，可以开启 `issues.labeling.aiClassification`：

```yml
issues:
  labeling:
    enabled: true
    autoCreateMissing: true
    aiClassification:
      enabled: true
      maxLabels: 3
      minConfidence: 0.65
      exclude:
        - BUG
        - 重复
      prompt: 优先选择和具体功能模块直接相关的标签。
      sourceRepository:
        owner: babalae
        repo: better-genshin-impact
```

行为说明：

- 标签目录默认取当前仓库；配置 `sourceRepository` 后可改为指定仓库
- 若目标标签在当前仓库不存在，且 `autoCreateMissing: true`，Bot 会按目录中的颜色和描述自动创建
- 当前实现只“自动添加”内容标签，不主动删除人工加上的业务标签
- 当跨仓库读取 labels 被当前 token 限制时，Bot 会对公开仓库回退到 GitHub 公共 API 只读抓取

## 事件流程

### `issues`

- `opened` / `edited` / `reopened`：
  `模板校验 -> 重复检测 -> 标签同步 -> AI 帮助`
- `labeled`：
  `标签同步 -> AI 帮助`

### `issue_comment`

- 仅处理 plain issue，不处理 PR 评论
- 仅处理 `created` / `edited`
- 仅在显式 mention 且命令匹配时执行

## 评论指令

支持的命令：

- `@bot /refresh`：重跑完整 Issue 主流程
- `@bot /fix`：生成修复建议和补丁草案

约束：

- 必须显式 mention；是否识别 `@bot`、`@your-app-name` 由 `issues.commands.mentions` 控制
- 默认仅 `OWNER`、`MEMBER`、`COLLABORATOR` 可执行
- `/refresh` 不会刷新 `/fix` 评论
- `/fix` 不会自动改代码、创建分支或发 PR，只输出建议

## AI 上下文增强

为了避免 AI 在仓库内 Issue 中仍然把“当前项目是谁”当成未知量，`issues.aiHelp` 会按层级自动注入项目上下文：

1. 当前仓库身份：`owner`、`repo`、`fullName`、Issue URL、模板类型
2. 仓库元数据：`description`、`topics`、`homepage`
3. README 摘要：本地转纯文本并截断
4. 人工项目档案：项目名、别名、简介、技术栈

推荐在业务仓库中补充：

```yml
issues:
  aiHelp:
    enabled: true
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

这样在用户提到简称、别名或产品名时，AI 更容易正确理解问题上下文。

## AI 接口与兼容性

当前内置 Provider 为 OpenAI-compatible。

- `apiStyle: auto`：优先请求 `responses`，失败时回退到 `chat/completions`
- `apiStyle: responses`：仅使用 `responses`
- `apiStyle: chat_completions`：仅使用 `chat/completions`

适合以下场景：

- 直接使用 OpenAI
- 通过代理网关访问 OpenAI-compatible 服务
- 接入支持 `responses` 但不完全兼容老式 completions 的模型网关

## GitHub App 与身份

如果只用默认 `GITHUB_TOKEN`，评论通常会显示为 GitHub Actions Bot。

如果希望评论、标签和关闭 Issue 等操作显示为独立 Bot 身份，建议使用 GitHub App：

- 在 GitHub 中创建并安装 App
- 在业务仓库配置 `REPO_BOT_GITHUB_APP_ID` 与 `REPO_BOT_GITHUB_APP_PRIVATE_KEY`
- workflow 会优先使用 App token；未配置时自动回退到 `GITHUB_TOKEN`

这也是后续扩展更多仓库自动化能力时更稳妥的鉴权方式。

## 版本策略

业务仓库推荐固定引用主版本标签：

```yaml
uses: ddaodan/bettergi-github-bot/.github/workflows/repo-bot.yml@v1
```

这样业务仓库不需要在每次更新后手动改提交 SHA。中央仓库只需要在确认稳定后移动 `v1` 标签即可。

## 项目结构

```text
src/
  config/
  core/
  github/
  i18n/
  providers/
  subjects/
    issue/
    pullRequest/
tests/
examples/
dist/
```

目录约定：

- `src/core`：通用流程与能力编排
- `src/config`：配置加载、schema、深度合并
- `src/github`：GitHub API 访问与评论/标签操作封装
- `src/i18n`：语言检测与评论模板渲染
- `src/providers`：AI Provider 抽象与实现
- `src/subjects/issue`：Issue 主流程与命令处理
- `src/subjects/pullRequest`：PR 预留适配层

## 本地开发

要求：

- Node.js 24+
- npm

常用命令：

```bash
npm install
npm run lint
npm test
npm run build
```

Action 运行入口：

- [`action.yml`](action.yml)
- [`dist/index.cjs`](dist/index.cjs)
- [`.github/workflows/repo-bot.yml`](.github/workflows/repo-bot.yml)

## 当前边界

- V1 仅覆盖 Issue 场景，PR 审核与总结仍是预留状态
- 不使用数据库，不做长期索引；重复检测基于 GitHub API 即时检索
- AI 回复和 `/fix` 建议仅供参考，最终判断应以项目文档、代码和维护者意见为准

## 路线图

- PR review / labeling / summary
- 更细粒度的命令权限与触发策略
- 更丰富的 Provider 适配
- 更强的相似 Issue 检测与上下文利用

## 相关文件

- [`.github/repo-bot.example.yml`](.github/repo-bot.example.yml)
- [`examples/consumer-workflow.yml`](examples/consumer-workflow.yml)
- [`action.yml`](action.yml)
- [`.github/workflows/repo-bot.yml`](.github/workflows/repo-bot.yml)
