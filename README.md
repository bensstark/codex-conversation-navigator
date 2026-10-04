# Codex Conversation Navigator

## 中文

一个本地、只读的 Codex 对话伴生页面。它会按用户消息生成侧边导航，帮助你快速搜索并直接跳转到长对话中的指定位置。

主要功能：

- 只显示用户消息和 Codex 的最终回答，不显示思考过程
- 支持 Markdown 和代码语法高亮
- 支持 LaTeX 数学公式：行内公式使用 `$...$` 或 `\(...\)`，独立公式使用 `$$...$$` 或 `\[...\]`；KaTeX 和字体随技能本地提供，代码块保留源码
- 支持打开 `file://` 和 Codex 常见的 `/绝对路径/file.py:行号` 本地文件链接
- 本地代码查看器显示行号、定位到指定行，并按扩展名高亮 Python、Rust、Java、JSON、JavaScript/TypeScript、Go、C/C++、C#、Kotlin、Swift、Shell、SQL、HTML/XML、CSS、Markdown、YAML 等
- 代码查看器顶栏支持调节字号（10–24px）
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
- 原生 Windows 10/11：在 PowerShell 中确认 `Get-Command codex` 能找到命令；如果找不到，请把 Codex 安装目录加入 `$env:Path` 后重新打开 PowerShell。
- WSL：继续使用 Linux 版 Node、`codex` 和 `/home/...` 路径；不要把 Windows `C:\...` 路径传给 WSL 进程。

### 快速启动（原生 Windows PowerShell）

在仓库目录执行；把 `$project` 改为要浏览的目标项目（路径始终加引号）：

```powershell
$project = (Resolve-Path "C:\path\to\your\project").Path
node ".\skill\conversation-navigator\scripts\launch.mjs" --cwd "$project"
```

Windows launcher 会快速返回完整的 `Conversation Navigator` URL 和后台进程 PID；服务会脱离当前终端继续运行，并在闲置 30 分钟后自动停止。需要禁止自动打开浏览器时追加 `--no-open`。不需要保留长运行的 Windows 终端。如果终端包装器没有返回任何输出，不要重复启动；请在单独命令中读取 `(Join-Path ([IO.Path]::GetTempPath()) 'codex-conversation-navigator\last-launch.json')`，核对 `status`、`cwd`，再使用记录中的 `url` 和 `pid`。

```powershell
$statePath = Join-Path ([IO.Path]::GetTempPath()) 'codex-conversation-navigator\last-launch.json'
$state = Get-Content -Raw $statePath | ConvertFrom-Json
$state.status; $state.cwd; $state.url; $state.pid
```

### 直接运行（Native Windows PowerShell）

在仓库目录执行；把 `$project` 改为要浏览的目标项目（路径始终加引号）：

```powershell
$project = (Resolve-Path "C:\path\to\your\project").Path
node ".\skill\conversation-navigator\scripts\server.mjs" --cwd "$project"
```

此命令保留为前台诊断模式：需要查看启动错误或实时日志时直接运行 `server.mjs`；正常 Windows 使用上面的 launcher 即可。

PowerShell 中如果 `codex` 仍提示找不到，先运行 `Get-Command codex` 检查 PATH；服务会通过 `%ComSpec%` 启动固定的 `codex.cmd app-server`。

### 直接运行（Linux、macOS 或 WSL）

```bash
git clone https://github.com/bensstark/codex-conversation-navigator.git
cd codex-conversation-navigator
node "skill/conversation-navigator/scripts/server.mjs" --cwd "/path/to/your/project"
```

浏览器通常会自动打开。页面只会显示工作目录与 `--cwd` 完全一致的 VS Code 和 Codex CLI 对话。

服务运行期间，本机其他进程也能读取对话 API。

本地文件链接会打开只读代码查看器；查看器通过安全的纯文本接口读取文件，只允许读取 `--cwd` 目录内的普通文件，单个文件最大 4 MiB。无法识别的扩展名会回退为纯文本。

### 安装为 Codex Skill

原生 Windows PowerShell 推荐使用 Junction（不会要求管理员权限或 Developer Mode）。目标已存在时先停止并检查，不要静默覆盖：

```powershell
$source = (Resolve-Path ".\skill\conversation-navigator").Path
$parent = Join-Path $HOME ".agents\skills"
$target = Join-Path $parent "conversation-navigator"
New-Item -ItemType Directory -Force -Path "$parent" | Out-Null
if (Test-Path -LiteralPath "$target") { throw "Skill target already exists: $target" }
New-Item -ItemType Junction -Path "$target" -Target "$source"
```

如果仓库位于 WSL/UNC 路径导致 Junction 不可用，可在目标不存在时改用复制：

```powershell
$source = (Resolve-Path ".\skill\conversation-navigator").Path
$parent = Join-Path $HOME ".agents\skills"
$target = Join-Path $parent "conversation-navigator"
New-Item -ItemType Directory -Force -Path "$parent" | Out-Null
if (Test-Path -LiteralPath "$target") { throw "Skill target already exists: $target" }
New-Item -ItemType Directory -Force -Path "$target" | Out-Null
Copy-Item -Path "$source\*" -Destination "$target" -Recurse -Force
```

WSL 仍使用 Linux 的软链接命令：

```bash
mkdir -p "$HOME/.agents/skills"
ln -s "$(pwd)/skill/conversation-navigator" "$HOME/.agents/skills/conversation-navigator"
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
- Renders LaTeX math with `$...$`, `\(...\)`, `$$...$$`, and `\[...\]`; KaTeX and fonts are bundled locally, and code blocks remain literal
- Opens `file://` URLs and Codex-style `/absolute/path/file.py:line` local file links
- Opens a read-only code viewer with line numbers, line targeting, and extension-aware highlighting for Python, Rust, Java, JSON, JavaScript/TypeScript, Go, C/C++, C#, Kotlin, Swift, Shell, SQL, HTML/XML, CSS, Markdown, YAML, and more
- The code viewer toolbar supports font-size adjustment from 10px to 24px
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
- Native Windows 10/11: in PowerShell, verify that `Get-Command codex` finds the command. If it does not, add the Codex install directory to `$env:Path` and reopen PowerShell.
- WSL: keep using Linux Node, `codex`, and `/home/...` paths; do not pass Windows `C:\...` paths to a WSL process.

### Quick launch (Native Windows PowerShell)

From the repository directory; set `$project` to the project whose conversations you want to browse (quote paths):

```powershell
$project = (Resolve-Path "C:\path\to\your\project").Path
node ".\skill\conversation-navigator\scripts\launch.mjs" --cwd "$project"
```

The Windows launcher quickly prints the complete `Conversation Navigator` URL and the detached background process PID. The service continues after the terminal returns and stops after 30 minutes without activity. Add `--no-open` to suppress automatic browser opening; no long-running Windows terminal is needed. If the terminal wrapper returns no output, do not launch again. In a separate PowerShell command, read `(Join-Path ([IO.Path]::GetTempPath()) 'codex-conversation-navigator\last-launch.json')`, check `status` and `cwd`, and use the recorded `url` and `pid`.

```powershell
$statePath = Join-Path ([IO.Path]::GetTempPath()) 'codex-conversation-navigator\last-launch.json'
$state = Get-Content -Raw $statePath | ConvertFrom-Json
$state.status; $state.cwd; $state.url; $state.pid
```

### Run directly (Native Windows PowerShell)

From the repository directory; set `$project` to the project whose conversations you want to browse (quote paths):

```powershell
$project = (Resolve-Path "C:\path\to\your\project").Path
node ".\skill\conversation-navigator\scripts\server.mjs" --cwd "$project"
```

Keep this command as the foreground diagnostic mode when startup errors or live logs need inspection; normal Windows use should prefer the launcher above.

If PowerShell still reports that `codex` is not found, run `Get-Command codex` and fix PATH. The server uses `%ComSpec%` to start the fixed `codex.cmd app-server` command.

### Run directly (Linux, macOS, or WSL)

```bash
git clone https://github.com/bensstark/codex-conversation-navigator.git
cd codex-conversation-navigator
node "skill/conversation-navigator/scripts/server.mjs" --cwd "/path/to/your/project"
```

The browser normally opens automatically. The page only shows VS Code and Codex CLI conversations whose working directory exactly matches `--cwd`.

Other processes on the same machine can read the conversation API while the server is running.

Local file links open a read-only code viewer. The viewer reads through a safe plain-text endpoint that only serves regular files below `--cwd`, limits previews to 4 MiB per file, and falls back to plain text for unknown extensions.

### Install as a Codex Skill

On native Windows, prefer a Junction (it usually needs neither administrator rights nor Developer Mode). If the target already exists, stop and inspect it rather than silently replacing it:

```powershell
$source = (Resolve-Path ".\skill\conversation-navigator").Path
$parent = Join-Path $HOME ".agents\skills"
$target = Join-Path $parent "conversation-navigator"
New-Item -ItemType Directory -Force -Path "$parent" | Out-Null
if (Test-Path -LiteralPath "$target") { throw "Skill target already exists: $target" }
New-Item -ItemType Junction -Path "$target" -Target "$source"
```

If the repository is under a WSL/UNC path and Junction creation is unavailable, copy into a target that does not already exist:

```powershell
$source = (Resolve-Path ".\skill\conversation-navigator").Path
$parent = Join-Path $HOME ".agents\skills"
$target = Join-Path $parent "conversation-navigator"
New-Item -ItemType Directory -Force -Path "$parent" | Out-Null
if (Test-Path -LiteralPath "$target") { throw "Skill target already exists: $target" }
New-Item -ItemType Directory -Force -Path "$target" | Out-Null
Copy-Item -Path "$source\*" -Destination "$target" -Recurse -Force
```

WSL continues to use the Linux symlink command:

```bash
mkdir -p "$HOME/.agents/skills"
ln -s "$(pwd)/skill/conversation-navigator" "$HOME/.agents/skills/conversation-navigator"
```

Then ask Codex:

```text
Use $conversation-navigator to open the conversation navigator for this project.
```
