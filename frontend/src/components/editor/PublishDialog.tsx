import { Alert, Input, List, Modal, Space, Tag, Typography } from '@arco-design/web-react';
import { IconCheckCircleFill, IconExclamationCircleFill } from '@arco-design/web-react/icon';
import { useEffect, useMemo, useState } from 'react';
import { usePublicationStore } from '../../stores/publication';
import { ISSUE_CODE_LABELS, PublicationIssue, TemplatePublication } from '../../types/publication';
import { Clause } from '../../types/clause';
import { Template } from '../../types/template';
import { hasBlockingIssues, validatePublication } from '../../utils/publication';

interface PublishDialogProps {
  visible: boolean;
  template: Template;
  clauses: Clause[];
  onClose: () => void;
  onPublished: (publication: TemplatePublication) => void;
}

export function PublishDialog({ visible, template, clauses, onClose, onPublished }: PublishDialogProps) {
  const publishTemplate = usePublicationStore((state) => state.publishTemplate);
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setRemark('');
    }
  }, [visible]);

  const issues = useMemo<PublicationIssue[]>(() => {
    if (!visible) {
      return [];
    }
    const clausesById = new Map(clauses.map((clause) => [clause.id, clause]));
    return validatePublication(template, clausesById);
  }, [visible, template, clauses]);

  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  const blocked = hasBlockingIssues(issues);

  const renderIssue = (issue: PublicationIssue) => (
    <List.Item key={`${issue.code}-${issue.variableName ?? issue.clauseId ?? issue.message}`}>
      <Space size={8} align="start">
        {issue.level === 'error' ? (
          <IconExclamationCircleFill style={{ color: 'rgb(var(--danger-6))', marginTop: 3 }} />
        ) : (
          <IconExclamationCircleFill style={{ color: 'rgb(var(--warning-6))', marginTop: 3 }} />
        )}
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Tag size="small" color={issue.level === 'error' ? 'red' : 'orange'}>
              {ISSUE_CODE_LABELS[issue.code]}
            </Tag>
          </Space>
          <Typography.Text>{issue.message}</Typography.Text>
        </Space>
      </Space>
    </List.Item>
  );

  const confirm = async () => {
    setSubmitting(true);
    try {
      const result = await publishTemplate(template, clauses, remark);
      if (result.ok && result.publication) {
        onPublished(result.publication);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      title="发布模板"
      onCancel={onClose}
      onOk={() => void confirm()}
      okButtonProps={{ disabled: blocked, loading: submitting }}
      okText={blocked ? '存在阻断问题' : '确认发布'}
      cancelText="取消"
      autoFocus={false}
      maskClosable={false}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          发布将冻结当前正文与所引条款；之后条款库的增删改不会影响本次发布版本。
        </Typography.Text>

        {blocked && (
          <Alert
            type="error"
            content={`存在 ${errors.length} 个阻断问题，修复前无法发布，也不会生成新版本。`}
          />
        )}
        {!blocked && warnings.length > 0 && (
          <Alert type="warning" content={`有 ${warnings.length} 个警告，可继续发布；引用条款将自动刷新为条款库最新内容。`} />
        )}
        {!issues.length && (
          <Alert type="success" icon={<IconCheckCircleFill />} content="检查通过，可以发布。" />
        )}

        {errors.length > 0 && <List bordered={false} dataSource={errors} render={renderIssue} />}
        {warnings.length > 0 && <List bordered={false} dataSource={warnings} render={renderIssue} />}

        <div>
          <Typography.Text style={{ display: 'block', marginBottom: 6 }}>版本备注（可选）</Typography.Text>
          <Input.TextArea
            rows={2}
            placeholder="例如：首版 / 更新违约条款"
            value={remark}
            onChange={setRemark}
          />
        </div>
      </Space>
    </Modal>
  );
}
