# Virtual Pet Agent

一个使用 TypeScript 从零构建的虚拟宠物 Agent 学习项目。

项目会从确定性的宠物状态和动作开始，逐步加入 AI 对话、工具调用、Agent Loop、记忆、主动行为和界面。核心原则是：模型负责理解和决策，TypeScript 业务代码负责校验和执行。

## 学习路线

详细的执行步骤见：[TypeScript Agent 学习路线](doc/agent-learning-roadmap.md)

| 阶段 | 目标 |
| --- | --- |
| M0 | 初始化 TypeScript 项目 |
| M1 | 实现宠物状态和基础动作 |
| M2 | 加入状态持久化 |
| M3 | 加入 AI 对话 |
| M4 | 加入工具调用 |
| M5 | 实现 Agent Loop |
| M6 | 加入短期和长期记忆 |
| M7 | 加入定时事件和主动行为 |
| M8 | 完成界面、评测和可靠性建设 |

## 技术栈

- Node.js 20+
- TypeScript
- Zod
- Jest + ts-jest
- 第一阶段使用内存和 JSON，后续迁移 SQLite
- 后续按需要加入 React + Vite

## 当前进度

- [x] M0：项目初始化
- [x] M1：宠物核心
- [x] M2：持久化
- [x] M3：AI 对话
- [x] M4：工具调用
- [x] M5：Agent Loop
- [x] M6：记忆
- [x] M7：主动行为
- [ ] M8：界面与可靠性

## 开始方式

项目已经完成 M0 到 M7。现在可以按照文档进入 M8，实现界面、评测和可靠性建设。

如果需要重新初始化环境，M0 使用以下命令：

```bash
npm init -y
npm install zod
npm install -D typescript tsx jest ts-jest @types/node @types/jest
npx tsc --init
npx ts-jest config:init
```

初始化完成后，逐阶段执行文档中的任务，并在每个阶段运行：

```bash
npm run build
npm test
```

CLI 可以通过以下命令启动：

```bash
npm run dev
```

当前支持查看状态、喂食、玩耍、睡觉和抚摸。宠物状态和动作事件会保存到 `data/pet-store.json`，程序重启后可以继续使用之前的宠物。

M3 增加了聊天选项，默认使用 DeepSeek。先复制本地配置文件：

```bash
cp config/llm.example.json config/llm.local.json
# 编辑 config/llm.local.json，填入真实 API Key
npm run dev
```

底层使用的是通用 OpenAI-compatible 客户端。后续切换其他兼容服务时，只需要修改 `config/llm.local.json` 中的 `apiKey`、`baseUrl` 和 `model`，不需要修改 Agent 代码。`config/llm.local.json` 已被 `.gitignore` 忽略，Git 中只保留 [config/llm.example.json](config/llm.example.json)。没有配置本地文件时，聊天功能会返回降级提示，不会影响其他宠物动作。

选择 `6 进入聊天` 后会进入连续聊天模式，不需要重复选择 `6`。Agent 现在可以根据对话选择宠物工具。输入 `/exit` 或 `/quit` 可以返回主菜单。

M5 已将工具调用升级为受控 Agent Loop：模型执行工具后会收到工具结果，再决定是否继续调用工具或生成最终回复。单次用户请求最多循环 3 步，工具事件会全部保存；超过步数、模型输出非法或工具执行失败时会返回降级提示，不会伪造成功结果。

M6 增加了短期和长期记忆：当前会话最多保留最近 10 条消息，用户明确说出“我的名字是…”“我喜欢…”或“记住…”时会保存为长期记忆，并在后续相关问题中召回。长期记忆保存在 `data/memory-store.json`，该文件属于本地运行数据，不会提交到 Git。开发模式会打印实际记忆文件路径；首次进入聊天时即使还没有提取到长期记忆，也会创建空的记忆文件。

询问“你还记得我的名字吗”会检索姓名记忆；询问“你还记得我吗”“你认识我吗”这类泛回忆问题时，会召回高重要度记忆。开发模式还会输出记忆的保存结果和本轮召回结果，便于确认重启后是否读取到了同一份数据。

M7 增加了主动行为：默认每 60 秒检查一次规则，饥饿度达到 80、精力降到 20 或长时间没有互动时，宠物会主动提醒。提醒记录保存在 `data/proactive-store.json`，因此短时间内不会重复提醒，程序重启后也能恢复冷却状态。规则负责决定“什么时候提醒”，LLM 只负责生成宠物口吻；没有可用模型时会自动使用确定性的降级文案。可以用 `VIRTUAL_PET_PROACTIVE_INTERVAL_MS=10000 npm run dev` 将检查间隔改为 10 秒，方便手动观察。

开发模式 `npm run dev` 会打印调试日志，包括：

```text
[dev][llm]   模型返回
[dev][agent] 模型请求的工具调用
[dev][tool]  工具执行结果
[dev][proactive] 主动行为规则和提醒日志
```

日志不会输出 API Key。使用 `npm start` 启动时默认关闭这些调试日志。

## 目录说明

```text
src/       应用源码
tests/     自动化测试
doc/       学习路线和执行文档
data/      本地运行数据，不提交到 Git
```
