/**
 * 把整篇文档切成小段，方便后续做 Embedding + 检索。
 *
 * 为什么要切片？
 * - Embedding 模型对单次输入长度有限制
 * - 检索时希望命中「相关的一小段」，而不是整篇手册
 *
 * 策略（尽量简单，同时兼容有/无空行）：
 * 1. 先按空行拆成段落（排版规范的文章）
 * 2. 若几乎没切开（全文没有空行），再按单个换行拆
 * 3. 单个片段若仍太长，再按固定长度切开，并带少量重叠，
 *    避免一句话被拦腰截断后丢失上下文
 */

/** 每段最多约多少字符（中文按字符计即可） */
const MAX_CHUNK_SIZE = 500

/** 长段切开时的重叠长度 */
const OVERLAP = 50

/**
 * 把文本先拆成「段落级」片段：优先空行，否则单行换行
 * @param {string} normalized
 * @returns {string[]}
 */
function splitIntoParts(normalized) {
  // 1) 先按空行拆（两个换行之间可以夹空白）
  let parts = normalized
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

  // 2) 没空行时，整篇往往只有 1 段 → 再按单个换行拆，兼容普通 TXT
  if (parts.length <= 1) {
    parts = normalized
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)
  }

  return parts
}

/**
 * 过长片段按固定长度滑窗切开，带 overlap
 * @param {string} text
 * @param {string[]} chunks 结果数组（就地 push）
 */
function pushBySlidingWindow(text, chunks) {
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + MAX_CHUNK_SIZE, text.length)
    chunks.push(text.slice(start, end))
    if (end >= text.length) break
    // 下一步起点往回叠一点，保留衔接上下文
    start = end - OVERLAP
  }
}

/**
 * @param {string} text 全文
 * @returns {string[]} 切片后的文本数组
 */
export function splitText(text) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .trim()

  if (!normalized) return []

  const parts = splitIntoParts(normalized)
  const chunks = []

  for (const part of parts) {
    // 单段长度小于最大长度：直接添加到结果数组
    if (part.length <= MAX_CHUNK_SIZE) {
      chunks.push(part)
      continue
    }
    // 3) 单段仍然过长：滑窗切开
    pushBySlidingWindow(part, chunks)
  }

  return chunks
}
