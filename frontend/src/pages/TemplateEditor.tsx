import { Button, Input, Message, Select, Space, Typography } from '@arco-design/web-react';
import { IconBook, IconHistory, IconSend, IconSave } from '@arco-design/web-react/icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RichEditor, RichEditorHandle } from '../components/common';
import { ClauseDrawer } from '../components/editor/ClauseDrawer';
import { PublishDialog } from '../components/editor/PublishDialog';
import { VariablePanel } from '../components/editor/VariablePanel';
import { useHistory } from '../hooks/useHistory';
import { useClauseStore } from '../stores/clause';
import { useTemplateStore } from '../stores/template';
import { TemplateCategory, TEMPLATE_CATEGORY_LABELS } from '../types/enums';
import { Template } from '../types/template';
import { buildClauseRefHtml } from '../utils/publication';

const categoryOptions = Object.values(TemplateCategory).map((value) => ({
  label: TEMPLATE_CATEGORY_LABELS[value],
  value
}));

export function TemplateEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Template>();
  const [clauseDrawerVisible, setClauseDrawerVisible] = useState(false);
  const [publishVisible, setPublishVisible] = useState(false);
  const contentHistory = useHistory('');
  const richEditorRef = useRef<RichEditorHandle>(null);
  // 记录最近一次从 store 回填的模板 updatedAt，避免每次渲染都把本地草稿覆盖回已保存版本
  const hydratedUpdatedAtRef = useRef('');
  const { templates, loadTemplates, createTemplate, updateTemplate } = useTemplateStore();
  const { clauses, loadClauses, incrementUsage } = useClauseStore();

  useEffect(() => {
    void Promise.all([loadTemplates(), loadClauses()]);
  }, [loadClauses, loadTemplates]);

  // 新建模板（仅在 id === 'new' 时触发一次）
  useEffect(() => {
    if (id === 'new') {
      void createTemplate().then((template) => navigate(`/templates/${template.id}/edit`, { replace: true }));
    }
  }, [createTemplate, id, navigate]);

  // 仅在以下情况把 store 记录回填到本地草稿：首次加载到该模板、保存后、发布刷新条款后。
  // 编辑过程中 templates 引用变化但 updatedAt 未变时不回填，避免覆盖未保存的引用块。
  useEffect(() => {
    if (!id || id === 'new') {
      return;
    }

    const found = templates.find((template) => template.id === id);
    if (found && found.updatedAt !== hydratedUpdatedAtRef.current) {
      hydratedUpdatedAtRef.current = found.updatedAt;
      setDraft(found);
      contentHistory.reset(found.contentHtml);
    }
  }, [id, templates, contentHistory.reset]);

  // 外部撤销/重做（历史栈变化）同步回正文
  useEffect(() => {
    setDraft((current) =>
      current && current.contentHtml !== contentHistory.value ? { ...current, contentHtml: contentHistory.value } : current
    );
  }, [contentHistory.value]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) {
        return;
      }

      if (event.key.toLowerCase() === 'z' && event.shiftKey) {
        event.preventDefault();
        contentHistory.redo();
      } else if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        contentHistory.undo();
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        contentHistory.redo();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [contentHistory]);

  const tagText = useMemo(() => draft?.tags.join('，') ?? '', [draft?.tags]);

  if (!draft) {
    return <div className="empty-state">正在加载模板...</div>;
  }

  const updateDraft = (patch: Partial<Template>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const updateContent = (contentHtml: string) => {
    updateDraft({ contentHtml });
    contentHistory.push(contentHtml);
  };

  const insertHtml = (html: string) => {
    // 交给编辑器以事务插入，确保 clauseRef 自定义节点被正确解析并保留；
    // onChange 会同步回 draft 与历史栈
    richEditorRef.current?.insertHtml(html);
  };

  const saveTemplate = async () => {
    await updateTemplate(draft);
    Message.success('模板已保存');
  };

  const openPublish = async () => {
    // 发布前先持久化当前草稿，保证模板与即将冻结的快照一致
    await updateTemplate(draft);
    setPublishVisible(true);
  };

  return (
    <section className="page-section editor-page">
      <div className="page-heading">
        <div>
          <Typography.Title heading={3}>模板编辑器</Typography.Title>
          <Typography.Text type="secondary">正文、变量和可复用条款在同一工作台中维护。</Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<IconBook />} onClick={() => setClauseDrawerVisible(true)}>
            条款库
          </Button>
          <Button icon={<IconHistory />} onClick={() => navigate(`/templates/${draft.id}/publications`)}>
            发布历史
          </Button>
          <Button type="primary" icon={<IconSave />} onClick={() => void saveTemplate()}>
            保存
          </Button>
          <Button type="outline" status="success" icon={<IconSend />} onClick={() => void openPublish()}>
            发布
          </Button>
        </Space>
      </div>

      <div className="template-meta-bar">
        <Input value={draft.title} onChange={(title) => updateDraft({ title })} placeholder="模板标题" />
        <Select value={draft.category} options={categoryOptions} onChange={(category) => updateDraft({ category })} />
        <Input
          value={tagText}
          placeholder="标签，用逗号分隔"
          onChange={(value) =>
            updateDraft({
              tags: value
                .split(/[,，]/)
                .map((tag) => tag.trim())
                .filter(Boolean)
            })
          }
        />
      </div>

      <div className="editor-grid">
        <RichEditor
          ref={richEditorRef}
          value={draft.contentHtml}
          onChange={updateContent}
          placeholder="编辑合同模板正文..."
          minHeight={560}
          onUndo={contentHistory.undo}
          onRedo={contentHistory.redo}
          canUndo={contentHistory.canUndo}
          canRedo={contentHistory.canRedo}
        />
        <VariablePanel
          variables={draft.variables}
          onChange={(variables) => updateDraft({ variables })}
          onInsertPlaceholder={(name) => insertHtml(`<span> {{${name}}} </span>`)}
        />
      </div>

      <ClauseDrawer
        visible={clauseDrawerVisible}
        clauses={clauses}
        onClose={() => setClauseDrawerVisible(false)}
        onInsert={(clause) => {
          insertHtml(buildClauseRefHtml(clause));
          void incrementUsage(clause.id);
          Message.success('条款已作为引用块插入正文末尾');
        }}
      />

      <PublishDialog
        visible={publishVisible}
        template={draft}
        clauses={clauses}
        onClose={() => setPublishVisible(false)}
        onPublished={(publication) => {
          setPublishVisible(false);
          Message.success(`已发布 v${publication.versionNo}`);
          navigate(`/templates/${draft.id}/publications`);
        }}
      />
    </section>
  );
}
