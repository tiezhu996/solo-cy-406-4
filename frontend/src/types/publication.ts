import { ClauseCategory, TemplateCategory } from './enums';
import { TemplateVariable } from './template';

/** 发布时冻结的单条引用条款：内容取自正文引用块，保证与快照正文一致 */
export interface FrozenClauseRef {
  clauseId: string;
  title: string;
  category: ClauseCategory;
  /** 从正文引用块内提取的条款全文，即实际发布的措辞 */
  innerHtml: string;
  /** innerHtml 的内容哈希 */
  contentHash: string;
  /** 插入正文时记录的哈希（data-clause-hash） */
  insertedHash: string;
  /** 发布时该条款是否已与条款库最新内容不一致 */
  staleAtPublish: boolean;
}

export type IssueLevel = 'error' | 'warning';

export type IssueCode =
  | 'UNRESOLVED_PLACEHOLDER'
  | 'REQUIRED_WITHOUT_DEFAULT'
  | 'UNUSED_VARIABLE'
  | 'DUPLICATE_VARIABLE_NAME'
  | 'CLAUSE_MISSING'
  | 'CLAUSE_STALE';

export interface PublicationIssue {
  code: IssueCode;
  level: IssueLevel;
  message: string;
  variableName?: string;
  clauseId?: string;
}

/** 模板的一次不可变发布快照 */
export interface TemplatePublication {
  id: string;
  templateId: string;
  versionNo: number;
  title: string;
  category: TemplateCategory;
  /** 冻结正文，所引条款全文已内嵌在引用块中 */
  contentHtml: string;
  /** 冻结的变量定义 */
  variables: TemplateVariable[];
  /** 冻结的所引条款清单，措辞与 contentHtml 内一致 */
  clauses: FrozenClauseRef[];
  /** 正文 + 变量 + 条款的整体校验和，用于完整性核对 */
  checksum: string;
  publishedAt: string;
  remark: string;
}

export const ISSUE_CODE_LABELS: Record<IssueCode, string> = {
  UNRESOLVED_PLACEHOLDER: '未替换变量',
  REQUIRED_WITHOUT_DEFAULT: '必填变量缺失默认值',
  UNUSED_VARIABLE: '变量未使用',
  DUPLICATE_VARIABLE_NAME: '变量名重复',
  CLAUSE_MISSING: '失效条款',
  CLAUSE_STALE: '条款已更新'
};
