# Codex Synapse

一个本机运行的 Codex 对话地图。它读取当前用户的 `.codex/sessions` 中的 JSONL 会话记录。左侧选会话，中间显示每轮提问和回答，右侧可查看全文、从选中轮次创建分支并继续追问。

**来源与致谢：**本项目的非线性会话地图、卡片展示和分支追问交互借鉴了 [liangmianya/dsh-synapse](https://github.com/liangmianya/dsh-synapse)（DeepSeek Harness 版）。感谢原作者 liangmianya。本项目是面向 Codex 的独立适配，非原项目或 DeepSeek Harness 的官方版本。原项目的 MIT 许可证声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 本地安装

需要 Windows、Git、Node.js、Codex CLI 和 Codex 桌面端。下面是本机插件安装流程，在 PowerShell 中运行：

```powershell
git clone https://github.com/dddy-tt/codex-synapse.git
cd codex-synapse
npm --prefix desktop-plugin ci
npm --prefix desktop-plugin run build
.\setup-plugin.ps1
codex plugin marketplace add .
codex plugin add codex-synapse@synapse-local
```

重启 Codex 桌面端，从左侧插件入口打开“Synapse 会话地图”。`setup-plugin.ps1` 会根据当前机器生成 `desktop-plugin/.mcp.json`；这个文件和本地会话数据都不会进入 Git 仓库。生成的配置引用克隆目录的绝对路径，因此安装后不要移动或删除该目录。会话目录默认使用 `CODEX_HOME/sessions`，未设置 `CODEX_HOME` 时使用当前用户的 `.codex/sessions`；也可用 `CODEX_SESSIONS_DIR` 指定。

这是本地插件安装，不是从 GitHub 自动安装，也没有发布到 Codex 公共插件目录。本项目在 Windows 11、Node.js 24.16.0、Codex CLI 0.147.0 上验证过；其他版本尚未逐一测试。

## 在 Codex 桌面端使用

从左侧“…”菜单打开“Synapse 会话地图”。插件会在 Codex 窗口内显示本地会话列表、对话卡片和分支。如果 Codex 把地图放在窄分栏并留下空白，可点页面右上角的展开图标切换为完整页面。窄分栏中，点卡片可打开详情，点“收起详情”可回到地图。选择“在 Codex 原对话继续”会打开原会话，包含选中轮次之后的全部消息；它会从原会话当前末尾继续。选择“从此轮新建分支”时，地图上会在这张卡片下方显示输入框；发送后才建立新分支并追问，分支节点保留在源卡片附近。插件首次打开时会自动启动只监听本机的 Synapse 服务。

## 独立网页

在此目录运行：

```powershell
npm start
```

浏览器打开 <http://127.0.0.1:4318>。选择一张卡片，点“从此轮新建分支”，在卡片下方的输入框发送问题；分支节点会留在原卡片附近。

## 数据和限制

- 服务只监听 `127.0.0.1`，不对局域网开放；分支索引保存在本目录 `data/branches.json`，分支会话由本机 Codex 管理。
- 完整的 Codex 轮次会用 `thread/fork` 精确分叉。有些显示卡片属于同一个底层轮次，无法在中间精确分叉；这类卡片会创建新会话，并在首次追问时附上截至该卡片的对话文本。界面会标明是哪一种。
- 追问当前以只读沙盒运行，可讨论和分析，但不能直接修改工作区文件。等待回复最多 90 秒；超时或服务错误会在分支中显示。
- 若 Windows 系统代理启用且监听本机地址，子 Codex 服务会自动继承此代理；不修改系统网络设置。
- Codex 桌面端入口由本机 MCP 插件提供，地图直接在插件页面渲染，不依赖浏览器窗口。插件的本机接口仅供此页面读取会话和操作分支。
- 此仓库不包含个人会话记录、`data/branches.json`、本机插件配置和依赖缓存。

## 许可证

本项目使用 [MIT 许可证](LICENSE)。借鉴来源及原项目的许可证声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
