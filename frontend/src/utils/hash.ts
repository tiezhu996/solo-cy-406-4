/**
 * 同步、确定性的 FNV-1a 32 位哈希，返回 8 位十六进制字符串。
 * 用于条款内容比对与发布快照校验，无需 crypto.subtle 的异步开销。
 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // hash * 16777619 (FNV prime)，用无符号 32 位运算避免溢出
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 归一化：折叠空白，避免排版差异被误判为内容变更 */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
