'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, ArrowUpRight, BarChart3, Check, ChevronRight, Download,
  ClipboardList, FlaskConical, FolderKanban, KeyRound, MessageSquare, Plus, Search, SlidersHorizontal,
  Trash2, Upload, X,
} from 'lucide-react';
import type { EvaluationItem, ProductInputField, Result, ReviewInspection, Theme } from '../lib/types';
import { createDemoAnalysis } from '../lib/demo';
import { readReviewCSV } from '../lib/csv';
import { useProjectWorkspace } from '../hooks/use-project-workspace';
import { sponsored, normalizeReviews } from '../lib/review';
import { isAnalysisStale } from '../lib/project-analysis';
import { isReviewGuideStale } from '../lib/guide';
import { DEFAULT_AI_SETTINGS, type AIProviderKind, type AISettings } from '../lib/ai/types';
import { OLLAMA_BASE_URL } from '../lib/ai/constants';
import { loadAISettings, saveAISettings } from '../lib/storage/ai-settings';
import GuideWorkspace from './guide-workspace';
import ProjectDashboard from './project-dashboard';
import ReviewCheckWorkspace from './review-check-workspace';

const sentiments = ['긍정', '부정', '혼합', '중립'];
const demoTexts = [
  '배터리는 하루 종일 가서 좋은데, 한 시간만 끼면 귀가 아파요.',
  '지하철에서 연결이 자꾸 끊겨요. 집에서는 잘 됩니다.',
  '가볍고 귀에 편해요. 오래 끼고 공부하기 좋아요.',
  '통화할 때 제 목소리가 작게 들린대요.',
  '충전을 자주 안 해도 돼서 만족합니다.',
  '운동하면 귀에서 빠져요.',
  '음질이 선명하고 저음이 좋아요.',
  '케이스에 넣어도 한쪽이 충전이 안 됩니다.',
  '기기 전환이 빠르고 연결이 안정적이에요.',
  '쿠팡체험단 이벤트로 상품을 무료로 제공받아 작성한 구매후기입니다. 착용감이 편하고 음질이 좋아요.',
  '바람 부는 곳에서는 통화가 어려워요.',
  '베개에 귀가 눌려서 누워서 사용하기 불편해요.',
  '배터리 사용 시간은 5시간 정도입니다.',
  '음질은 좋은데 저음이 너무 강해요.',
  '케이스에 흠집이 쉽게 생겨요.',
  '가격 대비 소리가 좋아요.',
];
function splitLines(value: string): string[] {
  return value.split('\n').map(item => item.trim()).filter(Boolean);
}

function newEvaluationItem(title: string): EvaluationItem {
  return { id: crypto.randomUUID(), title: title.trim() };
}

export default function Home() {
  const storage = useProjectWorkspace();
  const project = storage.project;
  const { reviews, results, themes, file, rows, mapping, exclude, notice, mode } = storage.workspace;
  const [theme, setTheme] = useState('전체');
  const [sentiment, setSentiment] = useState('전체');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('기본순');
  const [key, setKey] = useState('');
  const [settings, setSettings] = useState(false);
  const [aiSettings, setAISettings] = useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [aiSettingsReady, setAISettingsReady] = useState(false);
  const [connectionState, setConnectionState] = useState<'idle' | 'checking' | 'connected' | 'disconnected' | 'model-missing' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('아직 연결을 확인하지 않았습니다.');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [evaluationDraft, setEvaluationDraft] = useState('');
  const [dashboardMode, setDashboardMode] = useState(true);
  const [workflowStep, setWorkflowStep] = useState(1);
  const [guideMode, setGuideMode] = useState(false);
  const [checkMode, setCheckMode] = useState(false);
  const [reviewCheckBusy, setReviewCheckBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const reviewList = useRef<HTMLDivElement>(null);
  const aiSettingsQueue = useRef<Promise<void>>(Promise.resolve());
  const disabled = !storage.ready || storage.managing || busy;
  const navigationDisabled = disabled || reviewCheckBusy;

  useEffect(() => {
    let active = true;
    loadAISettings().then(value => {
      if (!active) return;
      setAISettings(value);
      setAISettingsReady(true);
    }).catch((reason: unknown) => {
      if (!active) return;
      setAISettingsReady(true);
      setConnectionState('error');
      setConnectionMessage(reason instanceof Error ? reason.message : 'AI 설정을 불러오지 못했습니다.');
    });
    return () => { active = false; };
  }, []);

  const active = useMemo(
    () => reviews.filter(review => !exclude || !review.sponsored),
    [reviews, exclude],
  );
  const activeIds = new Set(active.map(review => review.id));
  const filteredResults = results.filter(result => activeIds.has(result.id));
  const stats = themes
    .map(item => ({ ...item, items: filteredResults.filter(result => result.theme === item.name) }))
    .filter(item => item.items.length > 0)
    .sort((a, b) => b.items.length - a.items.length);

  let shown = active.filter(review => review.text.toLowerCase().includes(query.toLowerCase())
    && (theme === '전체'
      ? sentiment === '전체' || filteredResults.some(result => result.id === review.id && result.sentiment === sentiment)
      : filteredResults.some(result => result.id === review.id && result.theme === theme
        && (sentiment === '전체' || result.sentiment === sentiment))));
  if (sort === '낮은 별점순') shown = shown.sort((a, b) => (Number(a.rating) || 6) - (Number(b.rating) || 6));
  if (sort === '최신순') shown = shown.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));

  const evaluationItems = project?.evaluationItems ?? [];
  const projectGuideVersion = project?.guide?.updatedAt || project?.guide?.generatedAt || '';
  const latestInspectionByReview = new Map<string, ReviewInspection>();
  for (const inspection of project?.inspections ?? []) {
    const previous = latestInspectionByReview.get(inspection.reviewId);
    if (!previous || inspection.inspectedAt > previous.inspectedAt) {
      latestInspectionByReview.set(inspection.reviewId, inspection);
    }
  }
  const successfulInspectionByReview = new Map<string, ReviewInspection>();
  for (const inspection of project?.inspections ?? []) {
    if (inspection.status === '검수 실패' || inspection.guideVersion !== projectGuideVersion) continue;
    const previous = successfulInspectionByReview.get(inspection.reviewId);
    if (!previous || inspection.inspectedAt > previous.inspectedAt) {
      successfulInspectionByReview.set(inspection.reviewId, inspection);
    }
  }
  const currentGuideInspections = [...successfulInspectionByReview.values()];
  const failedInspectionCount = [...latestInspectionByReview.values()].filter(inspection =>
    inspection.status === '검수 실패' && inspection.guideVersion === projectGuideVersion).length;
  const productComplete = Boolean(project?.productName.trim() && project.productDescription.trim()
    && project.strengths.some(item => item.trim()) && project.targetCustomers.trim());
  const guideIsStale = Boolean(project?.guide && isReviewGuideStale(project.guide, project));
  const productReady = Boolean(project?.productName.trim()
    && project.productDescription.trim()
    && project.strengths.some(item => item.trim())
    && project.targetCustomers.trim());
  const currentStep = checkMode ? 4 : guideMode ? 3 : workflowStep;
  const projectStepLabel = !productComplete ? '상품 정보 입력'
    : !evaluationItems.length ? '평가 항목 설정'
      : project?.guide && guideIsStale ? '가이드 확인 필요'
        : !project?.guide ? '가이드 생성 전'
          : currentGuideInspections.length ? '검수 결과 있음'
            : '검수 대기';

  function navigateToStep(step: number) {
    if (reviewCheckBusy || busy) return;
    const next = Math.min(4, Math.max(1, step));
    setDashboardMode(false);
    setWorkflowStep(next <= 2 ? next : workflowStep);
    setGuideMode(next === 3);
    setCheckMode(next === 4);
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function getStepStatus(step: number): string {
    if (!project) return '미진행';
    if (step === 1) return productReady ? '완료' : '입력 필요';
    if (step === 2) {
      if (!reviews.length) return project.guide ? '건너뜀 · 선택' : '선택 · 건너뛸 수 있음';
      if (isAnalysisStale(project)) return '확인 필요';
      return results.length ? '완료' : '분석 필요';
    }
    if (step === 3) {
      if (!project.guide) return '미진행';
      return guideIsStale ? '확인 필요' : '완료';
    }
    if (!project.submittedReviews.length) return '초안 대기';
    if (failedInspectionCount) return `확인 필요 · 실패 ${failedInspectionCount}건`;
    if (currentGuideInspections.length >= project.submittedReviews.length) {
      return `완료 · ${currentGuideInspections.length}건`;
    }
    return currentGuideInspections.length
      ? `${currentGuideInspections.length}/${project.submittedReviews.length}건 완료`
      : '검수 대기';
  }

  function getRecommendedStep(candidate = project): number {
    if (!candidate) return 1;
    const isProductReady = Boolean(candidate.productName.trim() && candidate.productDescription.trim()
      && candidate.strengths.some(item => item.trim()) && candidate.targetCustomers.trim());
    if (!isProductReady) return 1;
    if (!candidate.evaluationItems.length) return 2;
    if (candidate.workspace.reviews.length && isAnalysisStale(candidate)) return 2;
    if (!candidate.guide || isReviewGuideStale(candidate.guide, candidate)) return 3;
    return 4;
  }

  async function openProject(id: string, resume: boolean) {
    if (project?.id !== id && !await storage.select(id)) return;
    resetView();
    navigateToStep(resume ? getRecommendedStep(storage.getCurrentProject() ?? undefined) : 1);
  }

  async function createProjectAndOpen(name: string): Promise<boolean> {
    if (disabled) return false;
    const created = await storage.create(name);
    if (!created) return false;
    resetView();
    navigateToStep(1);
    return true;
  }

  async function deleteProjectById(id: string, name: string) {
    if (!window.confirm(`“${name}” 프로젝트와 저장된 리뷰·가이드·검수 결과를 삭제할까요?`)) return;
    if (await storage.removeProject(id)) resetView();
  }

  async function renameProjectById(id: string, name: string) {
    if (!name.trim()) {
      setError('프로젝트 이름을 입력해 주세요.');
      return;
    }
    if (project?.id !== id && !await storage.select(id)) return;
    storage.rename(name.trim());
    try {
      await storage.saveNow();
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '프로젝트 이름을 저장하지 못했습니다.');
    }
  }

  async function goToDashboard() {
    if (reviewCheckBusy || busy) return;
    try {
      await storage.saveNow();
      setDashboardMode(true);
      setGuideMode(false);
      setCheckMode(false);
      setError('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '변경 사항을 저장하지 못해 대시보드로 이동하지 않았습니다.');
    }
  }

  async function saveAndNavigate(step: number) {
    if (!project) {
      setError('먼저 상품 프로젝트를 선택하거나 만들어 주세요.');
      return;
    }
    if (step === 2 && !productComplete) {
      setError('기존 리뷰 분석으로 이동하기 전에 필수 상품 정보와 목표 고객을 입력해 주세요.');
      return;
    }
    if (step >= 3 && (!productComplete || !evaluationItems.length)) {
      navigateToStep(!productComplete ? 1 : 2);
      setError('가이드를 만들기 전에 필수 상품 정보와 평가 항목을 준비해 주세요.');
      return;
    }
    try {
      await storage.saveNow();
      navigateToStep(step);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '저장에 실패해 다음 단계로 이동하지 않았습니다.');
    }
  }

  function resetView() {
    setTheme('전체');
    setSentiment('전체');
    setQuery('');
    setSort('기본순');
    setPage(1);
    setError('');
  }

  function updateAISettings(patch: Partial<AISettings> | { provider: AIProviderKind } | { model: string }) {
    if (!aiSettingsReady) return;
    const next: AISettings = {
      ...aiSettings,
      ...('provider' in patch ? { provider: patch.provider } : {}),
      models: {
        ...aiSettings.models,
        ...('models' in patch ? patch.models : {}),
        ...('model' in patch ? { [aiSettings.provider]: patch.model } : {}),
      },
    };
    setAISettings(next);
    setConnectionState('idle');
    setConnectionMessage('설정이 변경되었습니다. 연결을 다시 확인해 주세요.');
    const save = aiSettingsQueue.current.catch(() => {}).then(() => saveAISettings(next));
    aiSettingsQueue.current = save;
    void save.catch((reason: unknown) => {
      setConnectionState('error');
      setConnectionMessage(reason instanceof Error ? reason.message : 'AI 설정을 저장하지 못했습니다.');
    });
  }

  async function checkAIConnection(action: 'test' | 'models' = 'test') {
    if (aiSettings.provider === 'openai' && !key.trim()) {
      setConnectionState('disconnected');
      setConnectionMessage('OpenAI API 키를 입력해 주세요. 키는 이 탭의 메모리에만 유지됩니다.');
      return;
    }
    setConnectionState('checking');
    setConnectionMessage('AI 제공자와 모델 목록을 확인하고 있습니다.');
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          provider: aiSettings.provider,
          model: aiSettings.models[aiSettings.provider],
          ...(aiSettings.provider === 'openai' ? { key } : {}),
        }),
      });
      const data = await response.json() as { error?: string; code?: string; models?: string[]; modelAvailable?: boolean };
      if (!response.ok) {
        setConnectionState(data.code === 'ollama-model-missing'
          ? 'model-missing'
          : data.code === 'ollama-unavailable' ? 'disconnected' : 'error');
        setConnectionMessage(data.error || 'AI 연결을 확인하지 못했습니다.');
        return;
      }
      const models = Array.isArray(data.models) ? data.models.filter(item => typeof item === 'string') : [];
      setAvailableModels(models);
      if (aiSettings.provider === 'ollama' && (!models.length || !data.modelAvailable)) {
        setConnectionState('model-missing');
        setConnectionMessage(models.length
          ? 'Ollama는 연결되었지만 선택한 모델이 없습니다. 설치된 모델을 선택해 주세요.'
          : 'Ollama 서버는 연결되었지만 설치된 모델이 없습니다. Ollama 모델을 설치해 주세요.');
      } else {
        setConnectionState('connected');
        setConnectionMessage(aiSettings.provider === 'openai'
          ? `OpenAI 연결됨 · 모델 ${models.length}개 조회`
          : `Ollama 연결됨 · 모델 ${models.length}개 조회`);
      }
    } catch (reason: unknown) {
      setConnectionState(aiSettings.provider === 'ollama' ? 'disconnected' : 'error');
      setConnectionMessage(reason instanceof Error
        ? reason.message
        : '연결 요청에 실패했습니다. 네트워크와 개발 서버를 확인해 주세요.');
    }
  }

  function updateProduct<K extends ProductInputField>(field: K, value: string | string[]) {
    storage.updateProduct({ [field]: value });
  }

  function addEvaluationItem(title: string) {
    const normalized = title.trim();
    if (!normalized || evaluationItems.some(item => item.title.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
      return;
    }
    storage.updateProduct({ evaluationItems: [...evaluationItems, newEvaluationItem(normalized)] });
    setEvaluationDraft('');
  }

  function addTopicToEvaluation(topic: string) {
    addEvaluationItem(topic);
    setError('');
  }

  async function demo() {
    if (disabled || !window.confirm('현재 프로젝트는 변경하지 않습니다. 무선 이어폰 A 가상 시연 프로젝트를 별도로 추가할까요?')) return;
    const demoReviews = [
      '통학할 때 사용했는데 충전 없이 여러 번 사용할 수 있어서 편리했어요.',
      '음질은 괜찮지만 오랫동안 착용하면 귀가 조금 아팠어요.',
      '지하철에서 연결이 끊기는 경우가 가끔 있었어요.',
      '가볍고 휴대하기 편리했어요.',
    ].map((text, id) => ({
      id,
      text,
      rating: ['3', '2', '5', '2', '5'][id % 5],
      date: `2026-10-${String(id + 1).padStart(2, '0')}`,
      option: '무선 이어폰 · 화이트',
      sponsored: sponsored(text),
    }));
    const created = await storage.create('무선 이어폰 A · DevDay 가상 시연');
    if (!created) return;
    storage.updateProduct({
      productName: '무선 이어폰 A',
      productDescription: '통학과 일상적인 음악 감상에 사용할 수 있는 무선 이어폰',
      strengths: ['배터리 지속시간', '착용감', '이동 중 연결 안정성'],
      targetCustomers: '대학생 및 통학생',
      useSituations: ['등하교 통학', '지하철 이동', '일상적인 음악 감상'],
      evaluationItems: ['배터리 지속시간', '착용감', '연결 안정성']
        .map(title => ({ id: crypto.randomUUID(), title })),
    });
    storage.updateWorkspace('reviews', demoReviews);
    storage.updateWorkspace('file', '가상 시연 리뷰 · AI 분석 전');
    storage.updateWorkspace('rows', []);
    const demoAnalysis = createDemoAnalysis(demoReviews);
    storage.recordAnalysis({
      ...demoAnalysis,
      mode: '예시 데이터 · 모의 결과',
      notice: '가상 시연 리뷰에 대한 키워드 기반 모의 분류입니다. 감성을 판단하지 않으며 실제 고객 데이터나 AI 분석 결과가 아닙니다.',
    });
    setError('');
    resetView();
  }

  async function load(fileToLoad: File) {
    if (disabled || !project) return;
    setError('');
    setBusy(true);
    try {
      const data = await readReviewCSV(fileToLoad);
      storage.updateWorkspace('rows', data.rows);
      storage.updateWorkspace('mapping', data.mapping);
      storage.updateWorkspace('file', fileToLoad.name);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '파일을 읽지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function importRows() {
    const { reviews: importedReviews, skipped } = normalizeReviews(rows, mapping);
    if (!importedReviews.length) {
      setError('선택한 본문 열에 리뷰가 없습니다.');
      return;
    }
    storage.updateWorkspace('reviews', importedReviews);
    storage.updateWorkspace('rows', []);
    storage.recordAnalysis({
      results: [],
      themes: [],
      mode: '업로드 데이터',
      notice: `${importedReviews.length}건을 불러왔어요. 빈 본문·중복 ${skipped}건 제외. AI 분석 전에도 필터와 검색을 사용할 수 있어요.`,
    });
    resetView();
  }

  function analyzeDemo() {
    if (busy || !reviews.length) return;
    const demo = createDemoAnalysis(reviews);
    storage.recordAnalysis({
      ...demo,
      mode: '무료 데모 · 모의 결과',
      notice: '키워드 기반 화면 테스트용 모의 결과입니다. 감성은 분석하지 않았으며 실제 AI 분석이 아닙니다. API 호출·비용·외부 전송이 없습니다.',
    });
    setError('');
    resetView();
  }

  async function analyze() {
    if (!aiSettingsReady) {
      setError('AI 연결 설정을 불러오는 중입니다.');
      return;
    }
    if (aiSettings.provider === 'openai' && !key.trim()) {
      setSettings(true);
      setConnectionState('disconnected');
      setConnectionMessage('분석 전에 OpenAI API 키를 입력해 주세요.');
      return;
    }
    if (aiSettings.provider === 'ollama' && !aiSettings.models.ollama) {
      setSettings(true);
      setConnectionState('model-missing');
      setConnectionMessage('분석에 사용할 Ollama 모델을 선택한 뒤 연결을 확인해 주세요.');
      return;
    }
    if (!reviews.length || busy) return;
    setError('');
    setBusy(true);
    try {
      if (reviews.length > 100 || reviews.some(review => review.text.length > 4000)) {
        throw new Error('이번 버전은 최대 100건, 리뷰당 4,000자까지 AI 분석합니다.');
      }
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiSettings.provider,
          model: aiSettings.models[aiSettings.provider],
          ...(aiSettings.provider === 'openai' ? { key } : {}),
          reviews: reviews.map(({ id, text }) => ({ id, text })),
        }),
      });
      const data = await response.json() as {
        error?: string;
        results: Result[];
        themes: Theme[];
        dropped?: number;
        missingReviewIds?: number[];
        metadata?: { provider: AIProviderKind; model: string; analyzedAt: string };
      };
      if (!response.ok) throw new Error(data.error || 'AI 분석 요청이 실패했습니다.');
      storage.recordAnalysis({
        results: data.results,
        themes: data.themes,
        analysisMetadata: data.metadata,
        mode: 'AI 분석 완료',
        notice: `원문 근거를 검증한 분석 ${data.results.length}건${data.dropped ? ` · 유효하지 않은 결과 ${data.dropped}건 제외` : ''}${data.missingReviewIds?.length ? ` · 결과가 없는 리뷰 ${data.missingReviewIds.length}건` : ''}. 체험단 스위치는 집계 대상을 변경합니다.`,
      });
      resetView();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'AI 분석을 완료하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function selectTopic(topic: string, selectedSentiment = '전체') {
    setTheme(topic);
    setSentiment(selectedSentiment);
    setPage(1);
    reviewList.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function highlight(text: string, evidence: string) {
    const needle = query || evidence;
    if (!needle) return text;
    const index = text.toLowerCase().indexOf(needle.toLowerCase());
    if (index < 0) return text;
    return <>{text.slice(0, index)}<mark>{text.slice(index, index + needle.length)}</mark>{text.slice(index + needle.length)}</>;
  }

  function downloadSample() {
    const csv = ['리뷰,별점,작성일,옵션', ...demoTexts.map((text, index) =>
      `"${text.replaceAll('"', '""')}",${index % 2 ? 3 : 5},2026-10-01,화이트`)];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'demandlab_sample.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`shell ${dashboardMode ? 'dashboard-shell' : ''}`}>
      <aside>
        <div className="workspace">PRODUCT WORKSPACE</div>
        <button className={`nav ${dashboardMode ? 'active' : ''}`} aria-current={dashboardMode ? 'page' : undefined}
          disabled={navigationDisabled} onClick={() => void goToDashboard()}>
          <FolderKanban size={18} />프로젝트 대시보드
        </button>
        <button className={`nav ${!dashboardMode && currentStep === 1 ? 'active' : ''}`} aria-current={!dashboardMode && currentStep === 1 ? 'step' : undefined}
          disabled={navigationDisabled} onClick={() => navigateToStep(1)}>
          <BarChart3 size={18} />상품 정보<span>01</span>
        </button>
        <button className={`nav ${!dashboardMode && currentStep === 2 ? 'active' : ''}`} aria-current={!dashboardMode && currentStep === 2 ? 'step' : undefined}
          disabled={navigationDisabled} onClick={() => navigateToStep(2)}>
          <MessageSquare size={18} />리뷰 분석 <small>선택</small>
        </button>
        <button className={`nav ${!dashboardMode && currentStep === 3 ? 'active' : ''}`} aria-current={!dashboardMode && currentStep === 3 ? 'step' : undefined}
          disabled={navigationDisabled} onClick={() => navigateToStep(3)}>
          <ClipboardList size={18} />가이드 생성
        </button>
        <button className={`nav ${!dashboardMode && currentStep === 4 ? 'active' : ''}`} aria-current={!dashboardMode && currentStep === 4 ? 'step' : undefined}
          disabled={navigationDisabled} onClick={() => navigateToStep(4)}>
          <Check size={18} />리뷰 검수
        </button>
        <div className="sidebar-project">
          <span>현재 프로젝트</span>
          <strong title={project?.name || '선택된 프로젝트 없음'}>{project?.name || '선택된 프로젝트 없음'}</strong>
          <small>{projectStepLabel}</small>
        </div>
        <div className="side-bottom">
          <div className="mini-icon">O</div>
          <div><b>OEG</b><small>이정경 · 오지수</small></div>
          <span className="online" />
        </div>
      </aside>

      <main>
        <header>
          <Link className="header-brand" href="/" onClick={event => {
            event.preventDefault();
            void goToDashboard();
          }}>
            <span className="brand-icon"><FlaskConical size={18} /></span>DemandLab<span className="dot">.</span>
          </Link>
          <div className="header-context">
            <span>{dashboardMode ? '프로젝트 대시보드'
              : <>워크스페이스 <ChevronRight size={14} /> {currentStep === 1 ? '상품 정보'
                : currentStep === 2 ? '기존 리뷰 분석' : currentStep === 3 ? 'AI 리뷰 가이드' : '리뷰 검수'}</>}</span>
            <label className="header-project">
              <span>프로젝트</span>
              <select aria-label="워크스페이스 프로젝트 선택" value={project?.id ?? ''}
                disabled={!storage.ready || storage.managing || busy || reviewCheckBusy || !storage.projects.length}
                onChange={async event => {
                  if (await storage.select(event.target.value)) resetView();
                }}>
                {!project && <option value="">프로젝트 없음</option>}
                {storage.projects.map(item => <option key={item.id} value={item.id}>{item.name || '이름 없는 프로젝트'}</option>)}
              </select>
            </label>
          </div>
          <div className="header-actions">
            {!dashboardMode && <button className="plain" type="button" disabled={navigationDisabled}
              onClick={() => void goToDashboard()}><FolderKanban size={15} />프로젝트 목록</button>}
            <button className="plain" disabled={!aiSettingsReady || reviewCheckBusy}
              onClick={() => setSettings(true)}><KeyRound size={15} />AI 연결 설정</button>
          </div>
        </header>
        {dashboardMode ? <ProjectDashboard
          projects={storage.projects}
          activeProjectId={project?.id}
          ready={storage.ready}
          managing={storage.managing}
          status={storage.status}
          error={error || storage.storageError}
          onCreate={name => createProjectAndOpen(name)}
          onOpen={(id, resume) => void openProject(id, resume)}
          onRename={renameProjectById}
          onDelete={deleteProjectById}
          onRetry={storage.retry}
        /> : <>
        <nav className="workflow-steps" aria-label="프로젝트 진행 단계">
          {[
            { step: 1, title: '상품 정보', detail: '상품·강점·타깃' },
            { step: 2, title: '리뷰 분석', detail: '선택 · 기존 고객 리뷰' },
            { step: 3, title: '가이드 생성', detail: '테스트·작성 안내' },
            { step: 4, title: '리뷰 검수', detail: '초안·피드백' },
          ].map(item => (
            <button type="button" key={item.step}
              className={`workflow-step ${currentStep === item.step ? 'current' : ''} ${getStepStatus(item.step).startsWith('완료') ? 'visited' : ''}`}
              aria-current={currentStep === item.step ? 'step' : undefined}
              disabled={navigationDisabled}
              onClick={() => navigateToStep(item.step)}>
              <span className="workflow-step-number">{item.step}</span>
              <span className="workflow-step-copy"><strong>{item.title}</strong><small>{getStepStatus(item.step)}</small></span>
              {getStepStatus(item.step).startsWith('완료') && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </nav>

        {currentStep === 3 ? <GuideWorkspace
          project={project}
          settings={aiSettings}
          apiKey={key}
          settingsReady={aiSettingsReady}
          onOpenSettings={() => setSettings(true)}
          onBack={() => navigateToStep(2)}
          onSaveGuide={storage.updateGuideForProject}
          saveNow={storage.saveNow}
          storageStatus={storage.status}
          storageError={storage.storageError}
        /> : currentStep === 4 ? <ReviewCheckWorkspace
          key={project?.id ?? 'no-project'}
          project={project}
          settings={aiSettings}
          apiKey={key}
          onOpenSettings={() => setSettings(true)}
          onOpenGuide={() => navigateToStep(3)}
          onBackToGuide={() => navigateToStep(3)}
          onBackToAnalysis={() => navigateToStep(1)}
          onSaveInputs={storage.saveReviewInputs}
          onSaveResults={storage.saveReviewCheckResults}
          onRemoveReview={storage.removeReviewSubmission}
          onClearReviews={storage.clearReviewSubmissions}
          saveNow={storage.saveNow}
          storageStatus={storage.status}
          storageError={storage.storageError}
          onBusyChange={setReviewCheckBusy}
        /> : <section className="content">
          <div className="title-row">
            <div>
              <div className="eyebrow">{workflowStep === 1 ? 'PRODUCT SETUP' : 'OPTIONAL REVIEW INSIGHTS'}</div>
              <h1>{workflowStep === 1 ? '상품과 목표 고객을 설정하세요.' : '기존 고객의 경험을 평가 항목에 반영하세요.'}</h1>
              <p>{workflowStep === 1 ? '상품 정보는 현재 프로젝트에 자동 저장됩니다.'
                : '기존 리뷰가 없어도 이 단계를 건너뛰고 직접 평가 항목을 정할 수 있습니다.'}</p>
            </div>
            {project && <span className="project-stage-badge" title={project.name}>{project.name}</span>}
          </div>

          {error && <div role="alert" className="error">{error}</div>}
          {storage.storageError && <div className="error" role="alert">
            {storage.storageError}<button className="plain" onClick={storage.retry}>다시 시도</button>
          </div>}
          {workflowStep === 1 && <>
          <fieldset className="workspace-fields" disabled={disabled || !project}>
            <section className="dashboard-card" id="product-settings">
              <div className="section-title">
                <div><h2>상품과 타깃 정보</h2><p>입력 내용은 현재 프로젝트에 자동 저장됩니다. 별표 항목은 가이드 생성에 필요합니다.</p></div>
                <small className="storage-state" role="status">{storage.status}</small>
              </div>
              <div className="product-form-grid">
                <label>상품명 <span className="required">필수</span>
                  <input required aria-required="true" value={project?.productName ?? ''} maxLength={160} placeholder="예: 노이즈 캔슬링 무선 이어폰"
                    onChange={event => updateProduct('productName', event.target.value)} />
                </label>
                <label className="wide-field">상품 설명 또는 주요 특징 <span className="required">필수</span>
                  <textarea required aria-required="true" rows={3} value={project?.productDescription ?? ''}
                    placeholder="상품이 어떤 제품인지, 확인된 주요 특징이 무엇인지 적어 주세요."
                    onChange={event => updateProduct('productDescription', event.target.value)} />
                </label>
                <label>강조하고 싶은 상품 강점 <span className="required">필수 · 줄마다 한 항목</span>
                  <textarea required aria-required="true" rows={4} value={(project?.strengths ?? []).join('\n')}
                    placeholder={'예: 가벼운 착용감\n예: 긴 배터리 사용 시간'}
                    onChange={event => updateProduct('strengths', splitLines(event.target.value))} />
                </label>
                <label>목표 고객층 <span className="required">필수</span>
                  <textarea required aria-required="true" rows={4} value={project?.targetCustomers ?? ''}
                    placeholder={'예: 출퇴근길에 음악을 듣는 직장인\n예: 장시간 온라인 수업을 듣는 학생'}
                    onChange={event => updateProduct('targetCustomers', event.target.value)} />
                </label>
                <label>주요 사용 상황 <span className="optional">선택 · 줄마다 한 항목</span>
                  <textarea rows={3} value={(project?.useSituations ?? []).join('\n')}
                    placeholder={'예: 지하철 출퇴근\n예: 운동 중 통화'}
                    onChange={event => updateProduct('useSituations', splitLines(event.target.value))} />
                </label>
              </div>
              {project && isAnalysisStale(project) && <div className="stale-notice" role="status">
                상품 정보 또는 리뷰 데이터가 분석 이후 변경되었습니다. 기존 결과는 보존되어 있으며 최신 상태가 아닐 수 있습니다.
                실제 AI 분석을 다시 실행하면 업데이트됩니다.
              </div>}
            </section>
          </fieldset>
          </>}

          {workflowStep === 2 && <fieldset className="workspace-fields" disabled={disabled || !project}>
            <section className="optional-step-note">
              <strong>기존 리뷰 분석은 선택 사항입니다.</strong>
              <span>리뷰가 없다면 건너뛰어도 상품 정보와 직접 설정한 평가 항목으로 가이드를 만들 수 있습니다.</span>
            </section>
            <section className="dashboard-card" id="evaluation-settings">
              <div className="section-title">
                <div><h2>B. 기존 고객 리뷰 분석 <span className="optional">선택</span></h2>
                  <p>CSV/TSV를 올리면 본문·별점·날짜·옵션 열을 확인한 뒤 리뷰를 불러옵니다.</p></div>
                <button className="text-button" type="button" onClick={downloadSample}><Download size={14} />예시 CSV 다운로드</button>
              </div>
              <div className="upload-panel"
                onDragOver={event => event.preventDefault()}
                onDrop={event => { event.preventDefault(); if (event.dataTransfer.files[0]) void load(event.dataTransfer.files[0]); }}>
                <div className="upload-icon"><Upload size={24} /></div>
                <div className="upload-copy">
                  <h3>기존 고객 리뷰 파일</h3>
                  <p>CSV 또는 TSV · UTF-8 / EUC-KR · 최대 5MB</p>
                </div>
                <button className="primary" type="button" onClick={() => input.current?.click()}><Upload size={16} />파일 선택</button>
                <input ref={input} type="file" accept=".csv,.tsv" hidden
                  onChange={event => {
                    if (event.target.files?.[0]) void load(event.target.files[0]);
                    event.target.value = '';
                  }} />
              </div>

              {rows.length > 0 && <div className="mapping">
                <h3>열 연결 확인 <small>{rows.length - 1}개 행</small></h3>
                <div className="map-grid">
                  {(['text', 'rating', 'date', 'option'] as const).map((field, index) => (
                    <label key={field}>{['리뷰 본문 *', '별점', '작성일', '구매 옵션'][index]}
                      <select value={mapping[field]} onChange={event =>
                        storage.updateWorkspace('mapping', { ...mapping, [field]: Number(event.target.value) })}>
                        {field !== 'text' && <option value={-1}>사용 안 함</option>}
                        {rows[0].map((heading, column) =>
                          <option key={column} value={column}>{heading || `열 ${column + 1}`}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <p className="sample-line">미리보기: {rows[1]?.[mapping.text] || '본문 열을 선택해 주세요.'}</p>
                <button className="primary" type="button" onClick={importRows}>리뷰 불러오기 <ArrowRight size={16} /></button>
                <button className="plain" type="button" onClick={() => storage.updateWorkspace('rows', [])}>취소</button>
              </div>}

              {error && <div role="alert" className="error">{error}</div>}
              {!reviews.length && rows.length === 0 && <div className="empty review-empty">
                <strong>기존 리뷰가 없어도 다음 단계 준비를 계속할 수 있어요.</strong>
                <p>리뷰 분석은 선택 사항입니다. 현재 프로젝트는 유지하고 가상 상품·리뷰가 담긴 별도 시연 프로젝트를 추가할 수 있어요.</p>
                <button className="dark" type="button" disabled={disabled} onClick={() => void demo()}>새 가상 시연 프로젝트 만들기 <ArrowUpRight size={16} /></button>
              </div>}
              {reviews.length > 0 && <>
                <div className="dataset">
                  <div><span className="badge">{mode || '업로드 데이터'}</span><h2>{file || '상품 리뷰'}</h2>
                    {storage.workspace.analysisMetadata && <small className="analysis-meta">
                      {storage.workspace.analysisMetadata.provider === 'openai' ? 'OpenAI' : 'Ollama'}
                      {' · '}{storage.workspace.analysisMetadata.model}
                      {' · '}{new Date(storage.workspace.analysisMetadata.analyzedAt).toLocaleString('ko-KR')}
                    </small>}
                  </div>
                  <div className="dataset-actions">
                    <button disabled={busy} className="plain" type="button" onClick={analyzeDemo}>무료 데모 분석 (모의)</button>
                    <button disabled={busy} className="primary" type="button" onClick={analyze}>
                      {busy ? 'AI가 주제와 근거를 분석하고 있어요…'
                        : `실제 AI 분석 · ${aiSettings.provider === 'openai' ? 'OpenAI' : 'Ollama'}`}
                      <FlaskConical size={16} />
                    </button>
                  </div>
                </div>
                <div className="notice">{notice}</div>
                <div className="analysis-disclosure">
                  실제 AI 분석은 리뷰 본문을 분석합니다. 상품 설명·강점·타깃 정보는 이번 요청에 전달되지 않으며,
                  리뷰에 없는 결론을 보태지 않습니다. 예시·무료 데모 결과는 실제 AI 분석과 구분됩니다.
                </div>
                <div className="metrics">
                  <div><span>불러온 리뷰</span><strong>{reviews.length.toLocaleString()}<small>건</small></strong></div>
                  <div><span>분석 대상</span><strong>{active.length.toLocaleString()}<small>건</small></strong></div>
                  <div><span>체험단 제외</span><strong>{exclude ? reviews.filter(review => review.sponsored).length : 0}<small>건</small></strong></div>
                  <div><span>발견한 주제</span><strong>{stats.length}<small>개</small></strong></div>
                </div>

                <div className="section-title">
                  <div><h2>C. 고객 리뷰에서 확인된 주제</h2><p>긍정·부정 반응과 실제 원문 근거를 함께 확인하세요.</p></div>
                  <label className="toggle">
                    <input type="checkbox" checked={exclude} onChange={event => {
                      storage.updateWorkspace('exclude', event.target.checked);
                      setPage(1);
                    }} /><span />체험단 리뷰 제외
                  </label>
                </div>
                <div className="legend">
                  {sentiments.map(item => <span key={item}><i className={item} />{item}</span>)}
                  <small>각 주제를 언급한 리뷰 기준 · 주제 간 중복 가능</small>
                </div>
                <div className="theme-grid">
                  {stats.map((item, index) => {
                    const counts = sentiments.map(label => ({
                      label,
                      count: item.items.filter(result => result.sentiment === label).length,
                    }));
                    const evidenceResults = item.items.slice(0, 2);
                    return <article className={`theme-card ${theme === item.name ? 'selected' : ''}`} key={item.name}>
                      <button className="theme-head" type="button" onClick={() => selectTopic(item.name)}>
                        <span className="theme-num">{String(index + 1).padStart(2, '0')}</span>
                        <b>{item.name}</b>
                        <span>{item.items.length}건 <ArrowUpRight size={15} /></span>
                      </button>
                      <p>{[...new Set(item.items.map(result => result.subtheme))].join(' · ')}</p>
                      <div className="stack">
                        {counts.map(({ label, count }) => count > 0 && <button key={label} className={label}
                          style={{ width: `${count / item.items.length * 100}%` }}
                          aria-label={`${item.name} ${label} ${count}건`}
                          title={`${label} ${count}건`} type="button" onClick={() => selectTopic(item.name, label)} />)}
                      </div>
                      <div className="sentiment-counts">
                        {counts.map(({ label, count }) => <span key={label}><i className={label} />{label} {count}</span>)}
                      </div>
                      <div className="theme-evidence">
                        {evidenceResults.map((result, evidenceIndex) => {
                          const source = reviews.find(review => review.id === result.id);
                          return <blockquote key={`${result.id}-${evidenceIndex}`}>
                            <span className={`tag ${result.sentiment}`}>{result.sentiment}</span>
                            <b>{result.subtheme}</b>
                            <p>“{result.evidence}”</p>
                            <small>{source ? `리뷰 #${source.id + 1} 원문 근거` : '원문 리뷰를 찾을 수 없음'}</small>
                          </blockquote>;
                        })}
                      </div>
                      <button className="text-button topic-add" type="button"
                        onClick={() => addTopicToEvaluation(item.name)}>
                        <Plus size={14} />핵심 평가 항목에 추가
                      </button>
                    </article>;
                  })}
                </div>
                {!stats.length && <div className="empty">
                  분석 결과가 아직 없습니다. AI 분석을 실행하거나, 원문 탐색 및 검색은 리뷰 불러오기 직후 사용할 수 있습니다.
                </div>}

                <div ref={reviewList} className="review-section">
                  <div className="section-title">
                    <div><h2>원문에서 직접 확인하세요 <span className="count">{shown.length}</span></h2>
                      <p>AI의 해석은 참고하고, 판단은 실제 사용 경험과 원문을 바탕으로 하세요.</p></div>
                    <button className="plain" type="button" onClick={() => {
                      setTheme('전체'); setSentiment('전체'); setQuery(''); setPage(1);
                    }}>필터 초기화</button>
                  </div>
                  <div className="filters">
                    <div className="search"><Search size={18} /><input aria-label="리뷰 키워드 검색"
                      placeholder="궁금한 키워드를 검색하세요. 예: 발열, 통화" value={query}
                      onChange={event => { setQuery(event.target.value); setPage(1); }} /></div>
                    <select aria-label="주제 필터" value={theme} onChange={event => {
                      setTheme(event.target.value); setPage(1);
                    }}>
                      <option>전체</option>{themes.map(item => <option key={item.name}>{item.name}</option>)}
                    </select>
                    <select aria-label="감정 필터" value={sentiment} onChange={event => {
                      setSentiment(event.target.value); setPage(1);
                    }}>{['전체', ...sentiments].map(item => <option key={item}>{item}</option>)}</select>
                    <select aria-label="정렬" value={sort} onChange={event => setSort(event.target.value)}>
                      {['기본순', '낮은 별점순', '최신순'].map(item => <option key={item}>{item}</option>)}
                    </select>
                  </div>
                  <div className="scope"><SlidersHorizontal size={13} />
                    {theme === '전체' ? '전체 주제' : theme} · {sentiment === '전체' ? '모든 반응' : sentiment}
                    · {exclude ? '체험단 제외' : '체험단 포함'}
                  </div>
                  {shown.slice(0, page * 12).map(review => {
                    const reviewResults = filteredResults.filter(result =>
                      result.id === review.id && (theme === '전체' || result.theme === theme));
                    return <article className="review" key={review.id}>
                      <div className="review-top">
                        <span className="stars">{review.rating ? `★ ${review.rating}` : '별점 없음'}</span>
                        <span>{review.date || '날짜 없음'}</span><span>{review.option}</span>
                        {review.sponsored && <span className="sponsor">체험단 표시</span>}
                        <small>#{review.id + 1}</small>
                      </div>
                      <p>{highlight(review.text, reviewResults[0]?.evidence || '')}</p>
                      <div className="review-tags">{reviewResults.map(result =>
                        <button key={result.theme} type="button" onClick={() => selectTopic(result.theme, result.sentiment)}>
                          <span className={`tag ${result.sentiment}`}>{result.sentiment}</span>
                          {result.theme}<span className="subtheme">{result.subtheme}</span>
                        </button>)}</div>
                    </article>;
                  })}
                  {!shown.length && <div className="empty">선택한 조건에 맞는 리뷰가 없습니다.</div>}
                  {shown.length > page * 12 && <button className="more" type="button" onClick={() => setPage(page + 1)}>
                    리뷰 더 보기 ({Math.min(page * 12, shown.length)} / {shown.length})
                  </button>}
                </div>
              </>}
            </section>

            <section className="dashboard-card">
              <div className="section-title">
                <div><h2>D. 핵심 평가 항목</h2>
                  <p>리뷰단이 실제로 확인할 주제와 조건입니다. 긍정적인 결론을 미리 정하지 않습니다.</p></div>
              </div>
              <form className="evaluation-add" onSubmit={event => {
                event.preventDefault();
                addEvaluationItem(evaluationDraft);
              }}>
                <label htmlFor="evaluation-draft">평가 항목 직접 추가</label>
                <div><input id="evaluation-draft" value={evaluationDraft} maxLength={120}
                  placeholder="예: 이동 중 연결 안정성" onChange={event => setEvaluationDraft(event.target.value)} />
                  <button className="primary" type="submit" disabled={!evaluationDraft.trim()}><Plus size={16} />추가</button>
                </div>
              </form>
              {evaluationItems.length
                ? <ul className="evaluation-list">{evaluationItems.map(item =>
                  <li key={item.id}>
                    <input aria-label="평가 항목 이름" value={item.title} maxLength={120}
                      onChange={event => storage.updateProduct({
                        evaluationItems: evaluationItems.map(current =>
                          current.id === item.id ? { ...current, title: event.target.value } : current),
                      })} />
                    <button className="plain" type="button" aria-label={`${item.title} 삭제`}
                      onClick={() => storage.updateProduct({
                        evaluationItems: evaluationItems.filter(current => current.id !== item.id),
                      })}><Trash2 size={16} />삭제</button>
                  </li>)}</ul>
                : <div className="empty">직접 항목을 추가하거나 위 주제 카드에서 평가 항목으로 가져올 수 있습니다.</div>}
              <p className="evaluation-note"><Check size={15} />선택한 {evaluationItems.length}개 항목은 현재 상품 프로젝트에 저장되며, 다음 단계에서 리뷰단 가이드의 입력으로 사용할 수 있습니다.</p>
            </section>

          </fieldset>
          }

          <footer><span className="footer-brand">DemandLab.</span><span>실제 경험에 근거한 상품 분석</span><span>Built by OEG</span></footer>
        </section>
        }
        <div className="workflow-footer">
          <button className="plain" type="button" disabled={navigationDisabled}
            onClick={() => currentStep === 1 ? void goToDashboard()
              : currentStep === 4 ? saveAndNavigate(3) : saveAndNavigate(currentStep - 1)}>
            {currentStep === 1 ? '프로젝트 목록' : '이전 단계'}
          </button>
          <div className="workflow-footer-copy" role="status">
            <strong>{currentStep === 1 ? '상품 정보는 자동 저장됩니다.'
              : currentStep === 2 ? !reviews.length ? '기존 리뷰 분석은 선택 사항입니다.'
                : '분석 결과와 평가 항목은 현재 프로젝트에 저장됩니다.'
                : currentStep === 3 ? '가이드를 확인·수정한 뒤 저장하고 리뷰단에 전달하세요.'
                  : '저장된 검수 결과를 다시 보거나 새 초안을 추가할 수 있습니다.'}</strong>
            <small>{currentStep === 1 ? '필수 정보를 입력하면 다음 단계로 이동할 수 있습니다.'
              : currentStep === 2 ? '리뷰를 분석하지 않아도 설정한 평가 항목으로 가이드를 만들 수 있습니다.'
                : currentStep === 3 ? '리뷰 검수는 저장된 가이드가 있을 때 사용할 수 있습니다.'
                  : 'AI 호출 없이 이전 결과를 확인하고 이어서 검수할 수 있습니다.'}</small>
          </div>
          {currentStep === 2 && reviews.length > 0 && <button className="plain workflow-skip" type="button"
            disabled={navigationDisabled || !productComplete || !evaluationItems.length}
            onClick={() => void saveAndNavigate(3)}>리뷰 분석 건너뛰기</button>}
          <button className="primary" type="button" disabled={navigationDisabled || (
            currentStep === 1 ? !productComplete
              : currentStep === 2 ? !productComplete || !evaluationItems.length
                : currentStep === 3 ? !project?.guide : false
          )} onClick={() => {
            if (currentStep === 1) void saveAndNavigate(2);
            else if (currentStep === 2) void saveAndNavigate(3);
            else if (currentStep === 3) void saveAndNavigate(4);
            else void goToDashboard();
          }}>
            {currentStep === 1 ? '다음: 기존 리뷰 분석'
              : currentStep === 2 ? !reviews.length ? '기존 리뷰 없이 가이드 준비'
                : '다음: 가이드 생성'
                : currentStep === 3 ? '다음: 리뷰 검수'
                  : '프로젝트 대시보드'} <ArrowRight size={16} />
          </button>
        </div>
        </>}
      </main>

      {settings && <div className="modal-backdrop">
        <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="modal">
          <button className="close" aria-label="닫기" onClick={() => setSettings(false)}><X /></button>
          <KeyRound className="modal-icon" />
          <h2 id="settings-title">AI 연결 설정</h2>
          <p>실제 리뷰 분석에 사용할 AI 제공자와 모델을 선택합니다. 설정에는 제공자와 모델만 저장됩니다.</p>
          <label>AI 제공자
            <select value={aiSettings.provider} onChange={event => {
              const provider = event.target.value as AIProviderKind;
              updateAISettings({ provider });
              setAvailableModels([]);
            }}>
              <option value="openai">OpenAI API · 클라우드</option>
              <option value="ollama">Ollama · 이 컴퓨터의 로컬 모델</option>
            </select>
          </label>

          {aiSettings.provider === 'openai' ? <>
            <label>OpenAI API 키
              <input type="password" autoComplete="off" value={key}
                onChange={event => {
                  setKey(event.target.value);
                  setConnectionState('idle');
                  setConnectionMessage('API 키가 변경되었습니다. 연결을 확인해 주세요.');
                }} placeholder="sk-…" />
            </label>
            <small>기본 모델은 gpt-4.1-mini입니다. 키는 현재 탭 메모리에만 유지하며 브라우저 저장소에 저장하지 않습니다.
              실제 분석 시 리뷰 본문만 OpenAI로 전송되고 사용 비용이 발생할 수 있습니다.</small>
            <label>분석 모델
              <select value={aiSettings.models.openai} onChange={event => updateAISettings({ model: event.target.value })}>
                {[...new Set([aiSettings.models.openai, ...availableModels].filter(Boolean))].map(model =>
                  <option key={model} value={model}>{model}{model === 'gpt-4.1-mini' ? ' · 기본값' : ''}</option>)}
              </select>
            </label>
          </> : <>
            <label>로컬 Ollama 서버 주소
              <input value={OLLAMA_BASE_URL} readOnly aria-readonly="true" />
            </label>
            <small>요청은 로컬 Vinext 서버가 Ollama로 전달합니다. 서버 주소는 보안상 127.0.0.1:11434로 고정되며,
              Cloudflare Worker 배포 환경의 localhost는 사용자 컴퓨터를 가리키지 않습니다.</small>
            <label>설치된 모델
              <select value={aiSettings.models.ollama} onChange={event => updateAISettings({ model: event.target.value })}>
                {!availableModels.length && <option value="">모델 목록을 먼저 조회하세요</option>}
                {aiSettings.models.ollama && !availableModels.includes(aiSettings.models.ollama)
                  && <option value={aiSettings.models.ollama}>{aiSettings.models.ollama} · 목록에 없음</option>}
                {availableModels.map(model => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
          </>}

          <div className={`connection-status ${connectionState}`} role="status" aria-live="polite">
            <b>{connectionState === 'checking' ? '연결 확인 중'
              : connectionState === 'connected' ? '연결됨'
                : connectionState === 'model-missing' ? '모델 미설치'
                  : connectionState === 'disconnected' ? '연결되지 않음'
                    : connectionState === 'error' ? '오류 발생' : '연결 확인 필요'}</b>
            <span>{connectionMessage}</span>
          </div>
          <div className="connection-actions">
            <button className="primary" type="button" disabled={connectionState === 'checking'}
              onClick={() => void checkAIConnection('test')}>연결 테스트 및 모델 조회</button>
            <button className="plain" type="button" disabled={connectionState === 'checking'}
              onClick={() => void checkAIConnection('models')}>모델 목록 새로고침</button>
          </div>
          <small>무료 예시 분석은 AI 연결 없이 작동합니다. 로컬 AI는 최대 100건 · 리뷰당 4,000자까지 보냅니다.
            상품 정보나 타깃은 리뷰 분석 요청에 포함되지 않습니다.</small>
          <button className="primary full" type="button" onClick={() => setSettings(false)}>설정 완료</button>
          {key && aiSettings.provider === 'openai'
            && <button className="text-button" type="button" onClick={() => {
              setKey('');
              setConnectionState('idle');
              setConnectionMessage('API 키를 지웠습니다.');
            }}>현재 탭의 API 키 지우기</button>}
        </div>
      </div>}
    </div>
  );
}
