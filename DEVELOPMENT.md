# Better Fork 开发日志

DSH 插件：在官方分叉、官方 `/compact` 和官方压缩卡之上，提供「从这里开始」与压缩上下文编辑/移除。所有交互都通过官方 slot、官方命令和官方 Session 事件完成，不替换官方控件。

> 本日志面向维护者。行号基于当前工作树；重构后按符号名搜索。这里只记录契约、位置和排查顺序，具体实现以源码为准。

## 兼容性基线

当前验证基线（2026-10-22）：

| 项目 | 值 |
| --- | --- |
| DSH | `0.2.1-rc.2` |
| 插件 | `0.1.0` |
| 运行形态 | DSH Web GUI（desktop / browser） |
| Node | 24.20.0（开发 / 测试环境） |
| 测试 | `node --test`，46 passed |
| 平台 | Windows 桌面版实测；插件代码无平台分支 |

| DSH 版本 | 状态 | 说明 |
| --- | --- | --- |
| `0.2.1-rc.2` | ✅ 已验证 | 当前基线 |
| 其他 RC / 开发版 | ⚠️ 未验证 | 先按下面的升级流程跑测试和 inspect |

DSH 仍在快速开发中，以下接口按“可能变动”处理，不视为稳定 ABI：

- client slot 名称、kind、owner props、order 语义；
- client service 方法签名（`sessions.fork`、`uiWorkspace.forkSession`、`remote.commands.execute`）；
- Session 事件字段（`compaction/*`、`user/message` 的 `surfaceOp` / `source` / `shadowedSeqs`）；
- projection 的 `stateVersion` 与 `wire.view` 约定；
- `--dsw-alias-*` 主题 token 和官方 action row 的 DOM 结构。

## 显示元数据

插件列表的名称和描述来自 `locale/en.json`、`locale/zh.json` 的 `meta` 字段，由 DSH 按当前界面语言选择，英文作为兜底：

- 名称：`Better Fork`（en）/ `更好的分叉`（zh）
- 描述：随界面语言切换，说明「从这里开始」与上下文编辑能力
- 图标：`icon.svg`，通过 `./icon` 导出

## 功能边界

- **从这里开始**（assistant 底栏 / 会话 `...` 菜单）：在指定消息或最新完成轮次执行官方 fork，调用官方 `/compact`，打开新会话并自动打开压缩上下文编辑器。assistant 底栏排在官方复制/点赞/点踩/分支之后、用量/时间之前。
- **压缩卡**：只有手动 `/compact`（带 `sourceCommandId`）的卡片渲染插件动作；自动压缩卡保持官方渲染，不显示分叉、编辑或 Remove，Host 也拒绝 apply/remove。手动卡的 `分叉` 使用官方分支图标，在卡片最新位置执行普通官方 fork，不压缩、不打开编辑器，子会话标题按官方规则 +1；和 assistant/菜单一样先检查 `session/fork` 权限。`编辑上下文` 只对最新且尚未开始新对话的手动压缩卡显示。
- **编辑上下文**：在对话流内渲染；`×` / 取消 / Esc 关闭；点击外部不关闭；翻译默认低思考/不思考（优先 off/low），只改编辑框草稿，提交仍走 checkpoint 事务；会话运行中提交、Remove 直接禁用。
- **Remove**：移除 checkpoint 之后的官方尾部；单向操作，不提供恢复；后续普通编辑/翻译不会把已移除的 tail 带回来。

## 上下文语义

- **正常编辑**：模型输入顺序是 `system prompt（每次请求独立组装）→ 压缩 checkpoint → 官方 tail`。正常编辑只替换 checkpoint，tail 原样保留；tail 可能由多个节点组成，用 `tailCount` 查看。
- **Remove**：替换范围从 checkpoint 到 surface 末尾，并写入新的 checkpoint。checkpoint 之前的 system/developer/user 节点不在替换范围内；基础 system prompt 不进入 surface，因此不会被删。删尾后的会话 surface 是「压缩文本」，不是「压缩文本 + system prompt 被删」。
- **AGENTS.md**：由 `dsh-agent-instructions` 作为 user 角色的 `<system-reminder>` 注入，不是 system prompt，属于会话历史，会参与压缩。baseline 不可见时，下一次 `agent/pre-step` 会重新注入当前 AGENTS.md；因此不是只有全新会话才加载，fork / 压缩 / Remove 后也会按需加载。

## 升级检查顺序

1. 记录基线：运行 `dsh --version`，更新上面的兼容性表格。
2. 跑 `node --test`；失败用例通常直接指向契约变化。
3. 用 agent 的 inspect 工具查实时契约：
   - `Slots.listSubTree`：slot 是否仍存在、kind、registration、occupants、order；
   - `Service.listService`：`sessions` / `uiWorkspace` / `remote.commands` 的方法签名；
   - `Event.listEvents`：`compaction/*`、`user/message`、`turn/*` 的字段；
   - `Theme.listTokens`：`--dsw-alias-*` 是否仍存在。
4. 对照官方实现：
   - `@deepseek-ai/dsh-client-ui-chat` 的 `TurnTailNodeView`、`MessageIconActions`（action row 顺序、`extraActions`、`data-clock`）；
   - `@deepseek-ai/dsh-client-ui-workspace` 的 session menu 注册；
   - `ClientSessions.fork` / `increasedForkTitle`（标题 +1）；
   - `ui-conversation` 的 compaction 事件与投影。

官方源码在 DSH 安装包的 bundle 或 DSH 仓库的 `packages/client/...`；按符号名搜索，不要按固定行号。
5. 修改后同步更新本日志、兼容性表格和契约测试。

## 六个优先检查点

| # | 位置 | 作用 |
| --- | --- | --- |
| 1 | `lib/client.js:696-707` `forkAt` | 所有指定 seq 的分叉都从这里走；`sessions.fork` 的 `increaseTitle`、`atSeq`、`allowMigration` 变了就改这里 |
| 2 | `lib/client.js:714-988` `beginBetterBranch` / `watchBranch` | fork 后调用 `/compact`、等待新卡片、打开编辑器的唯一管线；`/compact` 的调用点在 `lib/client.js:740` |
| 3 | `index.js:182-281` `runOperation` | Host 所有操作的分发点；新增/修改 `status`、`apply`、`remove`、`translate`、`messageSeq` 都只改这里 |
| 4 | `lib/shared.js:108-229` `applyCompactionEditEvent` | 所有 `compaction/*`、`user/message` 的折叠规则；事件字段变化先改这里 |
| 5 | `lib/shared.js:63-106` `refreshView` + `index.js:63` `stateVersion` | `wire.view` 的唯一形状定义；改字段必须同步递增 `stateVersion` |
| 6 | `lib/client.js:1834-1909` | 注入服务、slot 名称、order、locale；官方槽位变更先看这里 |

`session.append` 的 compaction 事件序列已收口到 `lib/compaction-transaction.js`；不要在 `index.js` 重新复制事件顺序。

## 代码位置索引

### Host

| 位置 | 内容 |
| --- | --- |
| `index.js:35-44` | Host 服务 inject：`webServer`、`sessionController`、`sessionProjections`、`sessions`、`llm`、`commands` 等 |
| `index.js:58-126` | 投影注册、API route、人类命令注册 |
| `index.js:63` | 投影 `stateVersion` |
| `index.js:182-281` | `runOperation` 的 op 分发 |
| `index.js:311-394` | `readStatus`：读取卡片、tail、`started`、`canRemove` |
| `index.js:446-527` | `translateText`：翻译走官方 model 路由 |
| `index.js:499-620` | `applyEdit`：普通编辑 / Remove 的 checkpoint 事务 |
| `lib/compaction-transaction.js:1-81` | 所有 compaction 事务的 event 写入序列（start → summary → checkpoint → end） |
| `index.js:628-674` | `readProjectionState`：读取本插件投影 |
| `index.js:697-732` | `resolveAgent`：sessionId → Agent 上下文 |
| `index.js:734-767` | `assertAllowedOrigin`：API 来源校验 |

### Client

| 位置 | 内容 |
| --- | --- |
| `lib/client.js:619-669` | `post`：编辑器 HTTP 请求与错误码解析 |
| `lib/client.js:696-707` | `forkAt`：唯一指定 seq 分叉入口，`increaseTitle: true` |
| `lib/client.js:714-771` | `beginBetterBranch`：打开子会话、调用 `/compact`、启动卡片 watcher |
| `lib/client.js:774-796` | 菜单项：`uiWorkspace.forkSession`（最新完成轮次） |
| `lib/client.js:804-822` | `startForkAtAndCompact`：按 seq 启动 |
| `lib/client.js:831-844` | `startForkAtMessage`：assistant messageId → seq |
| `lib/client.js:852-874` | `branchAtCard`：压缩卡普通 fork |
| `lib/client.js:881-945` | `openFromCard`：消费 Host `status` 的 wire view |
| `lib/client.js:953-988` | `watchBranch`：轮询新压缩卡 id |
| `lib/client.js:1002` | `submit`：提交 checkpoint 编辑 |
| `lib/client.js:1085` | `translate`：翻译草稿 |
| `lib/client.js:1121-1166` | `refreshEditing`：编辑后刷新 wire view |
| `lib/client.js:1167` | `removeTail` |
| `lib/client.js:1257-1328` | `CompactionEditAction`：压缩卡动作行；`anchorSeq` 在 `1320-1322` |
| `lib/client.js:1335-1365` | `AssistantStartAction`：assistant 底栏动作 |
| `lib/client.js:1368-1392` | `StartSessionMenuItem`：会话 `...` 菜单项 |
| `lib/client.js:1395` | `EditDialog` |
| `lib/client.js:1665` | `ErrorDialog` |
| `lib/client.js:1795-1831` | `editActionDefinition`：匹配 `compaction/end` |
| `lib/client.js:1834-1909` | 服务 inject + 四个 slot 注册 |
| `lib/client.js:213-320` | 主题 token 与动作行 CSS；assistant 位置规则在 `285-314` |

### Shared

| 位置 | 内容 |
| --- | --- |
| `lib/shared.js:9-25` | 投影 key 与 idle wire view |
| `lib/shared.js:31-47` | 投影初始状态字段 |
| `lib/shared.js:63-106` | `refreshView`：wire view 形状与稳定引用 |
| `lib/shared.js:108-229` | `applyCompactionEditEvent`：事件折叠 |
| `lib/shared.js:316-356` | checkpoint / surface event / replace span 判定 |
| `lib/shared.js:389-414` | `hasOpenBoundary`：open turn / open compaction 检测 |

### 打包与测试

| 位置 | 内容 |
| --- | --- |
| `package.json:26-40` | `dsh.bundle.patch` 与 `dsh.client.inject` 包列表 |
| `cordis.patch.yml:3-5` | Loader 插入插件 |
| `test/client.test.mjs:177` | slot 名称、order、inject 契约 |
| `test/client.test.mjs:664` | 压缩卡 fork 参数（含 `increaseTitle`） |
| `test/shared.test.mjs:147-399` | 投影折叠、wire view、Remove |
| `test/transaction.test.mjs` | compaction 事务事件顺序、失败关闭 |
| `test/acceptance.test.mjs:135-366` | Host 操作、事件写入、surface 上下文、翻译不变性、错误码 |

## 已知脆弱点

- **assistant 动作位置**：`lib/client.js:285-314` 依赖官方 `data-clock="end"`、`:has()` 和 flex `order` 把图标放到官方分支之后、时间之前。官方 `MessageIconActions` 的顺序是 copy → extraActions → branch → endInfo；如果这个顺序或 `data-clock` 变了，图标可能落到时间之后。
- **slot order**：菜单 order `500`、assistant action order `1000` 都是相对官方 shipped 项的位置；官方新增更靠后的项后，“最后一个”不再成立。升级时用 `Slots.listSubTree` 看 occupants。
- **CSS 类名是构建哈希**：不要依赖官方 hashed 类名；插件只使用官方 `data-clock` 属性和自己的 `.dsh-bf-*` 类。若官方移除 `data-clock`，位置规则会静默失效。
- **事件字段是隐式契约**：折叠依赖 `compactionId`、`surfaceOp`、`source.kind`、`shadowedSeqs`、`seq`。字段缺失不会抛错，只会让投影保持旧状态；改事件时优先补 `test/shared.test.mjs`。
- **投影版本**：`wire.view` 字段或语义变化必须递增 `index.js:63` 的 `stateVersion`，并同步 `IDLE_VIEW`、`refreshView`、客户端读取字段和测试。
- **wire.view 扩展字段**：`replaceCount`、`spanCount`、`commandId`、`checkpointSeq` 目前没有客户端消费者，保留用于命令输出和调试；不要误以为 UI 依赖它们。
- **ChatNode 字段**：压缩卡用 `node.anchorSeq` 作为 fork 边界；官方若改名，压缩卡分叉会静默 no-op。位置在 `lib/client.js:1273`。
- **标题 +1**：`sessions.fork` 的 `increaseTitle` 依赖 session list 快照里已有源标题；如果调用时列表尚未就绪，子会话不会改名。菜单项走 `uiWorkspace.forkSession`，同样依赖这条路径。
- **服务 inject**：client 侧硬依赖 `slots`、`locale`、`sessions`、`uiWorkspace`、`uiConversation`、`remote`、`remote.commands`；官方 service 改名或移除时插件会直接不 apply。检查 `lib/client.js:1834-1842` 和 `package.json:33-38`。

## P1 / P2 收口状态

已做：

- **compaction 事务收口**：所有 `session.append` 序列集中到 `lib/compaction-transaction.js`；`applyEdit` 只准备事务数据并 flush。`test/transaction.test.mjs` 锁定事件顺序和失败关闭。
- **上下文固定用例**：`test/acceptance.test.mjs` 直接断言 `session.surface`：编辑保留官方 tail、Remove 移除 tail、后续编辑不复活 tail、翻译不追加 Session 事件。
- **翻译低/不思考模式**：`resolveTranslationEffort` 从 `ctx.llm.resolveModelInfo` 选择 off/low/minimal 等低档；没有低档时不传 `reasoningEffort`，编辑器显示「模型默认模式」，不强行使用第一档/高挡。响应回传实际模型和 `lowThinking` 标志。
- **插件元数据更新**：`package.json` 描述、`locale/*.json`、`icon.svg` 改为 start-here 语义。`private: true` 保留，避免误发 npm；准备发布时再移除。

评估后暂不做：

- **替换 750ms 轮询**：客户端没有稳定的 command-completion / projection 推送接口；改成自造 SSE 或 session binding 会增加生命周期和泄漏风险，暂留轮询。
- **替换 busy 事件扫描**：Host `Session` 没有 `running` 状态，`hasOpenBoundary` 的事件扫描仍是当前最小可靠路径。
- **改用官方 primitives**：client 半没有把 primitives 作为可 require 依赖；继续保留本地克隆，菜单样式按视觉契约维护。
- **替换自造 HTTP API**：官方 remote 没有对应的压缩编辑操作；保留端点并继续做 origin / body 校验。

## 兼容性记录

每次升级后追加一行，保留旧记录：

| 日期 | DSH 版本 | 结果 | 备注 |
| --- | --- | --- | --- |
| 2026-10-22 | `0.2.1-rc.2` | ✅ 46 passed | 当前基线 |

## 维护约定

- 保持官方控件和官方数据路径不变；新增能力优先使用官方 slot / command / Session 事件，不 shadow 官方按钮。
- 修改 fork、压缩、投影或 slot 行为时，同步更新本日志、兼容性表格和契约测试。
- 每次升级 DSH 后追加一条 `兼容性记录`，不要覆盖旧行。
- 提交前运行 `node --test`，并确保 `node --check` 通过。
