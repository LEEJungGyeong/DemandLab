import type { ProductProject, ProjectSummary, ReviewWorkspace } from '../types';
import { openDatabase, PROJECTS, SETTINGS, requestValue, transactionDone } from './db';
import { summarizeProject } from '../project-summary';

export function emptyWorkspace(): ReviewWorkspace {
  return { reviews: [], results: [], themes: [], file: '', rows: [],
    mapping: { text: 0, rating: -1, date: -1, option: -1 },
    exclude: true, mode: '', notice: '' };
}

export async function createProject(name: string): Promise<ProductProject> {
  const now = new Date().toISOString();
  const project: ProductProject = {
    id: crypto.randomUUID(), name: name.trim() || '새 프로젝트',
    productName: '', productDescription: '', strengths: [], targetCustomers: '',
    useSituations: [], evaluationItems: [], analysisInputVersion: 0, guideInputVersion: 0,
    workspace: emptyWorkspace(), submittedReviews: [], inspections: [],
    createdAt: now, updatedAt: now,
  };
  await saveProject(project);
  return project;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDatabase();
  const tx = db.transaction(PROJECTS, 'readonly');
  const done = transactionDone(tx);
  const projects = await requestValue<ProductProject[]>(tx.objectStore(PROJECTS).getAll());
  await done;
  return projects.map(summarizeProject)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadProject(id: string): Promise<ProductProject | undefined> {
  const db = await openDatabase();
  const tx = db.transaction(PROJECTS, 'readonly');
  const done = transactionDone(tx);
  const stored = await requestValue<ProductProject | undefined>(tx.objectStore(PROJECTS).get(id));
  await done;
  if (!stored) return undefined;
  return {
    ...stored,
    strengths: stored.strengths ?? [],
    useSituations: stored.useSituations ?? [],
    evaluationItems: stored.evaluationItems ?? [],
    analysisInputVersion: stored.analysisInputVersion ?? 0,
    guideInputVersion: stored.guideInputVersion ?? 0,
    submittedReviews: (stored.submittedReviews ?? []).flatMap((review, index) => {
      if (!review || typeof review !== 'object' || typeof review.text !== 'string') return [];
      const legacy = review as { id?: unknown; authorId?: unknown; submittedAt?: unknown };
      return [{
        id: typeof legacy.id === 'string' ? legacy.id : `legacy-review-${String(legacy.id ?? index)}`,
        ...(typeof legacy.authorId === 'string' ? { authorId: legacy.authorId } : {}),
        text: review.text,
        submittedAt: typeof legacy.submittedAt === 'string' ? legacy.submittedAt : stored.updatedAt,
      }];
    }),
    inspections: stored.inspections ?? [],
  };
}

export async function saveProject(project: ProductProject): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction([PROJECTS, SETTINGS], 'readwrite');
  const done = transactionDone(tx);
  // Explicit allowlist excludes UI state, API keys and arbitrary extra properties.
  const { id, name, productName, productDescription, strengths, targetCustomers,
    useSituations, evaluationItems, analysisInputVersion, analyzedInputVersion, guideInputVersion,
    workspace, guide, submittedReviews, inspections, createdAt, updatedAt } = project;
  const { reviews, results, themes, file, rows, mapping, exclude, mode, notice, analysisMetadata } = workspace;
  tx.objectStore(PROJECTS).put({ id, name, productName, productDescription, strengths,
    targetCustomers, useSituations, evaluationItems, analysisInputVersion, analyzedInputVersion, guideInputVersion,
    workspace: { reviews, results, themes, file, rows, mapping, exclude, mode, notice, analysisMetadata },
    guide, submittedReviews, inspections, createdAt, updatedAt });
  tx.objectStore(SETTINGS).put(id, 'activeProjectId');
  await done;
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction([PROJECTS, SETTINGS], 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(PROJECTS).delete(id);
  const store = tx.objectStore(SETTINGS);
  const request = store.get('activeProjectId');
  request.onsuccess = () => { if (request.result === id) store.delete('activeProjectId'); };
  await done;
}

export async function getActiveProjectId(): Promise<string | undefined> {
  const db = await openDatabase();
  const tx = db.transaction(SETTINGS, 'readonly');
  const done = transactionDone(tx);
  const id = await requestValue<string | undefined>(tx.objectStore(SETTINGS).get('activeProjectId'));
  await done;
  return id;
}
