/**
 * RAG 问答：问题 Embedding → 检索 TopK → 拼 Prompt → 调聊天模型
 *
 * 支持一次性返回，也支持 stream: true 逐 token 流出。
 */
import { embedOne } from './embed.js'
import { getChunkCount, searchTopK } from './store.js'
import { chatClient, CHAT_MODEL } from './chat.js'

const TOP_K = 3

function validateQuestion(question) {
  const q = String(question || '').trim()
  if (!q) {
    const err = new Error('问题不能为空')
    err.status = 400
    throw err
  }
  if (getChunkCount() === 0) {
    const err = new Error('尚未上传文档或索引为空，请先上传')
    err.status = 400
    throw err
  }
  return q
}

/**
 * 检索 + 组装 messages / citations（流式与非流式共用）
 */
async function prepareAsk(question, history) {
  const q = validateQuestion(question)

  // 1) 问题向量化
  const queryEmbedding = await embedOne(q)

  // 2) TopK 检索
  const hits = searchTopK(queryEmbedding, TOP_K)

  // 3) 组装 Prompt（RAG 的核心：把检索到的原文塞进对话，再交给大模型）
  //    把 TopK 片段拼成一段可读的「参考材料」，带上序号和相关度，方便模型对照
  const context = hits
    .map((h, i) => `【片段 ${i + 1} | chunkIndex=${h.chunkIndex} | 相关度=${h.score.toFixed(4)}】\n${h.text}`)
    .join('\n\n')

  // 系统提示词：规定角色 + 回答规则（尤其是「文档没有就说未提及」，减少幻觉）
  const systemPrompt = [
    '你是个人文档问答助手。',
    '请仅根据下面「参考片段」回答用户问题。',
    '如果参考片段中没有足够信息，请明确回答「文档中未提及」，不要编造。',
    '回答简洁、直接，可适当引用片段中的原文表述。',
  ].join('')

  // 用户消息：参考片段 + 真正的问题（模型主要据此作答）
  const userPrompt = [
    '参考片段：',
    context,
    '',
    `用户问题：${q}`,
  ].join('\n')

  // 清洗history
  const cleanHistory = (history || [])
    .map((m) => ({role: m.role, content: m.content.trim()})) // 去掉回答的 citations 数据
    .filter((m) => m.content)
    .slice(-8) // 滑动窗口：最近 4 轮（8 条）

  // OpenAI 兼容接口的 messages 格式：system 定规矩，user 给材料与问题
  const messages = [
    { role: 'system', content: systemPrompt },
    ...cleanHistory,
    { role: 'user', content: userPrompt },
  ]

  // 引用列表给前端展示用（和塞进 Prompt 的是同一批 hits，但不含 embedding）
  const citations = hits.map((h) => ({
    text: h.text,
    score: Number(h.score.toFixed(4)),
    chunkIndex: h.chunkIndex,
  }))

  return { messages, citations }
}

/**
 * 非流式：等模型整段生成完再返回
 */
export async function askQuestion(question, history) {
  const { messages, citations } = await prepareAsk(question, history)

  const completion = await chatClient.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    // 控制生成内容的随机性,0.2表示随机性较低，0.8表示随机性较高。
    // 随机性较低的回答更确定，随机性较高的回答更随机。
    temperature: 0.2, 
  })

  const answer = completion.choices?.[0]?.message?.content?.trim() || ''
  return { answer, citations }
}

/**
 * 流式：先给出 citations，再通过 onDelta 逐段推送文本
 * @param {string} question
 * @param {{ onCitations: Function, onDelta: Function }} handlers
 */
export async function askQuestionStream(question, { onCitations, onDelta, history=[] }) {
  const { messages, citations } = await prepareAsk(question, history)

  // 检索完成后立刻把引用发给前端（回答还在生成中）
  onCitations?.(citations)

  const stream = await chatClient.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    temperature: 0.2,
    stream: true, // 关键：让模型边生成边返回
  })

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content
    if (delta) {
      // 把生成的内容逐段返回给前端
      // onDelta 是前端传入的回调函数，用于处理生成的内容
      onDelta?.(delta)
    }
  }
}
