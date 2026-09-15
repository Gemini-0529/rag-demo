import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { indexDocument } from './lib/indexDocument.js'
import { getChunkCount } from './lib/store.js'
import { askQuestion, askQuestionStream } from './lib/ask.js'

// 拿到当前 index.js 所在目录（ESM 没有 __dirname，需要自己算）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 上传文件最终落盘目录，例如 backend/files
const filesDir = path.join(__dirname, 'files')

// recursive: true → 目录已存在不报错；不存在则逐级创建
fs.mkdirSync(filesDir, { recursive: true })

/**
 * multer.diskStorage：告诉 multer「不要放内存，写到磁盘」
 * - destination：文件存到哪个文件夹
 * - filename：存盘时叫什么名字
 * 回调 cb(错误, 结果)：第一个参数 null 表示成功
 */
const storage = multer.diskStorage({
  // 每次上传都会调用；这里固定写到 filesDir
  destination: (_req, _file, cb) => {
    cb(null, filesDir)
  },
  // 自定义文件名：时间戳 + 原名，避免同名覆盖
  filename: (_req, file, cb) => {
    // multipart 里中文文件名常被当成 latin1，转回 utf8 才不会乱码
    const safeName = Buffer.from(file.originalname, 'latin1').toString('utf8')
    cb(null, `${Date.now()}-${safeName}`)
  },
})

/**
 * 用上面的 storage 创建 multer 实例
 * 后面路由里 upload.single('file') 才会真正解析 multipart 表单
 * （'file' 要和前端 el-upload 的字段名一致）
 */
const upload = multer({ storage })

const app = express()
app.use(express.json())

app.listen(8889, () => {
  console.log('Server 启动成功：8889')
})


/** 可选：前端轮询是否已有索引、有多少段 */
app.get('/status', (_req, res) => {
  res.json({
    code: 200,
    hasDocument: getChunkCount() > 0,
    chunkCount: getChunkCount(),
  })
})

/**
 * 上传文件 → 落盘 → 切片 → Embedding → 写入内存向量库
 * 中间件 upload.single('file') 负责解析 multipart（字段名与 el-upload 默认一致）
 */
app.post('/uploadFile', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '未收到文件' })
    }

    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8')

    const { chunkCount } = await indexDocument({
      filePath: req.file.path,
      source: originalName,
    })

    res.json({
      code: 200,
      filename: originalName,
      savedAs: req.file.filename,
      chunkCount,
      message: '上传成功',
    })
  } catch (err) {
    console.error('建索引失败：', err)
    res.status(500).json({
      code: 500,
      message: err.message || '建索引失败',
    })
  }
})

/**
 * 提问：默认 SSE 流式输出（边生成边推）
 * 事件格式（每行 data: JSON）：
 *   { type: 'citations', citations }
 *   { type: 'delta', content }
 *   { type: 'done' }
 *   { type: 'error', message }
 *
 * body 传 { question, stream: false } 可退回原来的一次性 JSON
 */
app.post('/ask', async (req, res) => {
  try {
    const { question, stream = true } = req.body || {}

    // 非流式：兼容旧用法
    if (stream === false) {
      const { answer, citations } = await askQuestion(question)
      return res.json({ code: 200, answer, citations })
    }

    // SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const send = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    await askQuestionStream(question, {
      // 把引用发给前端
      // onCitations 是前端传入的回调函数，用于处理引用
      onCitations: (citations) => send({ type: 'citations', citations }),
      // 把生成的内容逐段返回给前端
      // onDelta 是前端传入的回调函数，用于处理生成的内容
      onDelta: (content) => send({ type: 'delta', content }),
    })

    send({ type: 'done' })
    res.end()
  } catch (err) {
    console.error('问答失败：', err)
    // 若还没开始 SSE，按普通 JSON 错误返回
    if (!res.headersSent) {
      const status = err.status || 500
      return res.status(status).json({
        code: status,
        message: err.message || '问答失败',
      })
    }
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message || '问答失败' })}\n\n`)
    res.end()
  }
})
