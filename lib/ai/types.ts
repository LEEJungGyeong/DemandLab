import type {
  Review, Result, ReviewGuide, ReviewInspection, ReviewSubmission, Theme,
} from '../types';
export type { AIAnalysisMetadata } from '../types';

export type AIProviderKind = 'openai' | 'ollama';

export type AIWorkType =
  | 'review-analysis'
  | 'product-analysis'
  | 'guide-generation'
  | 'review-draft'
  | 'review-check';

export type AISettings = {
  provider: AIProviderKind;
  models: {
    openai: string;
    ollama: string;
  };
};

export type ReviewAnalysisRequest = {
  task: 'review-analysis';
  reviews: Pick<Review, 'id' | 'text'>[];
};

export type ReviewAnalysisResponse = {
  themes: Theme[];
  results: Result[];
  dropped: number;
  missingReviewIds: number[];
};

export type GuideAnalysisTopic = {
  theme: string;
  positive: number;
  negative: number;
  neutral: number;
  mixed: number;
  evidence: { sentiment: string; quote: string }[];
};

export type GuideGenerationInput = {
  product: {
    name: string;
    description: string;
    emphasizedStrengths: string[];
    targetCustomers: string;
    useSituations: string[];
  };
  evaluationItems: string[];
  existingReviewAnalysis?: {
    stale: boolean;
    topics: GuideAnalysisTopic[];
  };
};

export type GuideGenerationRequest = {
  task: 'guide-generation';
  input: GuideGenerationInput;
};

export type GuideGenerationDraft = Pick<
  ReviewGuide,
  'title' | 'purpose' | 'testItems' | 'writingGuidance'
> & {
  title: string;
  purpose: string;
  testItems: NonNullable<ReviewGuide['testItems']>;
  writingGuidance: string[];
};

export type ReviewCheckInput = {
  product: {
    name: string;
    description: string;
    strengths: string[];
  };
  guide: Pick<ReviewGuide, 'title' | 'purpose' | 'testItems' | 'writingGuidance' | 'checklist'>;
  guideVersion: string;
  reviews: Pick<ReviewSubmission, 'id' | 'authorId' | 'text'>[];
};

export type ReviewCheckRequest = {
  task: 'review-check';
  input: ReviewCheckInput;
};

export type ReviewCheckResponse = {
  inspections: ReviewInspection[];
};

export type AIProviderConfig = {
  model: string;
  apiKey?: string;
};

export type AIProvider = {
  readonly kind: AIProviderKind;
  readonly model: string;
  listModels(): Promise<string[]>;
  analyzeReviews(request: ReviewAnalysisRequest): Promise<ReviewAnalysisResponse>;
  generateGuide(request: GuideGenerationRequest): Promise<GuideGenerationDraft>;
  checkReviews(request: ReviewCheckRequest): Promise<ReviewCheckResponse>;
  draftReview(input: import('./review-draft').ReviewDraftInput): Promise<import('./review-draft').ReviewDraftResponse>;
};

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'openai',
  models: {
    openai: 'gpt-4.1-mini',
    ollama: '',
  },
};
