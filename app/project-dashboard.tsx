'use client';

import { useState } from 'react';
import { ArrowRight, FolderKanban, Plus, Trash2 } from 'lucide-react';
import WorkspaceOverview from './workspace-overview';
import type { ProductProject, ProjectSummary } from '../lib/types';

type Props = {
  projects: ProjectSummary[];
  project?: ProductProject;
  onNavigate: (step: number) => void;
  activeProjectId?: string;
  ready: boolean;
  managing: boolean;
  status: string;
  error: string;
  onCreate: (name: string) => Promise<boolean>;
  onOpen: (id: string, resume: boolean) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string, name: string) => Promise<boolean>;
  onRetry: () => void;
};


export default function ProjectDashboard({
  projects, project, onNavigate, activeProjectId, ready, managing, status, error, onCreate, onOpen, onRename, onDelete, onRetry,
}: Props) {
  const [name, setName] = useState('');
  const [renameId, setRenameId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState('');
  const [deleting, setDeleting] = useState(false);
  const disabled = !ready || managing;

  return (
    <section className="content project-dashboard">
      <div className="title-row"><div><div className="eyebrow">WORKSPACE / OVERVIEW</div><h1>리뷰 인사이트</h1><p>고객의 반응과 다음 할 일을 한눈에 확인하세요.</p></div><span className="version">DEMANDLAB</span></div>
      <WorkspaceOverview project={project} onNavigate={onNavigate}/>
      <details className="project-create-disclosure"><summary><Plus size={18}/> 새 프로젝트 만들기 <span>상품별로 리뷰와 가이드를 관리하세요</span></summary>
      <div className="dashboard-welcome">
        <div className="eyebrow">DEMANDLAB WORKSPACE</div>
        <h2>새 상품 프로젝트</h2>
        <p>상품 프로젝트를 선택해 저장된 작업을 이어가거나 새 캠페인을 시작하세요.</p>
        <form className="dashboard-create-form" onSubmit={async event => {
          event.preventDefault();
          if (await onCreate(name)) setName('');
        }}>
          <label htmlFor="dashboard-new-project">새 상품 프로젝트</label>
          <div>
            <input id="dashboard-new-project" value={name} maxLength={100}
              placeholder="예: 무선 이어폰 신제품 리뷰단"
              onChange={event => setName(event.target.value)} disabled={disabled} />
            <button className="primary" type="submit" disabled={disabled}><Plus size={16} />새 프로젝트 만들기</button>
          </div>
        </form>
        <small className="dashboard-storage-status" role="status">{status}</small>
        {error && <div className="error" role="alert">{error}<button className="plain" onClick={onRetry}>다시 시도</button></div>}
      </div>

      </details>

      {!!projects.length && <section className="project-list dashboard-project-list" aria-label="상품 프로젝트 목록">
        <div className="project-list-heading">
          <div><h2>상품 프로젝트</h2><p>저장된 상태를 기준으로 다음 할 일을 안내합니다.</p></div>
          <span>{projects.length}개 프로젝트</span>
        </div>
        <div className="project-list-grid">
          {projects.map(item => (
            <article className={`project-list-card ${item.id === activeProjectId ? 'selected' : ''}`} key={item.id}>
              <div className="project-list-card-top">
                <strong title={item.name}>{item.name || '이름 없는 프로젝트'}</strong>
                <span className="project-stage-badge">{item.stage}</span>
              </div>
              <div className="project-list-product">
                {item.productName || '상품 정보 미입력'}
                {item.demoData && <span className="demo-data-badge">예시 · 모의 데이터</span>}
              </div>
              <span className="project-list-target">{item.targetCustomers || '목표 고객 미입력'}</span>
              <span className="project-list-updated">마지막 수정 · {new Date(item.updatedAt).toLocaleString('ko-KR')}</span>
              <div className="project-card-metrics">
                <span>기존 리뷰 <b>{item.reviewCount}</b></span>
                <span>평가 항목 <b>{item.evaluationCount}</b></span>
                <span>가이드 <b>{item.hasGuide ? '생성됨' : '미생성'}</b></span>
                <span>검수 리뷰 <b>{item.inspectedCount}</b></span>
              </div>
              {(item.revisionCount > 0 || item.failedCount > 0) && <small className="project-card-attention">
                {item.revisionCount > 0 && `보완 필요 ${item.revisionCount}건`}
                {item.revisionCount > 0 && item.failedCount > 0 ? ' · ' : ''}
                {item.failedCount > 0 && `검수 실패 ${item.failedCount}건`}
              </small>}
              <div className="project-card-actions">
                <button className="primary" type="button" disabled={disabled}
                  onClick={() => onOpen(item.id, true)}>이어하기 <ArrowRight size={15} /></button>
                <button className="plain" type="button" disabled={disabled}
                  onClick={() => onOpen(item.id, false)}>프로젝트 열기</button>
              </div>
              <details className="project-card-manage">
                <summary>프로젝트 관리</summary>
                {renameId === item.id ? <form onSubmit={async event => {
                  event.preventDefault();
                  await onRename(item.id, renameValue);
                  setRenameId('');
                }}>
                  <label>프로젝트 이름
                    <input value={renameValue} maxLength={100}
                      onChange={event => setRenameValue(event.target.value)} disabled={disabled} />
                  </label>
                  <button className="plain" type="submit" disabled={disabled}>이름 저장</button>
                  <button className="plain" type="button" onClick={() => setRenameId('')}>취소</button>
                </form> : <button className="plain" type="button" disabled={disabled} onClick={() => {
                  setRenameValue(item.name);
                  setRenameId(item.id);
                }}>이름 수정</button>}
              </details>
              <div className="project-card-delete">
                {deleteId === item.id ? <div className="project-delete-confirm" role="alert">
                  <strong>“{item.name || '이름 없는 프로젝트'}” 프로젝트를 삭제할까요?</strong>
                  <p>상품 정보, 리뷰, 가이드, AI 작성 초안과 검수 결과가 함께 삭제됩니다. 복구할 수 없습니다.</p>
                  <div>
                    <button className="plain" type="button" disabled={disabled || deleting}
                      onClick={() => setDeleteId('')}>취소</button>
                    <button className="primary project-delete-confirm-button" type="button" disabled={disabled || deleting}
                      onClick={async () => {
                        if (deleting) return;
                        setDeleting(true);
                        try { if (await onDelete(item.id, item.name)) setDeleteId(''); }
                        finally { setDeleting(false); }
                      }}>{deleting ? '삭제 중…' : '삭제 확인'}</button>
                  </div>
                </div> : <button className="plain danger-text" type="button" disabled={disabled || deleting}
                  aria-label={`${item.name || '이름 없는 프로젝트'} 프로젝트 삭제`}
                  onClick={() => setDeleteId(item.id)}><Trash2 size={14} />프로젝트 삭제</button>}
              </div>
            </article>
          ))}
        </div>
      </section>}

      {!ready && <div className="empty" role="status"><FolderKanban size={18} />저장된 프로젝트를 불러오는 중입니다.</div>}
    </section>
  );
}
