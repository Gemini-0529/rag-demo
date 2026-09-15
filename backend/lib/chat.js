/**
 * 聊天模型客户端（DeepSeek 等 OpenAI 兼容接口）
 * 与 Embedding（硅基流动）配置分离，后续 /ask 会用到。
 */
import OpenAI from 'openai'
import 'dotenv/config' // 把 .env 文件中的环境变量加载到 process.env 中

export const chatClient = new OpenAI({
  apiKey: process.env.CHAT_API_KEY,
  baseURL: process.env.BASE_URL,
})

export const CHAT_MODEL = process.env.CHAT_MODEL
