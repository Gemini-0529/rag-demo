/**
 * 调用 OpenAI 兼容的 Embeddings 接口，把文本变成向量（一串数字）。
 *
 * 学习要点：
 * - 文档片段要向量化，用户问题也要向量化
 * - 两边用同一个 EMBED_MODEL，才能用余弦相似度比较「语义是否接近」
 * - Chat（DeepSeek）和 Embed（硅基流动）可以是两套 Key / Base URL
 * - API Key 只放后端环境变量，前端绝不直连模型
 */
import OpenAI from 'openai'
import 'dotenv/config'

// Embedding 走硅基流动（或其它兼容服务），与聊天模型配置分开
const embedClient = new OpenAI({
  apiKey: process.env.EMBED_API_KEY,
  baseURL: process.env.EMBED_BASE_URL,
})

const EMBED_MODEL = process.env.EMBED_MODEL

/**
 * 单条文本 → 向量
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedOne(text) {
  const res = await embedClient.embeddings.create({
    model: EMBED_MODEL,
    input: text,
  })
  return res.data[0].embedding
}

/**
 * 多条文本批量向量化（上传建索引时用）
 * 若服务商不支持一次传数组，自动降级为逐条请求。
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
export async function embedMany(texts) {
  if (!texts.length) return []

  try {
    const res = await embedClient.embeddings.create({
      model: EMBED_MODEL,
      input: texts,
    })
    // 按 index 排序，保证与 texts 一一对应
    return res.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding)
  } catch (err) {
    console.warn('批量 embedding 失败，改为逐条请求：', err.message)
    const vectors = []
    for (const t of texts) {
      vectors.push(await embedOne(t))
    }
    return vectors
  }
}
