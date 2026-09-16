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