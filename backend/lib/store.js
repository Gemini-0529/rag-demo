/**
 * 第一版向量库：进程内数组。
 * 服务重启后索引会清空，MVP 可接受；不做 Chroma / 数据库。
 *
 * 每条大致结构：
 * { id, text, embedding, source, chunkIndex }
 */

/** @type {Array<{id:string,text:string,embedding:number[],source:string,chunkIndex:number}>} */
let chunks = []

/** 清空索引（新文档上传时，MVP 只保留当前这一份文档） */
export function clearChunks() {
  chunks = []
}

/**
 * 追加多条切片记录
 * @param {typeof chunks} list
 */
export function addChunks(list) {
  chunks.push(...list)
}

/** 当前已索引的片段数量 */
export function getChunkCount() {
  return chunks.length
}

/** 取出全部（调试 / status 接口用） */
export function getAllChunks() {
  return chunks
}

/**
 * 余弦相似度：看两个向量「方向」有多像（夹角的余弦）。
 *
 * 公式：cosθ = (a · b) / (|a| × |b|)
 *   - a · b  ：点积 = 对应位相乘再相加
 *   - |a|    ：a 的长度 = √(各分量平方和)
 *   - 结果范围大约在 -1 ~ 1：越接近 1 越相似，接近 0 不太相关，接近 -1 方向相反
 *
 * 和「欧氏距离」的区别（笔记里那种）：
 *   - 欧氏：√((a1-b1)²+(a2-b2)²+…) → 越小越近
 *   - 余弦：比方向，不那么在乎向量长短 → 越接近 1 越像
 *
 * 小例子（三维示意，真实 Embedding 往往是成百上千维）：
 *   猫   = [0.5, 0.8, 0.2]
 *   狗   = [0.6, 0.7, 0.3]
 *   汽车 = [0.1, -0.4, 0.9]
 *
 *   点积(猫,狗) = 0.5*0.6 + 0.8*0.7 + 0.2*0.3 = 0.30 + 0.56 + 0.06 = 0.92
 *   |猫| ≈ √(0.25+0.64+0.04) = √0.93 ≈ 0.964
 *   |狗| ≈ √(0.36+0.49+0.09) = √0.94 ≈ 0.970
 *   cos(猫,狗) ≈ 0.92 / (0.964*0.970) ≈ 0.98   ← 很高，语义近
 *
 *   cos(猫,汽车) 会小很多                     ← 语义远
 *
 * 检索时：问题向量和每个 chunk 的 embedding 算一次 cos，分数高的排前面取 TopK。
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function cosineSimilarity(a, b) {
  let dot = 0 // 点积 a·b 对应位相乘，再全部加起来
  let na = 0  // 累加 a 的平方和，后面开方得到 |a|
  let nb = 0  // 累加 b 的平方和，后面开方得到 |b|
  const len = Math.min(a.length, b.length)

  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i] // 对应位相乘再累加 → 点积
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }

  // |a| × |b|；若有一方是零向量，无法算夹角，直接当不相似
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  if (!denom) return 0

  return dot / denom // cosθ
}

/**
 * 用「问题向量」在内存库里找最相关的 TopK 片段
 * （后续 /ask 接口会用到）
 * @param {number[]} queryEmbedding
 * @param {number} [topK=3]
 */
export function searchTopK(queryEmbedding, topK = 3) {
  const scored = chunks.map((c) => ({
    text: c.text,
    source: c.source,
    chunkIndex: c.chunkIndex,
    score: cosineSimilarity(queryEmbedding, c.embedding),
  }))
// 按照分数从高到低排序
  scored.sort((a, b) => b.score - a.score)
  // 取前 topK 个
  return scored.slice(0, topK)
}
