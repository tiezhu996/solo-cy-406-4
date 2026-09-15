import { create } from 'zustand';
import { publicationDb } from '../api/db';
import { Clause } from '../types/clause';
import { PublicationIssue, TemplatePublication } from '../types/publication';
import { Template } from '../types/template';
import { makeId, nowIso } from '../utils/db';
import {
  buildPublication,
  comparePublicationsDesc,
  hasBlockingIssues,
  normalizePublication,
  refreshClauseRefs,
  validatePublication
} from '../utils/publication';
import { useTemplateStore } from './template';

interface PublishResult {
  ok: boolean;
  issues: PublicationIssue[];
  publication?: TemplatePublication;
}

interface PublicationState {
  publications: TemplatePublication[];
  loading: boolean;
  loadError: string | null;
  loadPublications: () => Promise<void>;
  /** 发布前检查；存在 error 时拦截，不写入任何新快照。通过后先刷新引用条款到最新，再冻结 */
  publishTemplate: (template: Template, clauses: Clause[], remark?: string) => Promise<PublishResult>;
  getByTemplate: (templateId: string) => TemplatePublication[];
}

function sortPublications(publications: TemplatePublication[]) {
  return [...publications].sort(comparePublicationsDesc);
}

export const usePublicationStore = create<PublicationState>((set, get) => ({
  publications: [],
  loading: false,
  loadError: null,

  async loadPublications() {
    set({ loading: true, loadError: null });
    try {
      // 规范化后再入内存：兼容旧/残缺数据，保证历史页可回读、顺序确定
      const raw = await publicationDb.list();
      const publications = (raw as Array<Partial<TemplatePublication> & { id: string }>).map(normalizePublication);
      set({ publications: sortPublications(publications), loadError: null });
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'BlockedUpgradeError'
          ? error.message
          : '读取发布历史失败，请重试。';
      set({ loadError: message });
    } finally {
      set({ loading: false });
    }
  },

  async publishTemplate(template, clauses, remark = '') {
    const clausesById = new Map(clauses.map((clause) => [clause.id, clause]));
    const issues = validatePublication(template, clausesById);

    if (hasBlockingIssues(issues)) {
      return { ok: false, issues };
    }

    // 版本号以“已保存的历史”为准，而不是内存状态：
    // 编辑页可能从未 loadPublications（重载后内存为空），直接读持久层避免再次编成 v1。
    const persisted = (await publicationDb.list()) as Array<Partial<TemplatePublication> & { id: string }>;
    const maxVersionNo = persisted
      .filter((item) => item.templateId === template.id)
      .reduce((max, item) => Math.max(max, Number.isFinite(item.versionNo) ? (item.versionNo as number) : 0), 0);
    const versionNo = maxVersionNo + 1;

    // 新版本必须固化条款库最新内容：把正文引用块刷新为最新措辞与 hash。
    // 仅更新当前模板与本次快照；历史发布记录不参与，仍保持各自原措辞。
    const refreshedHtml = refreshClauseRefs(template.contentHtml, clausesById);
    const refreshedTemplate: Template =
      refreshedHtml !== template.contentHtml ? { ...template, contentHtml: refreshedHtml } : template;

    if (refreshedTemplate !== template) {
      await useTemplateStore.getState().updateTemplate(refreshedTemplate, false);
    }

    const draft = buildPublication(refreshedTemplate, template.id, versionNo, remark, clausesById);
    const publication: TemplatePublication = {
      ...draft,
      id: makeId('pub'),
      publishedAt: nowIso()
    };

    await publicationDb.save(publication);
    set((state) => ({ publications: sortPublications([publication, ...state.publications]) }));
    return { ok: true, issues, publication };
  },

  getByTemplate(templateId) {
    return get()
      .publications.filter((item) => item.templateId === templateId)
      .sort(comparePublicationsDesc);
  }
}));
