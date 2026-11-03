'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ProductInputField, ProductProject, ProjectSummary, ReviewInspection, ReviewSubmission, ReviewWorkspace,
} from '../lib/types';
import { createProject, deleteProject, emptyWorkspace, getActiveProjectId,
  listProjects, loadProject, saveProject } from '../lib/storage/projects';
import { recordProjectAnalysis } from '../lib/project-analysis';
import { mergeReviewInspectionResults } from '../lib/review-inspection';

export function useProjectWorkspace() {
  const [project, setProject] = useState<ProductProject | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [managing, setManaging] = useState(false);
  const [status, setStatus] = useState('저장된 프로젝트를 불러오는 중…');
  const [storageError, setStorageError] = useState('');
  const current = useRef<ProductProject | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const locked = useRef(false);

  const reportError = useCallback((error: unknown) => {
    setStorageError(`프로젝트 저장소 오류: ${error instanceof Error ? error.message : '저장 공간과 브라우저 설정을 확인해 주세요.'}`);
    setStatus('저장되지 않음');
  }, []);

  // Capture each snapshot before queuing: delayed writes cannot target another project.
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const snapshot = current.current;
    if (!snapshot || !dirty.current) { await queue.current; return; }
    const write = queue.current.catch(() => {}).then(async () => {
      await saveProject(snapshot);
      if (current.current === snapshot) {
        dirty.current = false;
        setStatus('자동 저장 완료');
        setStorageError('');
      }
      setProjects(await listProjects());
    });
    queue.current = write;
    await write;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const all = await listProjects();
        const id = await getActiveProjectId();
        const restored = (id ? await loadProject(id) : undefined)
          ?? (all[0] ? await loadProject(all[0].id) : undefined);
        if (cancelled) return;
        current.current = restored ?? null;
        setProject(restored ?? null);
        setProjects(all);
        setReady(true);
        setStatus(restored ? '저장된 프로젝트 복원 완료' : '새 프로젝트를 만들어 시작하세요.');
      } catch (error) { if (!cancelled) reportError(error); }
    }
    void restore();
    const save = () => { void flush().catch(reportError); };
    const visibility = () => { if (document.visibilityState === 'hidden') save(); };
    // IndexedDB writes are asynchronous; beforeunload warns only while unsaved.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) { save(); event.preventDefault(); event.returnValue = ''; }
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [flush, reportError]);

  function edit(patch: Partial<ProductProject>) {
    if (!current.current || locked.current) return;
    const next = { ...current.current, ...patch, updatedAt: new Date().toISOString() };
    current.current = next;
    dirty.current = true;
    setProject(next);
    setStatus('저장 대기 중…');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(reportError); }, 400);
  }

  function updateWorkspace<K extends keyof ReviewWorkspace>(field: K, value: ReviewWorkspace[K]) {
    if (!current.current || Object.is(current.current.workspace[field], value)) return;
    const guideSourceChanged = field === 'reviews' || field === 'results' || field === 'themes';
    const sourceChanged = field === 'reviews' || field === 'rows' || field === 'mapping' || field === 'file';
    edit({
      workspace: { ...current.current.workspace, [field]: value },
      ...(sourceChanged ? { analysisInputVersion: (current.current.analysisInputVersion ?? 0) + 1 } : {}),
      ...(guideSourceChanged ? { guideInputVersion: (current.current.guideInputVersion ?? 0) + 1 } : {}),
    });
  }

  function updateProduct(patch: Partial<Pick<ProductProject, ProductInputField | 'evaluationItems'>>) {
    if (!current.current || !Object.keys(patch).length) return;
    const sourceChanged = patch.productName !== undefined
      || patch.productDescription !== undefined
      || patch.strengths !== undefined
      || patch.targetCustomers !== undefined
      || patch.useSituations !== undefined;
    edit({
      ...patch,
      ...(sourceChanged ? { analysisInputVersion: (current.current.analysisInputVersion ?? 0) + 1 } : {}),
      guideInputVersion: (current.current.guideInputVersion ?? 0) + 1,
    });
  }

  function recordAnalysis(analysis: {
    results: ProductProject['workspace']['results'];
    themes: ProductProject['workspace']['themes'];
    mode: string;
    notice: string;
    analysisMetadata?: ProductProject['workspace']['analysisMetadata'];
  }, expected?: { projectId: string; inputVersion: number }) {
    if (!current.current || (expected && (current.current.id !== expected.projectId
      || (current.current.analysisInputVersion ?? 0) !== expected.inputVersion))) return false;
    const next = recordProjectAnalysis(current.current, analysis);
    edit({
      workspace: next.workspace,
      analyzedInputVersion: next.analyzedInputVersion,
      guideInputVersion: (current.current.guideInputVersion ?? 0) + 1,
    });
    return true;
  }

  function saveReviewInputs(reviews: ReviewSubmission[]) {
    if (!current.current) return;
    const byId = new Map(current.current.submittedReviews.map(review => [review.id, review]));
    for (const review of reviews) byId.set(review.id, review);
    edit({ submittedReviews: [...byId.values()] });
  }

  function saveReviewComposition(projectId: string, composition: ProductProject['reviewComposition']) {
    if (!current.current || current.current.id !== projectId) return false;
    edit({ reviewComposition: composition });
    return true;
  }

  function addComposedReview(projectId: string, text: string) {
    if (!current.current || current.current.id !== projectId || !text.trim() || text.length > 6000
      || current.current.submittedReviews.length >= 50) return false;
    if (!current.current.submittedReviews.some(review => review.text === text.trim())) {
      edit({ submittedReviews: [...current.current.submittedReviews, {
        id: crypto.randomUUID(), text: text.trim(), submittedAt: new Date().toISOString(),
      }] });
    }
    return true;
  }

  function saveReviewCheckResults(reviews: ReviewSubmission[], inspections: ReviewInspection[]) {
    if (!current.current) return;
    const submitted = new Map(current.current.submittedReviews.map(review => [review.id, review]));
    for (const review of reviews) submitted.set(review.id, review);
    edit({
      submittedReviews: [...submitted.values()],
      inspections: mergeReviewInspectionResults(current.current.inspections, inspections),
    });
  }

  function removeReviewSubmission(reviewId: string) {
    if (!current.current) return;
    edit({
      submittedReviews: current.current.submittedReviews.filter(review => review.id !== reviewId),
      inspections: current.current.inspections.filter(result => result.reviewId !== reviewId),
    });
  }

  function clearReviewSubmissions() {
    if (!current.current) return;
    edit({ submittedReviews: [], inspections: [] });
  }

  function updateGuideForProject(projectId: string, guide: NonNullable<ProductProject['guide']>): boolean {
    if (!current.current || current.current.id !== projectId || locked.current) return false;
    edit({ guide });
    return true;
  }

  async function manage(action: () => Promise<ProductProject | null>): Promise<boolean> {
    if (locked.current) return false;
    locked.current = true;
    setManaging(true);
    try {
      await flush(); // A failed save keeps the current project open for retry.
      const next = await action();
      current.current = next;
      dirty.current = false;
      setProject(next);
      setProjects(await listProjects());
      setStatus(next ? '저장 완료' : '새 프로젝트를 만들어 시작하세요.');
      setStorageError('');
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
    finally { locked.current = false; setManaging(false); }
  }

  return {
    project, projects, ready, managing, status, storageError,
    getCurrentProject: () => current.current,
    workspace: project?.workspace ?? emptyWorkspace(), updateWorkspace, updateProduct, recordAnalysis,
    saveReviewInputs, saveReviewCheckResults, removeReviewSubmission, clearReviewSubmissions,
    updateGuideForProject, saveReviewComposition, addComposedReview,
    saveNow: flush,
    rename: (name: string) => edit({ name }),
    create: (name: string) => manage(() => createProject(name)),
    select: (id: string) => manage(async () => {
      const next = await loadProject(id);
      if (!next) throw new Error('프로젝트를 찾을 수 없습니다.');
      await saveProject(next);
      return next;
    }),
    remove: () => manage(async () => {
      if (!current.current) return null;
      await deleteProject(current.current.id);
      const remaining = await listProjects();
      const next = remaining[0] ? await loadProject(remaining[0].id) : undefined;
      if (next) await saveProject(next);
      return next ?? null;
    }),
    removeProject: (id: string) => manage(async () => {
      const removingCurrent = current.current?.id === id;
      await deleteProject(id);
      if (!removingCurrent) return current.current;
      const remaining = await listProjects();
      const next = remaining[0] ? await loadProject(remaining[0].id) : undefined;
      if (next) await saveProject(next);
      return next ?? null;
    }),
    retry: () => { if (ready) void flush().catch(reportError); else window.location.reload(); },
  };
}
