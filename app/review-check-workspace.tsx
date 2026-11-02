'use client';

import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ClipboardList, FileSpreadsheet, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { AIProviderKind, AISettings } from '../lib/ai/types';
import type {
  ProductProject, ReviewGuide, ReviewInspection, ReviewSubmission,
} from '../lib/types';
import { isReviewGuideStale } from '../lib/guide';
import { readReviewCSV } from '../lib/csv';
import { buildReviewInspectionCSV } from '../lib/review-inspection-csv';

const API_BATCH_SIZE = 3;
const MAX_PROJECT_REVIEWS = 50;
const MAX_REVIEW_LENGTH = 6000;

type Props = {
  project: ProductProject | null;
  settings: AISettings;
  apiKey: string;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
  onBackToGuide: () => void;
  onBackToAnalysis: () => void;
  onSaveInputs: (reviews: ReviewSubmission[]) => void;
  onSaveResults: (reviews: ReviewSubmission[], results: ReviewInspection[]) => void;
  onRemoveReview: (id: string) => void;
  onClearReviews: () => void;
  saveNow: () => Promise<void>;
  storageStatus: string;
  storageError: string;
  onBusyChange: (busy: boolean) => void;
};

function isStructuredGuide(guide: ReviewGuide | undefined): guide is ReviewGuide & {
  testItems: NonNullable<ReviewGuide['testItems']>;
} {
  return Boolean(guide && Array.isArray(guide.testItems) && guide.testItems.length > 0);
}

function downloadCSV(project: ProductProject, inspections: ReviewInspection[]) {
  const url = URL.createObjectURL(new Blob([buildReviewInspectionCSV(inspections)], {
    type: 'text/csv;charset=utf-8',
  }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${project.productName || project.name}_리뷰검수.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createFailure(
  review: ReviewSubmission,
  guideVersion: string,
  provider: AIProviderKind,
  model: string,
  error: string,
): ReviewInspection {
  return {
    reviewId: review.id,
    ...(review.authorId ? { authorId: review.authorId } : {}),
    text: review.text,
    status: '검수 실패',
    satisfiedCount: 0,
    partialCount: 0,
    missingCount: 0,
    unknownCount: 0,
    notApplicableCount: 0,
    summary: 'AI 검수 요청을 완료하지 못했습니다.',
    needsRevision: false,
    specificity: '판단 불가',
    conflicts: [],
    unsupportedClaims: [],
    disclosure: { status: '판단 불가', evidence: '', feedback: '' },
    items: [],
    guideVersion,
    provider,
    model,
    inspectedAt: new Date().toISOString(),
    error,
  };
}

function statusClass(status: ReviewInspection['status'] | '미검수') {
  if (status === '문제 없음') return 'inspection-status clear';
  if (status === '보완 필요') return 'inspection-status revise';
  if (status === '검수 실패') return 'inspection-status failed';
  return 'inspection-status pending';
}

export default function ReviewCheckWorkspace({
  project, settings, apiKey, onOpenSettings, onOpenGuide,
  onSaveInputs, onSaveResults, onRemoveReview, onClearReviews, saveNow,
  storageStatus, storageError, onBusyChange, onBackToGuide, onBackToAnalysis,
}: Props) {
  const [singleText, setSingleText] = useState('');
  const [authorId, setAuthorId] = useState('');
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvName, setCsvName] = useState('');
  const [bodyColumn, setBodyColumn] = useState(0);
  const [authorColumn, setAuthorColumn] = useState(-1);
  const [fileError, setFileError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [filter, setFilter] = useState<'전체' | '보완 필요' | '문제 없음' | '검수 실패'>('전체');
  const [selectedId, setSelectedId] = useState('');
  const [viewingPrevious, setViewingPrevious] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const guide = project?.guide;
  const usableGuide = isStructuredGuide(guide);
  const guideVersion = guide ? (guide.updatedAt || guide.generatedAt) : '';

  const inspectionsById = useMemo(() => {
    const latest = new Map<string, ReviewInspection>();
    for (const result of project?.inspections ?? []) {
      if (typeof result.reviewId !== 'string') continue;
      const previous = latest.get(result.reviewId);
      if (!previous || result.inspectedAt >= previous.inspectedAt) latest.set(result.reviewId, result);
    }
    return latest;
  }, [project?.inspections]);
  const latestResults = (project?.submittedReviews ?? []).flatMap(review => {
    const result = inspectionsById.get(review.id);
    return result && result.status !== '검수 실패' && result.guideVersion === guideVersion ? [result] : [];
  });
  const selected = project?.submittedReviews.find(review => review.id === selectedId)
    ?? project?.submittedReviews.find(review => inspectionsById.has(review.id));
  const selectedLatestInspection = selected ? inspectionsById.get(selected.id) : undefined;
  const previousSuccessfulInspection = selected && selectedLatestInspection?.status === '검수 실패'
    ? project?.inspections.filter(result => result.reviewId === selected.id && result.status !== '검수 실패')
      .sort((left, right) => right.inspectedAt.localeCompare(left.inspectedAt))[0]
    : undefined;
  const selectedInspection = viewingPrevious && previousSuccessfulInspection
    ? previousSuccessfulInspection
    : selectedLatestInspection;
  const totalNeeded = (project?.submittedReviews ?? []).filter(review => {
    const result = inspectionsById.get(review.id);
    return !result || result.status === '검수 실패' || result.guideVersion !== guideVersion;
  }).length;
  const failedCount = (project?.submittedReviews ?? []).filter(review =>
    inspectionsById.get(review.id)?.status === '검수 실패').length;
  const revisionCount = latestResults.filter(result => result.status === '보완 필요').length;
  const clearCount = latestResults.filter(result => result.status === '문제 없음').length;
  const visibleReviews = (project?.submittedReviews ?? []).filter(review => {
    const result = inspectionsById.get(review.id);
    if (filter === '전체') return true;
    if (filter === '검수 실패') return result?.status === '검수 실패';
    if (result?.guideVersion !== guideVersion) return false;
    return result?.status === filter;
  });
  const readyForInspection = Boolean(project && usableGuide
    && (project.productName.trim() || guide?.productName?.trim())
    && project.productDescription.trim());

  async function importCSV(file: File) {
    setFileError('');
    try {
      const { rows, mapping } = await readReviewCSV(file);
      setCsvRows(rows);
      setCsvName(file.name);
      setBodyColumn(mapping.text);
      setAuthorColumn(rows[0].findIndex(header => /작성자|아이디|사용자|닉네임|author|user.?id/i.test(header)));
    } catch (reason) {
      setFileError(reason instanceof Error ? reason.message : 'CSV/TSV 파일을 읽지 못했습니다.');
      setCsvRows([]);
    }
  }

  function addSubmissions(reviews: ReviewSubmission[]): boolean {
    if (!project || !reviews.length) return false;
    const existing = new Set(project.submittedReviews.map(review => review.id));
    const unique = reviews.filter(review => !existing.has(review.id));
    if (project.submittedReviews.length + unique.length > MAX_PROJECT_REVIEWS) {
      setError(`한 프로젝트에는 최대 ${MAX_PROJECT_REVIEWS}건까지 검수 대기 리뷰를 저장할 수 있습니다.`);
      return false;
    }
    if (!unique.length) {
      setError('추가할 수 있는 새 리뷰가 없습니다.');
      return false;
    }
    onSaveInputs(unique);
    setNotice(`${unique.length}건의 검수 초안을 현재 상품 프로젝트에 저장했습니다.`);
    setError('');
    setSelectedId(unique[0].id);
    return true;
  }

  function addSingleReview() {
    const text = singleText.trim();
    if (!text) {
      setError('검수할 리뷰 본문을 입력해 주세요.');
      return;
    }
    if (text.length > MAX_REVIEW_LENGTH) {
      setError(`리뷰 본문은 ${MAX_REVIEW_LENGTH.toLocaleString()}자까지 입력할 수 있습니다.`);
      return;
    }
    const added = addSubmissions([{
      id: crypto.randomUUID(),
      ...(authorId.trim() ? { authorId: authorId.trim().slice(0, 120) } : {}),
      text,
      submittedAt: new Date().toISOString(),
    }]);
    if (added) {
      setSingleText('');
      setAuthorId('');
    }
  }

  function addCSVReviews() {
    if (!project || csvRows.length < 2) return;
    const createdAt = new Date().toISOString();
    const reviews = csvRows.slice(1).flatMap(row => {
      const text = (row[bodyColumn] ?? '').trim();
      if (!text) return [];
      if (text.length > MAX_REVIEW_LENGTH) return [];
      const author = authorColumn >= 0 ? (row[authorColumn] ?? '').trim().slice(0, 120) : '';
      return [{
        id: crypto.randomUUID(),
        ...(author ? { authorId: author } : {}),
        text,
        submittedAt: createdAt,
      }];
    });
    const skipped = csvRows.length - 1 - reviews.length;
    if (addSubmissions(reviews)) {
      setNotice(`${reviews.length}건을 가져왔습니다.${skipped ? ` 빈 리뷰 또는 ${MAX_REVIEW_LENGTH.toLocaleString()}자 초과 ${skipped}건은 제외했습니다.` : ''}`);
      setCsvRows([]);
    }
  }

  async function runInspection(reviewsToCheck: ReviewSubmission[]) {
    if (busyRef.current || !project || !usableGuide || !reviewsToCheck.length) return;
    if (settings.provider === 'openai' && !apiKey.trim()) {
      setError('검수 전에 AI 연결 설정에서 OpenAI API 키를 입력해 주세요.');
      onOpenSettings();
      return;
    }
    if (settings.provider === 'ollama' && !settings.models.ollama) {
      setError('AI 연결 설정에서 설치된 Ollama 모델을 조회하고 선택해 주세요.');
      onOpenSettings();
      return;
    }
    if (!project.productDescription.trim()) {
      setError('검수 요청에는 상품 설명이 필요합니다. 상품 분석 화면에서 상품 정보를 입력해 주세요.');
      return;
    }
    if (reviewsToCheck.some(review => review.text.length > MAX_REVIEW_LENGTH)) {
      setError(`리뷰 본문은 ${MAX_REVIEW_LENGTH.toLocaleString()}자까지 검수할 수 있습니다.`);
      return;
    }

    busyRef.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setNotice('');
    setProgress({ done: 0, total: reviewsToCheck.length });
    try {
      onSaveInputs(reviewsToCheck);
      await saveNow();
      for (let offset = 0; offset < reviewsToCheck.length; offset += API_BATCH_SIZE) {
        const batch = reviewsToCheck.slice(offset, offset + API_BATCH_SIZE);
        let batchResults: ReviewInspection[];
        try {
          const response = await fetch('/api/check-review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: settings.provider,
              model: settings.models[settings.provider],
              ...(settings.provider === 'openai' ? { key: apiKey } : {}),
              input: {
                product: {
                  name: project.productName || guide.productName || project.name,
                  description: project.productDescription,
                  strengths: project.strengths,
                },
                guide: {
                  title: guide.title,
                  purpose: guide.purpose,
                  testItems: guide.testItems,
                  writingGuidance: guide.writingGuidance ?? [],
                  checklist: guide.checklist,
                },
                guideVersion,
                reviews: batch.map(({ id, authorId: author, text }) => ({
                  id,
                  ...(author ? { authorId: author } : {}),
                  text,
                })),
              },
            }),
          });
          let data: { inspections?: ReviewInspection[]; error?: string };
          try {
            data = await response.json() as { inspections?: ReviewInspection[]; error?: string };
          } catch {
            throw new Error('AI 서버 응답을 읽을 수 없습니다.');
          }
          if (!response.ok) throw new Error(data.error || 'AI 검수 요청을 완료하지 못했습니다.');
          if (!Array.isArray(data.inspections)
            || data.inspections.length !== batch.length
            || new Set(data.inspections.map(result => result.reviewId)).size !== batch.length
            || batch.some(review => !data.inspections?.some(result => result.reviewId === review.id))) {
            throw new Error('AI 검수 응답에서 일부 리뷰 결과를 확인하지 못했습니다.');
          }
          batchResults = data.inspections;
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : '네트워크 또는 AI 응답 오류가 발생했습니다.';
          batchResults = batch.map(review => createFailure(
            review, guideVersion, settings.provider, settings.models[settings.provider], message,
          ));
        }
        onSaveResults(batch, batchResults);
        await saveNow();
        setProgress({ done: Math.min(offset + batch.length, reviewsToCheck.length), total: reviewsToCheck.length });
      }
      setNotice('검수를 마쳤습니다. 리뷰별 결과와 실패 항목을 확인해 주세요.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '검수 대상을 저장하지 못했습니다.');
    } finally {
      busyRef.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  function exportResults() {
    if (!project || !latestResults.length) return;
    downloadCSV(project, latestResults);
  }

  const guideOld = project && guide && isReviewGuideStale(guide, project);

  return (
    <section className="content inspection-content">
      <div className="inspection-topbar">
        <button className="plain" type="button" onClick={onBackToGuide}><ArrowLeft size={16} />리뷰 가이드로 돌아가기</button>
        <span>리뷰단 초안 검수 · 프로젝트별 저장</span>
      </div>
      <div className="title-row">
        <div>
          <div className="eyebrow">REVIEW QUALITY CHECK</div>
          <h1>리뷰 초안을 가이드 기준으로 확인하세요.</h1>
          <p>긍정·부정이 아니라 실제 경험의 구체성과 저장된 가이드 충실도를 확인합니다.</p>
        </div>
      </div>

      <section className="dashboard-card">
        <div className="section-title">
          <div><h2>A. 검수할 상품 프로젝트와 가이드</h2>
            <p>이 화면의 리뷰단 초안은 기존 고객 리뷰 분석 데이터와 별도로 저장됩니다.</p></div>
        </div>
        {project && <>
          <div className="inspection-product-summary"><b>{project.productName || project.name}</b>
            <span>{guide?.title || '저장된 리뷰 가이드 없음'}</span>
            {guide && <small>가이드 버전: {guideVersion ? new Date(guideVersion).toLocaleString('ko-KR') : '기록 없음'}
              {guideOld ? ' · 상품/평가 정보 변경 이후의 이전 가이드' : ''}</small>}
          </div>
          {usableGuide && <div className="inspection-ai-settings">
            <div>
              <span>선택된 검수 모델</span>
              <strong>{settings.provider === 'openai' ? 'OpenAI' : 'Ollama'}
                {' · '}{settings.models[settings.provider] || (settings.provider === 'openai' ? 'gpt-4.1-mini' : '모델 미선택')}</strong>
              <small>{settings.provider === 'ollama'
                ? '로컬 개발 서버가 127.0.0.1:11434에 연결합니다. 서버가 실행 중인지 연결 설정에서 확인하세요.'
                : 'OpenAI는 서버 API를 통해 호출합니다. 키는 현재 탭 메모리에만 유지됩니다.'}</small>
            </div>
            <button className="plain" type="button" disabled={busy} onClick={onOpenSettings}>AI 연결 설정</button>
          </div>}
          {guideOld && <div className="stale-notice" role="status">
            상품 정보, 평가 항목 또는 기존 리뷰 분석이 가이드 이후 변경되었습니다. 검수 결과에는 지금 사용한 저장 가이드 버전이 기록됩니다.
          </div>}
        </>}
        {!usableGuide && <div className="empty inspection-no-guide">
          <strong>검수할 저장 가이드가 필요합니다.</strong>
          <p>구조화된 테스트 항목이 포함된 가이드를 먼저 생성하고 저장해 주세요.</p>
          <button className="primary" type="button" onClick={onOpenGuide}><ClipboardList size={15} />가이드 생성 화면으로 이동</button>
        </div>}
      </section>

      {usableGuide && project && <>
        <section className="inspection-input-grid">
          <section className="dashboard-card">
            <div className="section-title"><div><h2>B. 리뷰 한 건 입력</h2>
              <p>작성자 식별자는 선택 사항이며 개인 정보를 요구하지 않습니다.</p></div></div>
            <label className="inspection-field">작성자 이름 또는 ID <small>선택</small>
              <input value={authorId} maxLength={120} placeholder="예: reviewer-01"
                onChange={event => setAuthorId(event.target.value)} />
            </label>
            <label className="inspection-field">리뷰 본문
              <textarea rows={7} maxLength={MAX_REVIEW_LENGTH} value={singleText}
                placeholder="검수할 리뷰 초안 내용을 입력해 주세요."
                onChange={event => setSingleText(event.target.value)} />
            </label>
            <div className="inspection-input-footer"><small>{singleText.length.toLocaleString()} / {MAX_REVIEW_LENGTH.toLocaleString()}자</small>
              <button className="primary" type="button" disabled={!singleText.trim() || busy}
                onClick={addSingleReview}><Plus size={15} />검수 목록에 추가</button>
            </div>
          </section>

          <section className="dashboard-card">
            <div className="section-title"><div><h2>C. 리뷰 CSV/TSV 일괄 추가</h2>
              <p>UTF-8/EUC-KR, 최대 5MB · 최대 {MAX_PROJECT_REVIEWS}건 · 리뷰당 {MAX_REVIEW_LENGTH.toLocaleString()}자</p></div></div>
            <div className="inspection-upload">
              <FileSpreadsheet size={22} />
              <span>{csvName || '리뷰단이 작성한 검수 대상 초안 파일을 선택하세요.'}</span>
              <button className="plain" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
                <Upload size={15} />CSV/TSV 선택
              </button>
              <input ref={fileInput} hidden type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values"
                onChange={event => {
                  if (event.target.files?.[0]) void importCSV(event.target.files[0]);
                  event.target.value = '';
                }} />
            </div>
            {fileError && <div role="alert" className="error">{fileError}</div>}
            {csvRows.length > 0 && <>
              <div className="inspection-column-grid">
                <label>리뷰 본문 열
                  <select value={bodyColumn} onChange={event => setBodyColumn(Number(event.target.value))}>
                    {csvRows[0].map((heading, index) =>
                      <option key={index} value={index}>{heading || `열 ${index + 1}`}</option>)}
                  </select>
                </label>
                <label>작성자 ID/이름 열 <small>선택</small>
                  <select value={authorColumn} onChange={event => setAuthorColumn(Number(event.target.value))}>
                    <option value={-1}>사용 안 함</option>
                    {csvRows[0].map((heading, index) =>
                      <option key={index} value={index}>{heading || `열 ${index + 1}`}</option>)}
                  </select>
                </label>
              </div>
              <div className="inspection-csv-preview">
                {csvRows.slice(1, 4).map((row, index) => <p key={index}>{row[bodyColumn] || '빈 본문'}</p>)}
                <small>헤더 제외 {csvRows.length - 1}행 · 빈 본문/길이 초과 행은 추가에서 제외합니다.</small>
              </div>
              <button className="primary" type="button" disabled={busy} onClick={addCSVReviews}>
                <Plus size={15} />검수 목록에 추가
              </button>
            </>}
          </section>
        </section>

        <section className="dashboard-card inspection-results-card">
          <div className="section-title">
            <div><h2>D. 검수 결과</h2><p>AI는 리뷰 진실성이나 실제 제품 사용 여부를 인증하지 않습니다.</p></div>
            <button className="plain" type="button" disabled={!latestResults.length}
              onClick={exportResults}><FileSpreadsheet size={15} />결과 CSV 다운로드</button>
          </div>
          <div className="inspection-summary">
            <div><span>등록 리뷰</span><strong>{project.submittedReviews.length}</strong></div>
            <div><span>현재 가이드 검수 완료</span><strong>{latestResults.length}</strong></div>
            <div><span>보완 필요</span><strong>{revisionCount}</strong></div>
            <div><span>문제 없음</span><strong>{clearCount}</strong></div>
            <div><span>검수 실패</span><strong>{failedCount}</strong></div>
          </div>
          {busy && <div className="inspection-progress" role="status">
            검수 진행 중 · {progress.done} / {progress.total}
            <progress max={progress.total || 1} value={progress.done} />
          </div>}
          <div className="inspection-actions">
            <label>결과 필터
              <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
                {['전체', '보완 필요', '문제 없음', '검수 실패'].map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
            <button className="primary" type="button" disabled={busy || !totalNeeded || !readyForInspection}
              onClick={() => void runInspection(project.submittedReviews.filter(review => {
                const result = inspectionsById.get(review.id);
                return !result || result.status === '검수 실패' || result.guideVersion !== guideVersion;
              }))}>
              {busy ? '리뷰를 차례로 검수하고 있어요…' : `미검수·실패·이전 가이드 결과 검수 (${totalNeeded})`}
              <Check size={15} />
            </button>
            {failedCount > 0 && <button className="plain" type="button" disabled={busy}
              onClick={() => void runInspection(project.submittedReviews.filter(review =>
                inspectionsById.get(review.id)?.status === '검수 실패'))}>
              <RefreshCw size={14} />실패한 리뷰만 재시도 ({failedCount})
            </button>}
            {project.submittedReviews.length > 0 && <button className="plain danger-text" type="button" disabled={busy}
              onClick={() => {
                if (window.confirm('이 프로젝트의 검수 대기 리뷰와 연결된 결과를 모두 삭제할까요?')) {
                  onClearReviews();
                  setSelectedId('');
                }
              }}><Trash2 size={14} />검수 자료 전체 삭제</button>}
          </div>
          {error && <div role="alert" className="error">{error}</div>}
          {notice && <div role="status" className="notice">{notice}</div>}
          {storageError && <div role="alert" className="error">{storageError}</div>}
          {!project.productDescription.trim() && <div className="stale-notice">
            저장된 상품 설명이 없습니다. 상품 분석 화면에서 상품명과 설명을 준비해야 검수할 수 있습니다.
            <button className="plain" type="button" onClick={onBackToAnalysis}>상품 정보 입력으로 이동</button>
          </div>}
          <small className="inspection-storage-status">저장 상태: {storageStatus}</small>
          <div className="inspection-review-layout">
            <div className="inspection-review-list">
              {visibleReviews.map(review => {
                const result = inspectionsById.get(review.id);
                const versionMismatch = result && result.guideVersion !== guideVersion;
                const state = result?.status === '검수 실패' ? '검수 실패'
                  : versionMismatch ? '미검수' : result?.status ?? '미검수';
                return <article className={`inspection-review-row ${selected?.id === review.id ? 'selected' : ''}`}
                  key={review.id}>
                  <button type="button" className="inspection-review-select"
                          onClick={() => { setSelectedId(review.id); setViewingPrevious(false); }}>
                    <span className={statusClass(state)}>{state}{versionMismatch ? ' · 이전 가이드' : ''}</span>
                    <strong>{review.authorId || `리뷰 ${review.id.slice(0, 8)}`}</strong>
                    <small>{review.text.slice(0, 150)}{review.text.length > 150 ? '…' : ''}</small>
                    {result && result.status !== '검수 실패' && !versionMismatch
                      && <span className="inspection-counts">충족 {result.satisfiedCount} · 부분 {result.partialCount} · 미충족 {result.missingCount}</span>}
                  </button>
                  <button className="plain inspection-remove" type="button" aria-label="리뷰와 검수 결과 삭제"
                    disabled={busy} onClick={() => {
                      onRemoveReview(review.id);
                      if (selectedId === review.id) setSelectedId('');
                    }}><Trash2 size={14} /></button>
                </article>;
              })}
              {!visibleReviews.length && <div className="empty">선택한 필터의 리뷰가 없습니다.</div>}
            </div>
            <div className="inspection-detail">
              {!selected ? <div className="empty">상세 결과를 보려면 왼쪽 리뷰를 선택하세요.</div>
                : !selectedInspection ? <div className="empty">
                  아직 검수되지 않은 리뷰입니다. 위의 검수 시작 버튼을 눌러 주세요.
                </div>
                  : selectedInspection.status === '검수 실패' ? <div className="inspection-failure">
                    <AlertTriangle size={18} /><strong>검수 실패 · 재시도 가능</strong>
                    <p>{selectedInspection.error}</p>
                    {previousSuccessfulInspection && <p>
                      이전 성공 결과({new Date(previousSuccessfulInspection.inspectedAt).toLocaleString('ko-KR')})는 삭제되지 않았습니다.
                      <button className="plain" type="button" onClick={() => setViewingPrevious(true)}>이전 성공 결과 보기</button>
                    </p>}
                    <button className="plain" type="button" disabled={busy}
                      onClick={() => { setViewingPrevious(false); void runInspection([selected]); }}><RefreshCw size={14} />이 리뷰 재시도</button>
                  </div>
                    : <div className="inspection-detail-body">
                      {selectedInspection.guideVersion !== guideVersion && <div className="stale-notice">
                        이 결과는 이전 가이드 버전으로 검수했습니다. 새 가이드 기준 결과가 아닙니다.
                      </div>}
                      {viewingPrevious && selectedLatestInspection?.status === '검수 실패' && <div className="stale-notice">
                        최신 검수 시도는 실패했지만, 이전에 성공한 검수 결과는 보존되어 있습니다.
                        <button className="plain" type="button" onClick={() => setViewingPrevious(false)}>최신 실패 시도 보기</button>
                      </div>}
                      <div className="inspection-detail-heading">
                        <div><span className={statusClass(selectedInspection.status)}>{selectedInspection.status}</span>
                          <h3>{selected.authorId || `리뷰 ${selected.id.slice(0, 8)}`}</h3>
                          <small>{selectedInspection.provider === 'openai' ? 'OpenAI' : 'Ollama'} · {selectedInspection.model}
                            {' · '}{new Date(selectedInspection.inspectedAt).toLocaleString('ko-KR')}</small></div>
                      </div>
                      <h4>리뷰 원문</h4>
                      <blockquote className="inspection-original">{selected.text}</blockquote>
                      <h4>전체 요약</h4>
                      <p>{selectedInspection.summary}</p>
                      <div className="inspection-counts">
                        충족 {selectedInspection.satisfiedCount} · 부분 충족 {selectedInspection.partialCount}
                        {' · 미충족 '}{selectedInspection.missingCount} · 판단 불가 {selectedInspection.unknownCount}
                        {' · 해당 없음 '}{selectedInspection.notApplicableCount}
                        {' · 구체성: '}{selectedInspection.specificity}
                      </div>
                      <h4>가이드 평가 항목</h4>
                      {selectedInspection.items.map(item => <article className="inspection-item-result" key={item.guideItemId}>
                        <div><strong>{item.title}</strong><span className={`item-state ${item.status === '충족' ? 'good' : item.status === '미충족' || item.status === '부분 충족' ? 'warn' : ''}`}>
                          {item.status}{item.required ? ' · 필수' : ' · 선택'}
                        </span></div>
                        {item.evidence && <blockquote>원문 근거: “{item.evidence}”</blockquote>}
                        {!!item.missingInfo.length && <p><b>누락 정보:</b> {item.missingInfo.join(' · ')}</p>}
                        {!!item.unclearInfo.length && <p><b>불명확한 정보:</b> {item.unclearInfo.join(' · ')}</p>}
                        <p><b>보완 피드백:</b> {item.feedback}</p>
                      </article>)}
                      <h4>추가 점검</h4>
                      <p><b>협찬·제품 제공 공개:</b> {selectedInspection.disclosure.status}
                        {selectedInspection.disclosure.evidence && ` · “${selectedInspection.disclosure.evidence}”`}
                        {` · ${selectedInspection.disclosure.feedback}`}
                      </p>
                      {!!selectedInspection.conflicts.length && <div><b>상품 정보와 충돌할 수 있는 표현</b>
                        {selectedInspection.conflicts.map((item, index) => <p key={index}>“{item.evidence}” — {item.claim}</p>)}</div>}
                      {!!selectedInspection.unsupportedClaims.length && <div><b>근거가 확인되지 않은 성능 주장</b>
                        {selectedInspection.unsupportedClaims.map((item, index) => <p key={index}>“{item.evidence}” — {item.claim}</p>)}</div>}
                      <p className="inspection-limit-note">이 결과는 제공된 문장과 가이드 기준을 검토한 참고 정보이며, 실제 사용 여부나 리뷰의 진실성을 확인하거나 인증하지 않습니다.</p>
                    </div>}
            </div>
          </div>
        </section>
      </>}
    </section>
  );
}
