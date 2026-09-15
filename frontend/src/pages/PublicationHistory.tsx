import { Button, Card, Empty, List, Message, Space, Spin, Tag, Typography } from '@arco-design/web-react';
import { IconLeft, IconFile } from '@arco-design/web-react/icon';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useInstanceStore } from '../stores/instance';
import { usePublicationStore } from '../stores/publication';
import { CLAUSE_CATEGORY_LABELS } from '../types/enums';
import { TemplatePublication } from '../types/publication';

export function PublicationHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { publications, loading, loadPublications } = usePublicationStore();
  const { createFromPublication } = useInstanceStore();
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    void loadPublications();
  }, [loadPublications]);

  const related = useMemo(
    () => publications.filter((item) => item.templateId === id).sort((a, b) => b.versionNo - a.versionNo),
    [id, publications]
  );

  useEffect(() => {
    if (!selectedId && related.length) {
      setSelectedId(related[0].id);
    }
  }, [related, selectedId]);

  const selected = related.find((item) => item.id === selectedId);

  const createInstance = async (publication: TemplatePublication) => {
    const instance = await createFromPublication(publication);
    Message.success(`已基于发布版 v${publication.versionNo} 创建实例，内容已固化`);
    navigate(`/instances/${instance.id}`);
  };

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <Typography.Title heading={3}>发布历史</Typography.Title>
          <Typography.Text type="secondary">每个版本都是不可变快照，条款库后续改动不影响此处内容。</Typography.Text>
        </div>
        <Button icon={<IconLeft />} onClick={() => navigate(`/templates/${id}/edit`)}>
          返回编辑器
        </Button>
      </div>

      <Spin loading={loading} style={{ display: 'block' }}>
        {!related.length ? (
          <Empty description="该模板还没有发布过版本，发布后会在此生成不可变快照。" />
        ) : (
          <div className="publication-grid">
            <Card className="publication-list-card" size="small">
              <List
                dataSource={related}
                render={(item) => (
                  <List.Item
                    key={item.id}
                    className={`publication-item ${selectedId === item.id ? 'publication-item--active' : ''}`}
                    onClick={() => setSelectedId(item.id)}
                    style={{ cursor: 'pointer', padding: '10px 12px' }}
                  >
                    <Space direction="vertical" size={2}>
                      <Space>
                        <Typography.Text bold>v{item.versionNo}</Typography.Text>
                        {item.versionNo === related[0].versionNo && (
                          <Tag size="small" color="green">
                            最新
                          </Tag>
                        )}
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {new Date(item.publishedAt).toLocaleString()}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {item.remark}
                      </Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            </Card>

            {selected && (
              <Card
                className="publication-detail-card"
                title={
                  <Space>
                    <Typography.Text bold>
                      {selected.title} · v{selected.versionNo}
                    </Typography.Text>
                    <Tag>{selected.variables.length} 个变量</Tag>
                    <Tag>{selected.clauses.length} 条引用条款</Tag>
                  </Space>
                }
                extra={
                  <Button type="primary" icon={<IconFile />} onClick={() => void createInstance(selected)}>
                    基于此版本创建实例
                  </Button>
                }
              >
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    发布于 {new Date(selected.publishedAt).toLocaleString()} · 校验和 {selected.checksum}
                  </Typography.Text>

                  <article
                    className="contract-preview publication-preview"
                    dangerouslySetInnerHTML={{ __html: selected.contentHtml || '<p>（空正文）</p>' }}
                  />

                  {selected.clauses.length > 0 && (
                    <div>
                      <Typography.Title heading={6}>冻结的引用条款</Typography.Title>
                      <List
                        bordered={false}
                        dataSource={selected.clauses}
                        render={(clause) => (
                          <List.Item key={clause.clauseId}>
                            <Space direction="vertical" size={4} style={{ width: '100%' }}>
                              <Space>
                                <Typography.Text bold>{clause.title}</Typography.Text>
                                <Tag size="small" color="orangered">
                                  {CLAUSE_CATEGORY_LABELS[clause.category] ?? '未知分类'}
                                </Tag>
                                {clause.staleAtPublish && (
                                  <Tag size="small" color="orange">
                                    发布时条款库已有更新
                                  </Tag>
                                )}
                              </Space>
                              <article
                                className="publication-clause"
                                dangerouslySetInnerHTML={{ __html: clause.innerHtml }}
                              />
                            </Space>
                          </List.Item>
                        )}
                      />
                    </div>
                  )}
                </Space>
              </Card>
            )}
          </div>
        )}
      </Spin>
    </section>
  );
}
