## 个人文档问答助手

### 流程

1. 上传一份 MD/TXT，落盘
2. 后端切片 → Embedding → 存数组
3. 用户提问 → 后端把问题 Embedding
4. 检索最相关的 3 段内容（余弦相似度）
5. 组装 Prompt 调用大模型
6. 前端流式展示回答，并显示引用片段

### MVP
minimum viable product (最小可行产品)

### 多轮对话
按你现在的代码结构，可以分 **5 步**做。先打通「能追问」，再补交互和持久化。

---

## 第 0 步：先定接口约定

建议 `/ask` 的 body 改成：

```json
{
  "question": "那第二条呢",
  "history": [
    { "role": "user", "content": "文档里说了什么" },
    { "role": "assistant", "content": "文档一共写了三点……" }
  ],
  "stream": true
}
```

约定：

- `history`：不含本轮 `question`，也不含 system
- 前端 UI 的 `messages` 可以继续自己维护；发给后端时再裁成 `history`
- 引用片段（citations）仍只对应当前这一轮检索结果

---

## 第 1 步：后端接上历史（核心，先做这个）

改 `backend/lib/ask.js` 的 `prepareAsk`。

**目标：** 模型调用时变成：

```
system
[可选：历史 user/assistant…]
user（参考片段 + 当前问题）
```

伪代码思路：

```js
async function prepareAsk(question, history = []) {
  const q = validateQuestion(question)

  // 1) 先得到用于检索的 query（第 2 步会增强；现在可先用 q）
  const searchQuery = q
  const queryEmbedding = await embedOne(searchQuery)
  const hits = searchTopK(queryEmbedding, TOP_K)

  // 2) 拼 context / systemPrompt（和现在一样）

  // 3) 清洗 history：只保留 user/assistant，去掉空 content，限制轮数
  const cleanHistory = (history || [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({ role: m.role, content: String(m.content || '').trim() }))
    .filter(m => m.content)
    .slice(-8) // 滑动窗口：最近 4 轮（8 条）

  const messages = [
    { role: 'system', content: systemPrompt },
    ...cleanHistory,
    { role: 'user', content: userPrompt }, // 仍是「参考片段 + 当前问题」
  ]

  return { messages, citations }
}
```

同时改：

- `askQuestion(question, history)`
- `askQuestionStream(question, handlers, history)` 或把 history 放进第二个参数对象
- `backend/index.js`：从 `req.body` 取出 `history`，传下去

**这一步做完：** 连续追问时模型能「记得」上文。  
但「那第二条呢」的 **检索** 可能仍不准 —— 进第 2 步。

---

## 第 2 步：追问检索增强（验收过不过的关键）

追问句很短，单独 Embedding 容易检偏。推荐两种，选一种即可。

### 方案 A：拼接检索（实现最快）

```js
const lastUser = [...cleanHistory].reverse().find(m => m.role === 'user')
const searchQuery = lastUser
  ? `${lastUser.content}\n${q}`
  : q
```

适合 MVP，5 分钟能写完。

### 方案 B：查询改写（效果更好，推荐）

在 Embedding 前多调一次聊天模型：

```text
根据对话历史，把用户最新问题改写成独立、完整、可检索的问题。
只输出改写后的问题，不要解释。
```

把改写结果拿去 `embedOne`。  
首轮（history 为空）可跳过改写，直接用原问题。

**建议：** 先上方案 A 跑通验收；有余力再换成 B。

---

## 第 3 步：前端请求带上 history

改 `chat.vue` 里的 `readAskStream` / `sendMessage`。

发送前：

1. 把当前问题 push 进 `messages`（你已经在做）
2. 取「不含本轮、也不含刚插入的空 assistant」的历史：

```js
// 发送前 messages 已有本轮 user，还没有 assistant（或已有空 assistant）
const history = messages.value
  .filter(m => m.content)           // 去掉空的 streaming 气泡
  .slice(0, -1)                     // 去掉本轮刚 push 的 user
  .map(({ role, content }) => ({ role, content }))
```

3. body 改成：

```js
JSON.stringify({ question: q, history })
```

其余 SSE 解析逻辑不用动。

**验证：**  
问「文档里说了什么」→ 再问「那第二条呢」→ 回答应能对上第一条的上下文。

---

## 第 4 步：重新生成 / 编辑上一条

都是「截断数组 + 重发」，不需要新接口。

### 重新生成

针对最后一条 assistant：

1. `messages.pop()` 去掉助手回复  
2. 取出最后一条 user 的 content 作为 `question`  
3. 再 push 空 assistant，走同一套 `readAskStream`  
4. `history` = 去掉这对问答之后的部分

### 编辑上一条用户消息

1. 找到要编辑的 user 下标 `i`  
2. `messages = messages.slice(0, i)`  
3. 用新文本作为 `question`，再走 `sendMessage` 流程

UI 上：助手气泡旁加「重新生成」；用户气泡旁加「编辑」。

---

## 第 5 步：新建对话 + 历史列表

先不要上数据库，用 `localStorage` 就够。

### 数据结构

```js
{
  id: 'uuid',
  title: '新对话',           // 可用首条用户问题截断
  updatedAt: 1710000000000,
  messages: [ /* 同页面 messages */ ]
}
```

### 行为

| 操作 | 做法 |
|------|------|
| 新建对话 | 若当前会话有内容先 save；清空 `messages`；生成新 `id` |
| 自动保存 | 每轮 `done` 后把当前会话写回列表 |
| 历史列表 | 侧边栏按 `updatedAt` 倒序 |
| 切换会话 | 读出对应 `messages` 赋给页面 |
| 重命名 | 改 `title` 写回 |
| 删除 | 从数组移除；若删的是当前会话则新建空会话 |

侧边栏布局可以后做；逻辑上就是一个 `conversations[]` + `currentId`。

---

## 第 6 步（可选）：Token / 摘要

5 轮验收用滑动窗口（第 1 步的 `slice(-8)`）足够。

以后对话很长再加：

1. 估算：`history` 字符数或粗算 `length / 2` ≈ token  
2. 超阈值：保留最近 2 轮原文  
3. 更早内容调一次模型做「对话摘要」，放进 system 或单独一条 system/user  

MVP 可跳过。

---

## 推荐落地顺序（按天）

1. **Day 1 上午：** 第 1 + 3 步（带 history）—— 立刻能追问  
2. **Day 1 下午：** 第 2 步方案 A + 第 4 步（重生成/编辑）  
3. **Day 2：** 第 5 步（新建 + localStorage 历史列表）  
4. **有空再做：** 查询改写、摘要、后端落库  

---

## 验收自测清单

1. 连续 5 轮追问（含「那第二条」「再说详细点」），回答不丢上下文  
2. 新建对话后，旧上下文不再影响新问答  
3. 重新生成：只换最后一条助手回复，前面不变  
4. 编辑第 2 条用户消息：后面轮次被砍掉并重答  
5. 刷新页面：localStorage 能恢复历史列表和内容  

---

## 一个容易踩的坑

**不要把「带参考片段的整段 userPrompt」写进 history 再回传。**  
前端 history 只存干净的问答文本；参考片段只在当前轮由后端临时拼进最后一条 user。否则 token 暴涨，而且旧片段会误导模型。

---

如果你切换到 **Agent 模式**，我可以按这个顺序直接改 `ask.js`、`index.js` 和 `chat.vue`，先把第 1–3 步打通。

## concurrently
> 运行多个命令的包
frontEnd   dev
backEnd    server
```bash
{
  "scripts": {
    "dev:frontend": "npm run dev --prefix frontend",
    "dev:backend": "npm run server --prefix backend",
    "all": "concurrently -n web,api -c cyan,magenta \"npm run dev:frontend\" \"npm run dev:backend\""
  },
  "devDependencies": {
    "concurrently": "^10.0.5"
  }
}
```
--prefix frontend = 在 frontend 目录跑 npm run dev
后端对应你现有的 npm run server
-n web,api: 只是给日志加前缀，可去掉
-c cyan,magenta: 上色，前端cyan，后端magenta