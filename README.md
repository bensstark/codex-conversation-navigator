# Codex Conversation Navigator

## 中文

一个本地、只读的 Codex 对话伴生页面。它会按用户消息生成侧边导航，帮助你快速搜索并直接跳转到长对话中的指定位置。

主要功能：

- 只显示用户消息和 Codex 的最终回答，不显示思考过程
- 支持 Markdown 和代码语法高亮
- 支持打开 `file://` 和 Codex 常见的 `/绝对路径/file.py:行号` 本地文件链接
- 本地代码查看器显示行号、定位到指定行，并按扩展名高亮 Python、Rust、Java、JSON、JavaScript/TypeScript、Go、C/C++、C#、Kotlin、Swift、Shell、SQL、HTML/XML、CSS、Markdown、YAML 等
- 代码块提供一键复制按钮
- 同时显示 VS Code 与 Codex CLI 对话，并可按来源筛选
- 在状态信息栏显示当前工作目录（CWD）
- 点击用户消息后立即跳转
- 按 `S` 隐藏或显示侧栏，按 `Q` 隐藏或显示顶栏
- 打开的本地代码查看器同样支持按 `Q` 隐藏或恢复顶栏
- 仅在本机 `127.0.0.1` 运行，不设访问控制，也不会修改 Codex 对话

### 要求

- Node.js 20.19 或更高版本
- `codex` 命令已安装并可在终端中使用

### 直接运行

```bash
git clone https://github.com/bensstark/codex-conversation-navigator.git
cd codex-conversation-navigator
node skill/conversation-navigator/scripts/server.mjs --cwd /path/to/your/project
```

浏览器通常会自动打开。页面只会显示工作目录与 `--cwd` 完全一致的 VS Code 和 Codex CLI 对话。

服务运行期间，本机其他进程也能读取对话 API。

本地文件链接会打开只读代码查看器；查看器通过安全的纯文本接口读取文件，只允许读取 `--cwd` 目录内的普通文件，单个文件最大 4 MiB。无法识别的扩展名会回退为纯文本。

### 安装为 Codex Skill

```bash
mkdir -p ~/.agents/skills
ln -s "$(pwd)/skill/conversation-navigator" ~/.agents/skills/conversation-navigator
```

然后在 Codex 中输入：

```text
使用 $conversation-navigator 打开当前项目的对话导航
```

---

## English

A local, read-only companion page for Codex conversations. It builds a sidebar from user messages so you can search and jump directly to any point in a long conversation.

Key features:

- Shows user messages and final Codex answers without reasoning traces
- Renders Markdown with syntax-highlighted code
- Opens `file://` URLs and Codex-style `/absolute/path/file.py:line` local file links
- Opens a read-only code viewer with line numbers, line targeting, and extension-aware highlighting for Python, Rust, Java, JSON, JavaScript/TypeScript, Go, C/C++, C#, Kotlin, Swift, Shell, SQL, HTML/XML, CSS, Markdown, YAML, and more
- Provides one-click copy buttons for code blocks
- Shows both VS Code and Codex CLI conversations with a source filter
- Shows the current working directory (CWD) in the status bar
- Jumps instantly when a user message is selected
- Press `S` to toggle the sidebar and `Q` to toggle the top bar
- The local code viewer also supports `Q` to hide or restore its top bar
- Runs only on local `127.0.0.1`, has no access control, and never modifies Codex conversations

### Requirements

- Node.js 20.19 or later
- The `codex` command installed and available in your terminal

### Run directly

```bash
git clone https://github.com/bensstark/codex-conversation-navigator.git
cd codex-conversation-navigator
node skill/conversation-navigator/scripts/server.mjs --cwd /path/to/your/project
```

The browser normally opens automatically. The page only shows VS Code and Codex CLI conversations whose working directory exactly matches `--cwd`.

Other processes on the same machine can read the conversation API while the server is running.

Local file links open a read-only code viewer. The viewer reads through a safe plain-text endpoint that only serves regular files below `--cwd`, limits previews to 4 MiB per file, and falls back to plain text for unknown extensions.

### Install as a Codex Skill

```bash
mkdir -p ~/.agents/skills
ln -s "$(pwd)/skill/conversation-navigator" ~/.agents/skills/conversation-navigator
```

Then ask Codex:

```text
Use $conversation-navigator to open the conversation navigator for this project.
```
