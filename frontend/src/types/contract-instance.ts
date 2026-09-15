import { ContractStatus } from './enums';

export type VariableValues = Record<string, string>;

export interface ContractInstance {
  id: string;
  templateId: string;
  title: string;
  variableValues: VariableValues;
  finalHtml: string;
  status: ContractStatus;
  versionIds: string[];
  /** 锁定的发布快照；有值表示实例基于某个不可变发布版创建 */
  publicationId?: string;
  /** 锁定发布版的版本号，仅用于展示 */
  publishedVersionNo?: number;
  createdAt: string;
  updatedAt: string;
}
