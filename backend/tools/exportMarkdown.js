import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * 导出 Markdown 文件的工具
 * @param {{ content: string, filename?: string }} data
 * @returns {{ success: boolean, message: string, filename: string, url: string }}
 */
// 拿到当前 index.js 所在目录（ESM 没有 __dirname，需要自己算）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 与 index.js 一致：落在 backend/exports（本文件在 backend/tools/）
export const exportsDir = path.join(__dirname, "../exports");

fs.mkdirSync(exportsDir, { recursive: true });

function sanitizeFilename(name) {
  let base = String(name || "export").trim() || "export";
  // 去掉路径穿越与目录分隔符
  base = base.replace(/[/\\]/g, "").replace(/\.\./g, "");
  // 空格 → 下划线；去掉其它不安全字符
  base = base.replace(/\s+/g, "_").replace(/[^\w.\u4e00-\u9fff-]/g, "");
  if (!base) base = "export";
  // 避免变成 xxx.md.md
  if (!base.toLowerCase().endsWith(".md")) base += ".md";
  return base;
}

export default function exportMarkdown(data = {}) {
  const content = String(data.content ?? "").trim();
  if (!content) {
    throw new Error("content is required");
  }

  const safeName = sanitizeFilename(data.filename);
  const savedAs = `${Date.now()}-${safeName}`;
  const filePath = path.join(exportsDir, savedAs);

  fs.writeFileSync(filePath, content, "utf8");

  return {
    success: true,
    message: "file exported successfully",
    filename: savedAs,
    url: `/downloads/${savedAs}`,
  };
}
