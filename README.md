# Repo Bot

一个可复用的 GitHub Repo Bot，用于在多个仓库中统一处理 Issue 模板检查、Sub-issue、重复 Issue 检测、标签同步、AI 帮助回复和协作者指令。

项目以 `JavaScript Action + 可复用 Workflow` 的形式交付。业务仓库通过 `uses: owner/repo/.github/workflows/repo-bot.yml@v1` 接入，中央仓库负责版本发布、配置约定和能力演进。

## 功能概览

### Issue 自动流程

- 模板检查：校验 Issue 是否符合模板或表单要求；失败时评论提醒，通过时只同步标签。
- 自动标题：模板通过后，可为仅保留模板前缀的 Issue 生成标题，并高置信纠正与正文明显无关的标题。
- 重复 Issue 检测：规则初筛 + 可选 AI 复判；高置信重复可自动关闭，近似重复会在 AI 评论顶部折叠展示。
- 标签同步：仅管理配置中声明的托管标签，不删除维护者手工添加的非托管标签。
- AI 帮助回复：基于仓库上下文、README 摘要、Issue 内容和安全读取的文本附件生成精简建议。
- 内容自动打标：可选启用 AI 从当前仓库或指定仓库的标签目录中挑选合适标签。
- Sub-issue：识别同仓库父 Issue，以及由同仓库评论创建的新 Issue；默认跳过严格模板、自动标题和重复关闭，同时保留标签与 AI 分析。

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
run-name: "Repo Bot #${{ github.event.issue.number }} - ${{ github.event_name }}/${{ github.event.action }} - @${{ github.actor }}"

on:
  issues:
    types:
      - opened
      - edited
      - reopened
  issue_comment:
    types:
      - created
      - edited

jobs:
  repo-bot:
    if: >-
      github.event.sender.type != 'Bot' &&
      (
        github.event_name != 'issue_comment' ||
        contains(github.event.comment.body, '/fix') ||
        contains(github.event.comment.body, '/refresh')
      )
    uses: ddaodan/bettergi-github-bot/.github/workflows/repo-bot.yml@v1
    permissions:
      issues: write
      contents: read
    secrets:
      REPO_BOT_AI_API_KEY: ${{ secrets.REPO_BOT_AI_API_KEY }}
      REPO_BOT_GITHUB_APP_PRIVATE_KEY: ${{ secrets.REPO_BOT_GITHUB_APP_PRIVATE_KEY }}
    with:
      config-path: .github/repo-bot.yml
      checkout-mode: full
      config-overrides-json: ${{ vars.REPO_BOT_CONFIG_OVERRIDES_JSON }}
      ai-enabled: ${{ vars.REPO_BOT_AI_ENABLED }}
      ai-base-url: ${{ vars.REPO_BOT_AI_BASE_URL }}
      ai-model: ${{ vars.REPO_BOT_AI_MODEL }}
      ai-api-style: ${{ vars.REPO_BOT_AI_API_STYLE }}
      ai-timeout-ms: ${{ vars.REPO_BOT_AI_TIMEOUT_MS }}
      action-ref: v1
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
  subIssues:
    mode: relaxed
    includeParentContext: true
    parentBodyMaxChars: 2000
  titleGeneration:
    enabled: true
    maxLength: 100
    detectMismatch: true
    mismatchConfidence: 0.9
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
  codeContext:
    source: workspace
    includeInAiHelp: false
    includeInFix: true
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
- 每个 `.github/repo-bot.yml` 配置字段都有独立的 `REPO_BOT_*` 环境变量；完整映射见 [环境变量配置](docs/environment-variables.md)。
- 数组和对象字段仍各占用一个独立变量，其值使用 JSON，例如 `REPO_BOT_ISSUES_LABELING_MANAGED='["BUG","重复"]'`。
- `REPO_BOT_CONFIG_OVERRIDES_JSON`：旧版全量 JSON 覆盖入口，仅为向后兼容保留。
- `REPO_BOT_GITHUB_APP_ID`：GitHub App ID。
- `REPO_BOT_GITHUB_APP_PRIVATE_KEY`：GitHub App 私钥。

配置覆盖优先级为：YAML < `config-overrides-json` 输入 < `REPO_BOT_CONFIG_OVERRIDES_JSON` 兼容变量 < 独立 `REPO_BOT_*` 配置变量 < `dry-run` 输入。

可复用工作流的 `checkout-mode` 默认为 `full`，因此现有 `@v1` 使用方无需修改。只依赖 `.github/repo-bot.yml` 且将 `issues.codeContext.source` 设为 `github` 的大型仓库，可以改为 `config-only`，此时 caller checkout 只拉取配置文件。

## 行为说明

### 自动流程

- `opened` / `edited` / `reopened`：模板检查 -> 标题生成 -> 重复检测 -> 标签同步 -> AI 帮助。
- `labeled`：不触发 Bot，维护者手动调整标签不会启动自动流程。
- `issue_comment`：仅处理 plain issue 的 `created` / `edited`，且必须显式 mention。

GitHub Actions 无法在事件产生前按评论作者过滤 `issue_comment`。示例 workflow 会在 job 启动前跳过 bot 评论和不含受支持指令的评论，并通过 `run-name` 标出 Issue 编号、事件和触发者；这些被过滤的记录会显示为 skipped，但不会 checkout 或运行 Bot。

### 自动忽略旧 Issue

当 `issues.autoProcessing.skipCreatedBefore` 配置为 `auto` 时：

- Bot 首次自动运行时会写入一个精确到秒的 UTC 时间到仓库变量 `REPO_BOT_AUTO_PROCESSING_SKIP_CREATED_BEFORE`。
- 激活时间之前创建的旧 Issue 不再因 `edited`、`reopened` 等自动事件触发主流程。
- `@bot /refresh` 和 `@bot /fix` 这类显式指令不受影响。

### Sub-issue

`issues.subIssues` 默认使用 `relaxed`：

- `relaxed`：不检查必填段落、不自动改标题、不执行重复检测或自动关闭；仍解析正文、同步标签并按现有触发条件生成 AI 帮助。
- `skip`：忽略 `opened`、`edited`、`reopened` 自动流程；协作者显式执行 `@bot /refresh` 时按 `relaxed` 处理。
- `normal`：与普通 Issue 执行相同完整流程，但重复检测会排除直接父 Issue 和直接子 Issue。
- `includeParentContext: true` 时，AI 帮助、AI 标签分类和 `@bot /fix` 可读取父 Issue 的编号、标题、状态、标签及正文摘要；摘要长度由 `parentBodyMaxChars` 控制。
- `@bot /fix` 始终保留现有模板前置校验，不会因 Sub-issue 身份自动放宽。
- 使用 GitHub 评论菜单创建的新 Issue，若正文保留 `_Originally posted by ... #issuecomment-..._` 脚注，Bot 会通过 GitHub API 校验同仓库来源评论、作者和引用内容；验证通过后将来源 Issue 作为父级上下文，并应用相同模式。
- 评论派生脚注被修改、引用内容与来源评论不一致、来源位于其他仓库或 API 校验失败时，Bot 会按普通 Issue 处理，避免仅靠伪造正文绕过模板检查。

当前版本只支持同仓库父 Issue 和同仓库来源评论。跨仓库父项或评论来源会被忽略，不申请额外仓库权限。建立或解除父子关系本身不会立即启动当前纯 Actions 流程；后续编辑、重新打开或执行 `@bot /refresh` 时会重新识别。

### 自动标题

`issues.titleGeneration` 默认开启，但只在模板检查通过后生效：

- 当前标题仅为模板默认前缀（例如 `[bug]`）或命中 `placeholderTitles` 时，使用 AI 生成简洁标题；AI 不可用或调用失败时保持原标题不变。
- 当前标题与正文的本地相关度极低时，才请求 AI 复核；只有 `shouldReplace: true` 且置信度达到 `mismatchConfidence` 才会修改。
- 正常标题不会仅因措辞或风格被重写，生成后仍保留模板前缀。
- 可通过 `enabled: false` 单独关闭，不影响模板检查、标签、重复检测或 AI 帮助。

### 日志与文本附件

AI 帮助和 `@bot /fix` 会读取 Issue 正文及人类评论中的 GitHub 托管文本附件：

- 仅接受 `https://github.com/user-attachments/files/...`，外部地址不会下载。
- 支持 `.log`、`.txt`、`.md`、`.json`、`.xml`、`.yaml`、`.yml`、`.csv`、`.trace`、`.out`。
- 每次最多读取 3 个附件；每个附件最多下载末尾 256 KiB，最终最多向 AI 提供 24,000 个字符。
- 私钥、token、密码和连接串等敏感片段会先在本地替换；附件内容被明确标记为不可信证据，不能覆盖系统指令。
- ZIP、7z 等压缩包和疑似二进制文件会跳过，不会自动解压或执行。附件读取失败只记录 warning，不会让 workflow 失败。

## AI 上下文与接口

### AI 回复精简规则

- BUG、功能建议和普通反馈不再重复输出问题概述；question 仅保留必要的直接回答。
- 可能原因/分析要点最多 3 条，处理步骤最多 5 条，待补充信息最多 3 条。
- 空栏目直接省略，不显示“暂无”；每条内容由本地渲染层限制长度，避免模型异常生成超长评论。

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

### 按需读取源码上下文

`issues.codeContext` 控制 AI 帮助和 `@bot /fix` 如何获取相关源码：

- `source: workspace` 保持原有行为，从 caller checkout 中查找相关文本文件。
- `source: github` 使用当前仓库的 GitHub API 按需读取。Bot 优先采用 Issue 中的显式仓库路径；未填写时，可从 `indexPath` 指向的 JSON 索引按脚本目录名、展示名、版本和分类定位。
- 唯一定位后最多读取 8 个相关文本文件；自动 AI 在无法定位时会降级继续，`@bot /fix` 会列出歧义候选并要求补充准确路径。
- 路径必须位于 `categoryRoots` 允许的根目录下，越界路径、疑似二进制文件、敏感路径及包含密钥等敏感内容的文件都会被跳过。

脚本索引仓库示例：

```yml
issues:
  codeContext:
    source: github
    includeInAiHelp: true
    includeInFix: true
    indexPath: repo.json
    indexRoot: repo
    categorySectionAliases:
      - 涉及范围
    nameSectionAliases:
      - 相关脚本名称与版本
    pathSectionAliases:
      - 脚本链接或仓库路径
    categoryRoots:
      JS 脚本:
        - repo/js
      地图追踪:
        - repo/pathing
```

### OpenAI-compatible Provider

内置 Provider 支持：

- `apiStyle: auto`：优先调用 `responses`，失败时回退到 `chat/completions`。
- `apiStyle: responses`：只调用 `responses`。
- `apiStyle: chat_completions`：只调用 `chat/completions`。

适用于直接接 OpenAI、代理网关或其他兼容 OpenAI 协议的服务。

## 安全说明

- Bot 不会把 GitHub Actions secrets、GitHub App 私钥或 AI API Key 直接注入到 AI prompt 中。
- AI 帮助、重复检测 AI 复判、AI 标签分类和 `/fix` 都带有统一的 prompt injection 防护指令；父 Issue 摘要同样被视为不可信输入。
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
