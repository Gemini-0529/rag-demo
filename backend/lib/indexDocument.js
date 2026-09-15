/**
 * 上传后的建索引入口，串起整条流水线：
 * 读盘文本 → 切片 → Embedding → 写入内存向量库
 *
 * 这就是 RAG 里「Retrieval 之前」要先准备好的索引。
 */
import fs from 'fs'
import { splitText } from './chunk.js'
import { embedMany } from './embed.js'
import { clearChunks, addChunks, getChunkCount } from './store.js'

/**
 * @param {{ filePath: string, source: string }} opts
 * @param {string} opts.filePath 磁盘上的文件绝对/相对路径
 * @param {string} opts.source   原始文件名（引用展示用）
 * @returns {Promise<{ chunkCount: number }>}
 */
export async function indexDocument({ filePath, source }) {
  // 1) 读出全文（当前 MVP 只做 txt / md）
  const text = fs.readFileSync(filePath, 'utf-8')

  // 2) 切片
  const pieces = splitText(text)
  if (!pieces.length) {
    clearChunks()
    return { chunkCount: 0 }
  }

  // 3) 每段做 Embedding（文档侧向量化）
  const embeddings = await embedMany(pieces)

  // 4) MVP：新文档覆盖旧索引（不做多文档管理）
  clearChunks()

  const records = pieces.map((piece, i) => ({
    id: `${Date.now()}-${i}`,
    text: piece,
    embedding: embeddings[i],
    source,
    chunkIndex: i,
  }))

  addChunks(records)

  console.log(`建索引完成：${source}，共 ${getChunkCount()} 段`)
  return { chunkCount: getChunkCount() }
}
