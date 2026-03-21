# Repo Bot

一个可复用的 GitHub Repo Bot，用于在多个仓库中统一处理 Issue 模板检查、重复 Issue 检测、标签同步、AI 帮助回复和协作者指令。

项目以 `JavaScript Action + 可复用 Workflow` 的形式交付。业务仓库通过 `uses: owner/repo/.github/workflows/repo-bot.yml@v1` 接入，中央仓库负责版本发布、配置约定和能力演进。

## 功能概览

### Issue 自动流程

- 模板检查：校验 Issue 是否符合模板或表单要求；失败时评论提醒，通过时只同步标签。
- 重复 Issue 检测：规则初筛 + 可选 AI 复判；高置信重复可自动关闭，近似重复会在 AI 评论顶部折叠展示。
- 标签同步：仅管理配置中声明的托管标签，不删除维护者手工添加的非托管标签。
- AI 帮助回复：基于仓库上下文、README 摘要和 Issue 内容生成分析建议。
- 内容自动打标：可选启用 AI 从当前仓库或指定仓库的标签目录中挑选合适标签。

### 协作者指令

- `@bot /refresh`：重跑完整 Issue 主流程。
- `@bot /fix`：基于仓库上下文生成修复建议和补丁草案，不直接改代码。

### 语言策略

- 默认中文。
- 当 Issue 标题和正文判定为英文主导时，所有用户可见评论切换为中英双语，中文在前、英文在后。
- 标签名、配置键、日志字段保持原样，不做自动翻译。

## 架构说明

- 中央仓库：保存 Action、可复用 Workflow、配置 schema、测试和发布标签。
- 业务仓库：只保留接入 workflow、`.github/repo-bot.yml`、Variables 和 Secrets。
- 当前工作仓库不由 Bot 自己猜测，而是由调用方 workflow 决定。哪个仓库触发 workflow，Bot 就在那个仓库上下文中工作。
- 已预留 `pullRequests.review`、`pullRequests.labeling`、`pullRequests.summary` 配置位，当前版本仅实现 Issue 能力。

## 快速开始

### 1. 接入可复用 Workflow

推荐在业务仓库添加：

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

完整示例见 [examples/consumer-workflow.yml](examples/consumer-workflow.yml)。

### 2. 添加仓库配置

在业务仓库添加 `.github/repo-bot.yml`。完整示例见 [.github/repo-bot.example.yml](.github/repo-bot.example.yml)。

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
  autoProcessing:
    skipCreatedBefore: auto
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

- `REPO_BOT_AI_API_KEY`：AI 服务密钥。
- `REPO_BOT_AI_BASE_URL`：AI 服务基础地址；会覆盖配置文件中的 `providers.openAiCompatible.baseUrl`。
- `REPO_BOT_CONFIG_OVERRIDES_JSON`：对 YAML 做深度覆盖的 JSON。
- `REPO_BOT_GITHUB_APP_ID`：GitHub App ID。
- `REPO_BOT_GITHUB_APP_PRIVATE_KEY`：GitHub App 私钥。

## 行为说明

### 自动流程

- `opened` / `edited` / `reopened`：模板检查 -> 重复检测 -> 标签同步 -> AI 帮助。
- `labeled`：标签同步 -> AI 帮助。
- `issue_comment`：仅处理 plain issue 的 `created` / `edited`，且必须显式 mention。

### 自动忽略旧 Issue

当 `issues.autoProcessing.skipCreatedBefore` 配置为 `auto` 时：

- Bot 首次自动运行时会写入一个精确到秒的 UTC 时间到仓库变量 `REPO_BOT_AUTO_PROCESSING_SKIP_CREATED_BEFORE`。
- 激活时间之前创建的旧 Issue 不再因 `edited`、`reopened`、`labeled` 等自动事件触发主流程。
- `@bot /refresh` 和 `@bot /fix` 这类显式指令不受影响。

## AI 上下文与接口

### 项目上下文增强

`issues.aiHelp.projectContext` 默认开启，AI 帮助会按层级自动注入：

1. 当前仓库身份：`owner`、`repo`、`fullName`、Issue URL、模板类型。
2. 仓库元数据：`description`、`topics`、`homepage`。
3. README 摘要：本地转纯文本后截断。
4. 手工项目档案：项目名、别名、简介、技术栈。

推荐在业务仓库补充：

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

### OpenAI-compatible Provider

内置 Provider 支持：

- `apiStyle: auto`：优先调用 `responses`，失败时回退到 `chat/completions`。
- `apiStyle: responses`：只调用 `responses`。
- `apiStyle: chat_completions`：只调用 `chat/completions`。

适用于直接接 OpenAI、代理网关或其他兼容 OpenAI 协议的服务。

## 安全说明

- Bot 不会把 GitHub Actions secrets、GitHub App 私钥或 AI API Key 直接注入到 AI prompt 中。
- AI 帮助、重复检测 AI 复判、AI 标签分类和 `/fix` 都带有统一的 prompt injection 防护指令。
- AI 生成评论在渲染前会做本地净化，默认拒绝转储系统提示词、原始仓库上下文、原始代码上下文和明显敏感内容。
- `/fix` 会跳过常见敏感路径和敏感文本，例如 `.env`、`*.pem`、`appsettings*.json`、连接串、Token、私钥块等。
- 非 GitHub 托管的外部图片不会再作为多模态输入发送给 AI provider。
- 即使如此，仍不应将密钥、证书、凭据或其他敏感配置提交到仓库；公有仓库建议只向受信协作者开放 `/fix`。

## GitHub App 身份

如果只使用默认 `GITHUB_TOKEN`，评论通常显示为 GitHub Actions Bot。

如果希望评论、加标签、关闭 Issue 等操作显示为独立 Bot 身份，建议：

1. 创建并安装 GitHub App。
2. 在业务仓库配置 `REPO_BOT_GITHUB_APP_ID` 与 `REPO_BOT_GITHUB_APP_PRIVATE_KEY`。
3. workflow 会优先使用 App token；未配置时自动回退到 `GITHUB_TOKEN`。

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

主要入口：

- [action.yml](action.yml)
- [dist/index.cjs](dist/index.cjs)
- [.github/workflows/repo-bot.yml](.github/workflows/repo-bot.yml)

## 示例与相关文件

- [examples/consumer-workflow.yml](examples/consumer-workflow.yml)
- [.github/repo-bot.example.yml](.github/repo-bot.example.yml)
- [examples/issue-templates/bug.yml](examples/issue-templates/bug.yml)
- [examples/issue-templates/feature.yml](examples/issue-templates/feature.yml)
- [examples/issue-templates/question.yml](examples/issue-templates/question.yml)
