import { Clause } from '../types/clause';
import { ClauseCategory } from '../types/enums';
import { FrozenClauseRef, IssueLevel, PublicationIssue, TemplatePublication } from '../types/publication';
import { Template, TemplateVariable } from '../types/template';
import { htmlToPlainText } from './diff';
import { hashString, normalizeText } from './hash';

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_一-龥]+)\s*\}\}/g;

export type PublicationSource = Pick<Template, 'title' | 'category' | 'contentHtml' | 'variables'>;

/** 基于纯文本归一化后的哈希，用于判断条款内容是否被修改 */
export function hashHtml(html: string): string {
  return hashString(normalizeText(htmlToPlainText(html)));
}

/** 构造带标记的条款引用块：条款全文内嵌在正文中，同时保留引用与插入时刻哈希 */
export function buildClauseRefHtml(clause: Clause): string {
  const contentHash = hashHtml(clause.contentHtml);
  return `<section class="clause-ref" data-clause-ref="${clause.id}" data-clause-hash="${contentHash}">${clause.contentHtml}</section>`;
}

export interface ExtractedClauseRef {
  clauseId: string;
  insertedHash: string;
  innerHtml: string;
}

/** 解析正文中的全部条款引用块（保留出现顺序） */
export function extractClauseRefs(html: string): ExtractedClauseRef[] {
  if (typeof DOMParser === 'undefined') {
    return [];
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('section[data-clause-ref]')).map((node) => ({
    clauseId: node.getAttribute('data-clause-ref') ?? '',
    insertedHash: node.getAttribute('data-clause-hash') ?? '',
    innerHtml: node.innerHTML
  }));
}

/** 提取正文（含条款全文）中出现的全部占位符名，去重并保留首次出现顺序 */
export function extractPlaceholders(html: string): string[] {
  const names: string[] = [];
  for (const match of html.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

export function hasBlockingIssues(issues: PublicationIssue[]): boolean {
  return issues.some((issue) => issue.level === 'error');
}

/**
 * 发布新版本前，把正文引用块刷新为条款库最新内容并重算 hash。
 * 仅刷新仍存在的条款；已删除的引用保持原样，交由 validatePublication 拦截。
 * 这样新版本固化的是最新条款，而已发布旧快照的 contentHtml 不会被触碰。
 */
export function refreshClauseRefs(html: string, clausesById: Map<string, Clause>): string {
  if (typeof DOMParser === 'undefined') {
    return html;
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const sections = Array.from(doc.querySelectorAll('section[data-clause-ref]'));
  if (!sections.length) {
    return html;
  }

  let changed = false;
  for (const section of sections) {
    const clauseId = section.getAttribute('data-clause-ref') ?? '';
    const clause = clausesById.get(clauseId);
    if (!clause) {
      continue;
    }

    const latestHash = hashHtml(clause.contentHtml);
    if (section.getAttribute('data-clause-hash') !== latestHash || section.innerHTML !== clause.contentHtml) {
      section.innerHTML = clause.contentHtml;
      section.setAttribute('data-clause-hash', latestHash);
      changed = true;
    }
  }

  return changed ? doc.body.innerHTML : html;
}

/**
 * 发布前检查：
 * - error：未替换占位符、必填变量无默认值、变量名重复、引用条款已删除（失效）
 * - warning：声明但未使用的变量、引用条款内容已更新
 */
export function validatePublication(source: PublicationSource, clausesById: Map<string, Clause>): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  const push = (level: IssueLevel, issue: Omit<PublicationIssue, 'level'>) => issues.push({ level, ...issue });

  const placeholderNames = extractPlaceholders(source.contentHtml);
  const variables = source.variables;
  const declaredNames = new Set<string>();
  const duplicated = new Set<string>();

  for (const variable of variables) {
    if (declaredNames.has(variable.name)) {
      duplicated.add(variable.name);
    }
    declaredNames.add(variable.name);
  }

  for (const name of duplicated) {
    push('error', {
      code: 'DUPLICATE_VARIABLE_NAME',
      variableName: name,
      message: `变量名「${name}」重复，替换结果存在歧义。`
    });
  }

  for (const name of placeholderNames) {
    if (!declaredNames.has(name)) {
      push('error', {
        code: 'UNRESOLVED_PLACEHOLDER',
        variableName: name,
        message: `正文包含未声明变量 {{${name}}}，发布后无法替换。`
      });
    }
  }

  variables.forEach((variable: TemplateVariable, index: number) => {
    if (variable.required && !variable.defaultValue.trim()) {
      push('error', {
        code: 'REQUIRED_WITHOUT_DEFAULT',
        variableName: variable.name,
        message: `必填变量「${variable.label || variable.name}」缺少默认值（第 ${index + 1} 个变量）。`
      });
    }
    if (!placeholderNames.includes(variable.name)) {
      push('warning', {
        code: 'UNUSED_VARIABLE',
        variableName: variable.name,
        message: `变量「${variable.label || variable.name}」已声明但正文中未使用。`
      });
    }
  });

  for (const ref of extractClauseRefs(source.contentHtml)) {
    const clause = clausesById.get(ref.clauseId);
    if (!clause) {
      push('error', {
        code: 'CLAUSE_MISSING',
        clauseId: ref.clauseId,
        message: '引用的条款已从条款库删除，属于失效条款，请移除或重新插入。'
      });
      continue;
    }

    if (hashHtml(clause.contentHtml) !== ref.insertedHash) {
      push('warning', {
        code: 'CLAUSE_STALE',
        clauseId: clause.id,
        message: `条款「${clause.title}」在插入后已被修改，发布时将自动采用条款库最新内容。`
      });
    }
  }

  return issues;
}

/** 从正文引用块冻结所引条款；内容以正文内嵌措辞为准，标题/分类取条款库当前值 */
export function freezeClauses(html: string, clausesById: Map<string, Clause>): FrozenClauseRef[] {
  return extractClauseRefs(html).map((ref) => {
    const live = clausesById.get(ref.clauseId);
    return {
      clauseId: ref.clauseId,
      title: live?.title ?? '（已删除条款）',
      // 发布前已拦截已删除条款，这里仅为防御性兜底
      category: live?.category ?? (ClauseCategory.Breach as ClauseCategory),
      innerHtml: ref.innerHtml,
      contentHash: hashHtml(ref.innerHtml),
      insertedHash: ref.insertedHash,
      staleAtPublish: live ? hashHtml(live.contentHtml) !== ref.insertedHash : true
    };
  });
}

export type PublicationDraft = Omit<TemplatePublication, 'id' | 'publishedAt'>;

/** 组装不可变发布快照（不含 id / 时间，由存储层补齐） */
export function buildPublication(
  source: PublicationSource,
  templateId: string,
  versionNo: number,
  remark: string,
  clausesById: Map<string, Clause>
): PublicationDraft {
  const clauses = freezeClauses(source.contentHtml, clausesById);
  const variables = source.variables.map((variable) => ({ ...variable }));
  const contentHtml = source.contentHtml;
  const checksum = hashString(JSON.stringify({ contentHtml, variables, clauses }));

  return {
    templateId,
    versionNo,
    title: source.title,
    category: source.category,
    contentHtml,
    variables,
    clauses,
    checksum,
    remark: remark.trim() || `发布版本 ${versionNo}`
  };
}
