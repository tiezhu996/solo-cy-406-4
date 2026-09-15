import { create } from 'zustand';
import { publicationDb } from '../api/db';
import { Clause } from '../types/clause';
import { PublicationIssue, TemplatePublication } from '../types/publication';
import { Template } from '../types/template';
import { makeId, nowIso } from '../utils/db';
import { buildPublication, hasBlockingIssues, refreshClauseRefs, validatePublication } from '../utils/publication';
import { useTemplateStore } from './template';

interface PublishResult {
  ok: boolean;
  issues: PublicationIssue[];
  publication?: TemplatePublication;
}

interface PublicationState {
  publications: TemplatePublication[];
  loading: boolean;
  loadPublications: () => Promise<void>;
  /** 发布前检查；存在 error 时拦截，不写入任何新快照。通过后先刷新引用条款到最新，再冻结 */
  publishTemplate: (template: Template, clauses: Clause[], remark?: string) => Promise<PublishResult>;
  getByTemplate: (templateId: string) => TemplatePublication[];
}

function sortPublications(publications: TemplatePublication[]) {
  return [...publications].sort((a, b) => b.versionNo - a.versionNo || b.publishedAt.localeCompare(a.publishedAt));
}

export const usePublicationStore = create<PublicationState>((set, get) => ({
  publications: [],
  loading: false,

  async loadPublications() {
    set({ loading: true });
    try {
      const publications = await publicationDb.list();
      set({ publications: sortPublications(publications) });
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

    // 新版本必须固化条款库最新内容：把正文引用块刷新为最新措辞与 hash。
    // 仅更新当前模板与本次快照；历史发布记录不参与，仍保持各自原措辞。
    const refreshedHtml = refreshClauseRefs(template.contentHtml, clausesById);
    const refreshedTemplate: Template =
      refreshedHtml !== template.contentHtml ? { ...template, contentHtml: refreshedHtml } : template;

    if (refreshedTemplate !== template) {
      await useTemplateStore.getState().updateTemplate(refreshedTemplate, false);
    }

    const related = get().publications.filter((item) => item.templateId === template.id);
    const versionNo = related.reduce((max, item) => Math.max(max, item.versionNo), 0) + 1;
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
      .sort((a, b) => b.versionNo - a.versionNo);
  }
}));
