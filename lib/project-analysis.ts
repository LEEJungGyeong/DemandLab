import type { AIAnalysisMetadata, ProductProject, Result, Theme } from './types';

export function isAnalysisStale(project: ProductProject): boolean {
  return project.workspace.results.length > 0
    && project.analyzedInputVersion !== project.analysisInputVersion;
}

export function recordProjectAnalysis(
  project: ProductProject,
  analysis: {
    results: Result[];
    themes: Theme[];
    mode: string;
    notice: string;
    analysisMetadata?: AIAnalysisMetadata;
  },
): ProductProject {
  return {
    ...project,
    workspace: {
      ...project.workspace,
      results: analysis.results,
      themes: analysis.themes,
      mode: analysis.mode,
      notice: analysis.notice,
      analysisMetadata: analysis.analysisMetadata,
    },
    analyzedInputVersion: project.analysisInputVersion,
  };
}
