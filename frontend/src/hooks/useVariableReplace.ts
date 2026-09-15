import { useMemo } from 'react';
import { Template, TemplateVariable } from '../types/template';
import { VariableValues } from '../types/contract-instance';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 可作为变量替换来源的最小结构（模板草稿或发布快照均满足） */
export type VariableSource = Pick<Template, 'contentHtml' | 'variables'> | undefined;

export function replaceVariables(source: VariableSource, values: VariableValues) {
  if (!source) {
    return '';
  }

  const variables: TemplateVariable[] = source.variables;
  return variables.reduce((html, variable) => {
    const actualValue = values[variable.name] || variable.defaultValue || `{{${variable.name}}}`;
    const pattern = new RegExp(`{{\\s*${escapeRegExp(variable.name)}\\s*}}`, 'g');
    return html.replace(pattern, actualValue);
  }, source.contentHtml);
}

export function useVariableReplace(source: VariableSource, values: VariableValues) {
  return useMemo(() => replaceVariables(source, values), [source, values]);
}
