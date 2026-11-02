export type Review = {
  id: number;
  text: string;
  rating: string;
  date: string;
  option: string;
  sponsored: boolean;
};

export type Result = {
  id: number;
  theme: string;
  subtheme: string;
  sentiment: string;
  evidence: string;
};

export type AIAnalysisMetadata = {
  provider: 'openai' | 'ollama';
  model: string;
  analyzedAt: string;
};

export type Theme = {
  name: string;
  description?: string;
};

export type ColumnMapping = {
  text: number;
  rating: number;
  date: number;
  option: number;
};

// Serializable project data only. Connection credentials must never be added here.
export type ReviewWorkspace = {
  reviews: Review[];
  results: Result[];
  themes: Theme[];
  file: string;
  rows: string[][];
  mapping: ColumnMapping;
  exclude: boolean;
  mode: string;
  notice: string;
  analysisMetadata?: AIAnalysisMetadata;
};

export type ReviewGuide = {
  content: string;
  checklist: string[];
  generatedAt: string;
  editedContent?: string;
  title?: string;
  productName?: string;
  targetCustomers?: string;
  purpose?: string;
  testItems?: ReviewGuideTestItem[];
  writingGuidance?: string[];
  provider?: 'openai' | 'ollama';
  model?: string;
  updatedAt?: string;
  sourceVersion?: number;
};

export type ReviewGuideTestItem = {
  id: string;
  title: string;
  required?: boolean;
  purpose: string;
  recommendedSituation: string;
  method: string;
  observe: string[];
  questions: string[];
  checklist: string[];
};

export type ReviewSubmission = {
  id: string;
  authorId?: string;
  text: string;
  submittedAt: string;
};

export type ReviewInspectionItemStatus =
  | '충족'
  | '부분 충족'
  | '미충족'
  | '해당 없음'
  | '판단 불가';

export type ReviewInspectionStatus = '문제 없음' | '보완 필요' | '검수 실패';

export type ReviewInspectionItem = {
  guideItemId: string;
  title: string;
  required: boolean;
  status: ReviewInspectionItemStatus;
  evidence: string;
  missingInfo: string[];
  unclearInfo: string[];
  feedback: string;
};

export type ReviewInspection = {
  reviewId: string;
  authorId?: string;
  text: string;
  status: ReviewInspectionStatus;
  satisfiedCount: number;
  partialCount: number;
  missingCount: number;
  unknownCount: number;
  notApplicableCount: number;
  summary: string;
  needsRevision: boolean;
  specificity: '구체적' | '일부 불명확' | '구체성 부족' | '판단 불가';
  conflicts: { claim: string; evidence: string }[];
  unsupportedClaims: { claim: string; evidence: string }[];
  disclosure: {
    status: '공개 확인' | '언급 없음' | '판단 불가' | '해당 없음';
    evidence: string;
    feedback: string;
  };
  items: ReviewInspectionItem[];
  guideVersion: string;
  provider: 'openai' | 'ollama';
  model: string;
  inspectedAt: string;
  error?: string;
};

export type EvaluationItem = {
  id: string;
  title: string;
};

export type ProductInputField =
  | 'productName'
  | 'productDescription'
  | 'strengths'
  | 'targetCustomers'
  | 'useSituations';

export type ProductProject = {
  id: string;
  name: string;
  productName: string;
  productDescription: string;
  strengths: string[];
  targetCustomers: string;
  useSituations: string[];
  evaluationItems: EvaluationItem[];
  workspace: ReviewWorkspace;
  analysisInputVersion: number;
  analyzedInputVersion?: number;
  guideInputVersion: number;
  guide?: ReviewGuide;
  submittedReviews: ReviewSubmission[];
  inspections: ReviewInspection[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = Pick<ProductProject,
  'id' | 'name' | 'productName' | 'targetCustomers' | 'createdAt' | 'updatedAt'> & {
  stage: string;
  demoData: boolean;
  reviewCount: number;
  evaluationCount: number;
  hasGuide: boolean;
  inspectedCount: number;
  revisionCount: number;
  failedCount: number;
};
