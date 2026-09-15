<script setup>
import { nextTick, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'
import UploadFile from '../components/uploadFile.vue'

marked.setOptions({
  gfm: true,
  breaks: true,
})

const renderMarkdown = (text) => marked.parse(String(text || ''))

const fileList = ref([])
const updateFileList = (list) => {
  fileList.value = list
}

const question = ref('')
const loading = ref(false)
/** @type {import('vue').Ref<Array<{ role: 'user' | 'assistant', content: string, citations?: any[] }>>} */
const messages = ref([])
const messagesRef = ref(null)

/** 滚动到消息区底部，保证流式生成内容始终可见 */
const scrollToBottom = async () => {
  await nextTick()
  const el = messagesRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

const copyAnswer = async (text) => {
  const content = String(text || '').trim()
  if (!content) {
    ElMessage.warning('暂无内容可复制')
    return
  }
  try {
    await navigator.clipboard.writeText(content)
    ElMessage.success('已复制回答')
  } catch {
    ElMessage.error('复制失败，请手动选择文本')
  }
}

/**
 * 读 SSE：后端按行推送 data: {...}
 */
async function readAskStream(questionText, onEvent) {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: questionText }),
  })

  if (!res.ok) {
    let message = '问答失败'
    try {
      const data = await res.json()
      message = data.message || message
    } catch {
      // ignore
    }
    throw new Error(message)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    // SSE 事件以空行分隔
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''

    for (const part of parts) {
      const line = part
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('data:'))
      if (!line) continue
      const json = line.replace(/^data:\s*/, '')
      onEvent(JSON.parse(json))
    }
  }
}

const sendMessage = async () => {
  const q = question.value.trim()
  if (!q) {
    ElMessage.warning('请输入问题')
    return
  }
  if (!fileList.value.length) {
    ElMessage.warning('请先上传文档')
    return
  }

  messages.value.push({ role: 'user', content: q })
  question.value = ''
  loading.value = true
  scrollToBottom()

  // 先插入空的助手气泡，后续边收边追加文字（必须改 messages 里的项，保证响应式）
  messages.value.push({ role: 'assistant', content: '', citations: [] })
  // 助手气泡的索引
  const assistantIndex = messages.value.length - 1
  scrollToBottom()

  try {
    await readAskStream(q, (event) => {
      const msg = messages.value[assistantIndex]
      if (event.type === 'citations') {
        msg.citations = event.citations || []
        scrollToBottom()
      } else if (event.type === 'delta') {
        msg.content += event.content || ''
        scrollToBottom()
      } else if (event.type === 'error') {
        throw new Error(event.message || '问答失败')
      }
    })
    scrollToBottom()
  } catch (err) {
    ElMessage.error(err.message || '问答失败')
    if (!messages.value[assistantIndex]?.content) {
      messages.value.pop()
    }
  } finally {
    loading.value = false
  }
}
</script>
<template>
  <div class="page">
    <div class="glow glow-a" />
    <div class="glow glow-b" />
    <div class="container">
      <header>
        <div class="brand">
          <span class="mark" />
          <h1>文档问答助手</h1>
        </div>
        <div class="kb-bar">
          <span class="file-list" :title="fileList.map(item => item.name).join('、') || '暂无'">
            {{ fileList.map(item => item.name).join('、') || '未导入文档' }}
          </span>
          <span class="status-chip" :class="{ on: fileList.length }">
            {{ fileList.length ? '已就绪' : '待导入' }}
          </span>
          <UploadFile @update:fileList="updateFileList" />
        </div>
      </header>

      <main>
        <div ref="messagesRef" class="messages">
          <div v-if="!messages.length" class="empty">
            上传手册后开始提问，答案将附带原文引用
          </div>
          <div
            v-for="(msg, idx) in messages"
            :key="idx"
            class="msg"
            :class="msg.role"
          >
            <div class="bubble-row">
              <div class="bubble" :class="{ streaming: msg.role === 'assistant' && loading && idx === messages.length - 1 && !msg.content }">
                <template v-if="msg.content">{{ msg.content }}</template>
                <span v-else-if="msg.role === 'assistant' && loading" class="thinking">
                  正在检索并生成
                  <i /><i /><i />
                </span>
              </div>
              <el-icon
                v-if="msg.role === 'assistant' && msg.content"
                class="copy-icon"
                title="复制回答"
                @click="copyAnswer(msg.content)"
              >
                <DocumentCopy />
              </el-icon>
            </div>
            <div v-if="msg.citations?.length" class="citations">
              <div class="citations-title">引用原文 Top 3</div>
              <div
                v-for="c in msg.citations"
                :key="c.chunkIndex"
                class="citation-item"
              >
                <span class="meta">#{{ c.chunkIndex }} · {{ c.score }}</span>
                <div class="md" v-html="renderMarkdown(c.text)" />
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer>
        <div class="chat-input">
          <el-input
            v-model="question"
            placeholder="向知识库提问…"
            type="textarea"
            :rows="3"
            :disabled="loading"
            @keydown.enter.exact.prevent="sendMessage"
          />
          <el-button class="send-btn" :loading="loading" @click="sendMessage">发送</el-button>
        </div>
      </footer>
    </div>
  </div>
</template>
<style scoped lang="less">
.page {
  min-height: 100vh;
  background:
    radial-gradient(900px 480px at 8% -8%, rgba(56, 160, 255, 0.16), transparent 55%),
    radial-gradient(700px 420px at 100% 0%, rgba(99, 180, 255, 0.12), transparent 50%),
    #eef3f9;
  position: relative;
  overflow: hidden;
}

.glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
  &.glow-a {
    width: 280px;
    height: 280px;
    left: 8%;
    top: 28%;
    background: rgba(80, 170, 255, 0.18);
  }
  &.glow-b {
    width: 240px;
    height: 240px;
    right: 6%;
    bottom: 8%;
    background: rgba(120, 140, 255, 0.14);
  }
}

.container {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  margin: 0 auto;
  gap: 10px;
  height: 100vh;
  width: min(880px, 92vw);
  padding: 14px 8px 16px;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;

    .mark {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #2b8cff;
      box-shadow: 0 0 0 5px rgba(43, 140, 255, 0.16);
    }

    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: #16324f;
    }
  }

  .kb-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 4px 4px 4px 12px;
    border-radius: 999px;
    border: 1px solid #d5e4f4;
    background: #fff;
  }

  .file-list {
    min-width: 0;
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: #5b7190;
  }

  .status-chip {
    flex-shrink: 0;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 999px;
    color: #6a7f99;
    border: 1px solid #d7e2ee;
    background: #f5f8fb;
    &.on {
      color: #1a8a5a;
      border-color: #b7ebc9;
      background: #edfaf3;
    }
  }
}

main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  .messages {
    flex: 1;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 8px 4px 12px;
    scrollbar-width: thin;
    scrollbar-color: #b7cbe0 transparent;

    .empty {
      margin: auto;
      color: #7a8ea6;
      font-size: 14px;
      letter-spacing: 0.04em;
    }

    .msg {
      display: flex;
      flex-direction: column;
      gap: 8px;
      animation: rise 0.28s ease;

      &.user {
        align-items: flex-end;
        .bubble {
          background: linear-gradient(135deg, #2b7fff, #3ab4ff);
          color: #fff;
          box-shadow: 0 8px 20px rgba(43, 127, 255, 0.22);
        }
      }

      &.assistant {
        align-items: flex-start;
        .bubble {
          background: #fff;
          color: #1b2a41;
          border: 1px solid #dce8f4;
          box-shadow: 0 8px 24px rgba(30, 64, 110, 0.08);
        }
      }

      .bubble-row {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        max-width: 86%;
      }

      .bubble {
        flex: 1;
        min-width: 0;
        padding: 14px 16px;
        border-radius: 16px;
        white-space: pre-wrap;
        line-height: 1.7;
        font-size: 15px;

        &.streaming {
          min-width: 160px;
        }
      }

      .thinking {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #6a829c;
        i {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #2b8cff;
          animation: pulse 1s infinite ease-in-out;
          &:nth-child(2) { animation-delay: 0.15s; }
          &:nth-child(3) { animation-delay: 0.3s; }
        }
      }

      .copy-icon {
        flex-shrink: 0;
        font-size: 16px;
        color: #8aa0b8;
        cursor: pointer;
        margin-bottom: 8px;
        transition: color 0.15s, transform 0.15s;
        &:hover {
          color: #2b8cff;
          transform: translateY(-1px);
        }
      }

      .citations {
        max-width: 86%;
        font-size: 13px;
        color: #5b7190;
        border-radius: 12px;
        padding: 10px 12px;
        background: #fff;
        border: 1px solid #dce8f4;

        .citations-title {
          font-weight: 600;
          margin-bottom: 8px;
          color: #3d5470;
          letter-spacing: 0.08em;
          font-size: 12px;
        }

        .citation-item {
          border-top: 1px solid #e6eef6;
          padding: 8px 0;

          .meta {
            color: #1f78e0;
            font-size: 12px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          }

          .md {
            margin-top: 6px;
            color: #4a607a;
            line-height: 1.65;
            word-break: break-word;

            :deep(h1), :deep(h2), :deep(h3), :deep(h4) {
              margin: 8px 0 6px;
              font-size: 14px;
              color: #1b2a41;
            }
            :deep(p) { margin: 0 0 6px; }
            :deep(ul), :deep(ol) { margin: 0 0 6px; padding-left: 1.2em; }
            :deep(code) {
              padding: 1px 5px;
              border-radius: 4px;
              background: #eef4fb;
              font-size: 12px;
            }
            :deep(pre) {
              margin: 6px 0;
              padding: 8px 10px;
              border-radius: 8px;
              background: #eef4fb;
              overflow: auto;
              code { padding: 0; background: none; }
            }
            :deep(a) { color: #1f78e0; }
            :deep(blockquote) {
              margin: 6px 0;
              padding-left: 10px;
              border-left: 3px solid #b7d8f8;
              color: #5b7190;
            }
          }
        }
      }
    }
  }
}

footer {
  .chat-input {
    display: flex;
    gap: 12px;
    align-items: stretch;
    border: 1px solid #d5e4f4;
    padding: 10px 12px;
    border-radius: 16px;
    background: #fff;
    box-shadow: 0 10px 28px rgba(30, 64, 110, 0.08);

    :deep(.el-textarea__inner) {
      box-shadow: none;
      border: none;
      resize: none;
      background: transparent;
      color: #1b2a41;
      padding: 6px 4px;
    }
    :deep(.el-textarea__inner:hover),
    :deep(.el-textarea__inner:focus) {
      box-shadow: none;
      border: none;
    }
    :deep(.el-textarea__inner::placeholder) {
      color: #8aa0b8;
    }

    .send-btn {
      align-self: flex-end;
      height: 40px;
      padding: 0 20px;
      border: none;
      border-radius: 12px;
      color: #fff;
      font-weight: 700;
      background: linear-gradient(135deg, #2b7fff, #3ab4ff);
      &:hover, &:focus {
        color: #fff;
        background: linear-gradient(135deg, #1f6feb, #2aa3ef);
      }
    }
  }
}

@keyframes rise {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

@keyframes pulse {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}
</style>
