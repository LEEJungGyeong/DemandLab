'use client';
import {useState,useMemo,useRef} from 'react';
import {ArrowUpRight,Upload,Search,SlidersHorizontal,FlaskConical,FileText,ChevronRight,X,Check,KeyRound,Download,MessageSquare,BarChart3,Layers,ArrowRight} from 'lucide-react';

import type { Review, Result, Theme } from '../lib/types';
import { parseCSV } from '../lib/csv';
import { sponsored, normalizeReviews } from '../lib/review';

const sentiments=['긍정','부정','혼합','중립'];
const demoTexts=['배터리는 하루 종일 가서 좋은데, 한 시간만 끼면 귀가 아파요.','지하철에서 연결이 자꾸 끊겨요. 집에서는 잘 됩니다.','가볍고 귀에 편해요. 오래 끼고 공부하기 좋아요.','통화할 때 제 목소리가 작게 들린대요.','충전을 자주 안 해도 돼서 만족합니다.','운동하면 귀에서 빠져요.','음질이 선명하고 저음이 좋아요.','케이스에 넣어도 한쪽이 충전이 안 됩니다.','기기 전환이 빠르고 연결이 안정적이에요.','쿠팡체험단 이벤트로 상품을 무료로 제공받아 작성한 구매후기입니다. 착용감이 편하고 음질이 좋아요.','바람 부는 곳에서는 통화가 어려워요.','베개에 귀가 눌려서 누워서 사용하기 불편해요.','배터리 사용 시간은 5시간 정도입니다.','음질은 좋은데 저음이 너무 강해요.','케이스에 흠집이 쉽게 생겨요.','가격 대비 소리가 좋아요.'];
const demoSpecs=[['배터리','사용 시간','긍정','배터리는 하루 종일 가서 좋은데'],['착용감','장시간 착용','부정','한 시간만 끼면 귀가 아파요.'],['연결 안정성','이동 중 연결','혼합','지하철에서 연결이 자꾸 끊겨요. 집에서는 잘 됩니다.'],['착용감','장시간 착용','긍정','가볍고 귀에 편해요.'],['통화 품질','목소리 전달','부정','제 목소리가 작게 들린대요.'],['배터리','사용 시간','긍정','충전을 자주 안 해도 돼서 만족합니다.'],['착용감','고정력','부정','운동하면 귀에서 빠져요.'],['음질','선명도','긍정','음질이 선명하고 저음이 좋아요.'],['배터리','충전 불량','부정','한쪽이 충전이 안 됩니다.'],['연결 안정성','기기 전환','긍정','기기 전환이 빠르고 연결이 안정적이에요.'],['착용감','편안함','긍정','착용감이 편하고'],['통화 품질','바람 소음','부정','바람 부는 곳에서는 통화가 어려워요.'],['착용감','누워서 착용','부정','누워서 사용하기 불편해요.'],['배터리','사용 시간','중립','배터리 사용 시간은 5시간 정도입니다.'],['음질','저음','혼합','음질은 좋은데 저음이 너무 강해요.'],['내구성','케이스 흠집','부정','케이스에 흠집이 쉽게 생겨요.'],['음질','가격 대비 음질','긍정','가격 대비 소리가 좋아요.']];
export default function Home(){const [reviews,setReviews]=useState<Review[]>([]),[results,setResults]=useState<Result[]>([]),[themes,setThemes]=useState<Theme[]>([]),[file,setFile]=useState(''),[rows,setRows]=useState<string[][]>([]),[mapping,setMapping]=useState({text:0,rating:-1,date:-1,option:-1}),[exclude,setExclude]=useState(true),[theme,setTheme]=useState('전체'),[sentiment,setSentiment]=useState('전체'),[query,setQuery]=useState(''),[sort,setSort]=useState('기본순'),[key,setKey]=useState(''),[settings,setSettings]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[mode,setMode]=useState(''),[page,setPage]=useState(1);const input=useRef<HTMLInputElement>(null);const list=useRef<HTMLDivElement>(null);
 const active=useMemo(()=>reviews.filter(r=>!exclude||!r.sponsored),[reviews,exclude]);const ids=new Set(active.map(r=>r.id));const filteredResults=results.filter(r=>ids.has(r.id));const stats=themes.map(t=>({...t,items:filteredResults.filter(r=>r.theme===t.name)})).filter(t=>t.items.length).sort((a,b)=>b.items.length-a.items.length);
 let shown=active.filter(r=>r.text.toLowerCase().includes(query.toLowerCase())&&(theme==='전체'?(sentiment==='전체'||filteredResults.some(v=>v.id===r.id&&v.sentiment===sentiment)):filteredResults.some(v=>v.id===r.id&&v.theme===theme&&(sentiment==='전체'||v.sentiment===sentiment))));if(sort==='낮은 별점순')shown.sort((a,b)=>(Number(a.rating)||6)-(Number(b.rating)||6));if(sort==='최신순')shown.sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0));
 function demo(){setReviews(demoTexts.map((text,id)=>({id,text,rating:['3','2','5','2','5'][id%5],date:`2026-10-${String(id+1).padStart(2,'0')}`,option:'무선 이어폰 · 화이트',sponsored:sponsored(text)})));setResults(demoSpecs.map((v,i)=>({id:i<2?0:i-1,theme:v[0],subtheme:v[1],sentiment:v[2],evidence:v[3]})));setThemes([...new Set(demoSpecs.map(v=>v[0]))].map(name=>({name})));setMode('예시 데이터');setFile('무선 이어폰 리뷰 · 기능 시연용');setRows([]);setError('');setNotice('설명용 가상 리뷰와 미리 작성한 분석 결과입니다.');setTheme('전체');setSentiment('전체');setQuery('');setPage(1)}
 async function load(f:File){setError('');try{if(f.size>5*1024*1024)throw Error('5MB 이하 CSV를 선택해 주세요.');let buf=await f.arrayBuffer(),text=new TextDecoder().decode(buf);if(text.includes('\uFFFD'))text=new TextDecoder('euc-kr').decode(buf);const data=parseCSV(text);if(data.length<2)throw Error('열 이름과 리뷰가 포함된 CSV가 필요합니다.');setRows(data);setFile(f.name);const find=(re:RegExp)=>data[0].findIndex(h=>re.test(h));setMapping({text:Math.max(0,find(/본문|내용|리뷰|text|content|review/i)),rating:find(/별점|평점|rating|score/i),date:find(/날짜|작성일|date/i),option:find(/옵션|option/i)});}catch(e:any){setError(e.message)}}

function importRows() {
  const { reviews: arr, skipped } = normalizeReviews(
    rows,
    mapping
  );

  if (!arr.length) {
    setError('선택한 본문 열에 리뷰가 없습니다.');
    return;
  }

  setReviews(arr);
  setResults([])
  setThemes([]);
  setMode('업로드 데이터');
  setRows([]);
  setTheme('전체');
  setSentiment('전체');
  setQuery('');
  setPage(1);

  setNotice(
    `${arr.length}건을 불러왔어요. 빈 본문·중복 ${skipped}건 제외. AI 분석 전에도 필터와 검색을 사용할 수 있어요.`
  );
}

async function analyze() {
  if (!key) {
    setSettings(true);
    return;
  }

  setError('');
  setBusy(true);

  try {
    if (
      reviews.length > 100 ||
      reviews.some(r => r.text.length > 4000)
    ) {
      throw Error(
        '이번 버전은 최대 100건, 리뷰당 4,000자까지 AI 분석합니다.'
      );
    }

    const resp = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        key,
        reviews: reviews.map(({ id, text }) => ({ id, text }))
      })
    });

    const d = (await resp.json()) as {
      error?: string;
      results: Result[];
      themes: Theme[];
      dropped?: number;
    };

    if (!resp.ok) {
      throw Error(d.error || 'AI 분석 요청에 실패했습니다.');
    }

    setResults(d.results);
    setThemes(d.themes);
    setMode('AI 분석 완료');

    setNotice(
      `원문 근거를 검증한 분석 ${d.results.length}건${
        d.dropped
          ? ` · 근거 불일치 ${d.dropped}건 제외`
          : ''
      }. 체험단 스위치는 집계 대상을 변경합니다.`
    );
  } catch (e: any) {
    setError(e.message);
  } finally {
    setBusy(false);
  }
}

 function select(t:string,s='전체'){setTheme(t);setSentiment(s);setPage(1);list.current?.scrollIntoView({behavior:'smooth',block:'start'})}
 function highlight(text:string,evidence:string){const needle=query||evidence;if(!needle)return text;const i=text.toLowerCase().indexOf(needle.toLowerCase());if(i<0)return text;return <>{text.slice(0,i)}<mark>{text.slice(i,i+needle.length)}</mark>{text.slice(i+needle.length)}</>}
 function sample(){const blob=new Blob(['\uFEFF리뷰,별점,작성일,옵션\n'+demoTexts.map((t,i)=>`"${t}",${i%2?3:5},2026-10-01,화이트`).join('\n')],{type:'text/csv;charset=utf-8'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download='demandlab_sample.csv';a.click();URL.revokeObjectURL(u)}
 return <div className="shell"><aside><a className="brand" href="/"><span className="brand-icon"><FlaskConical size={22}/></span>DemandLab<span className="dot">.</span></a><div className="workspace">OEG WORKSPACE</div><button className="nav active" onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}><BarChart3 size={18}/>리뷰 분석<span>01</span></button><button className="nav" onClick={()=>list.current?.scrollIntoView({behavior:'smooth'})}><MessageSquare size={18}/>원문 탐색</button><div className="side-bottom"><div className="mini-icon">O</div><div><b>OEG</b><small>이정경 · 오지수</small></div><span className="online"/></div></aside><main><header><span>워크스페이스 <ChevronRight size={14}/> 리뷰 분석</span><button className="plain" onClick={()=>setSettings(true)}><KeyRound size={15}/> AI 연결 설정</button></header><section className="content"><div className="title-row"><div><div className="eyebrow">REVIEW INTELLIGENCE</div><h1>리뷰 속에, 답이 있어요.</h1><p>별점 너머의 장단점을 발견하고, 실제 경험을 확인하세요.</p></div><span className="version">CSV BETA <span/></span></div><div className="upload-panel" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(e.dataTransfer.files[0])load(e.dataTransfer.files[0])}}><div className="upload-icon"><Upload size={24}/></div><div className="upload-copy"><h3>리뷰 파일로 시작하세요</h3><p>CSV 파일을 끌어 놓거나 선택해 주세요. UTF-8 · EUC-KR 지원</p><button className="text-button" onClick={sample}><Download size={13}/>예시 CSV 다운로드</button></div><button className="primary" onClick={()=>input.current?.click()}><Upload size={16}/>CSV 업로드</button><input ref={input} type="file" accept=".csv,.tsv" hidden onChange={e=>{if(e.target.files?.[0])load(e.target.files[0]);e.target.value=''}}/></div>
 {rows.length>0&&<div className="mapping"><h3>열 연결 확인 <small>{rows.length-1}개 행</small></h3><div className="map-grid">{(['text','rating','date','option'] as const).map((k,i)=><label key={k}>{['리뷰 본문 *','별점','작성일','구매 옵션'][i]}<select value={mapping[k]} onChange={e=>setMapping({...mapping,[k]:Number(e.target.value)})}>{k!=='text'&&<option value={-1}>사용 안 함</option>}{rows[0].map((h,j)=><option key={j} value={j}>{h||`열 ${j+1}`}</option>)}</select></label>)}</div><p className="sample-line">미리보기: {rows[1]?.[mapping.text]}</p><button className="primary" onClick={importRows}>리뷰 불러오기 <ArrowRight size={16}/></button><button className="plain" onClick={()=>setRows([])}>취소</button></div>}
 {error&&<div role="alert" className="error">{error}</div>}
 {!reviews.length?<div className="welcome"><div className="welcome-left"><span className="eyebrow">FROM REVIEWS TO INSIGHTS</span><h2>수백 개의 리뷰,<br/>하나씩 읽지 않아도.</h2><p>주제별 반응을 살펴보고<br/>나에게 중요한 단점의 근거를 찾아보세요.</p><button className="dark" onClick={demo}>예시 데이터로 둘러보기 <ArrowUpRight size={17}/></button></div><div className="illustration"><div className="quote"><span>REVIEW 01</span><p>“배터리는 오래가는데,<br/>오래 끼면 귀가 아파요.”</p></div><div className="floating one"><span className="tag 긍정">긍정</span>배터리 <Check size={16}/></div><div className="floating two"><span className="tag 부정">부정</span>착용감 <ArrowUpRight size={16}/></div><div className="grid-lines"/></div></div>:<>
 <div className="dataset"><div><span className="badge">{mode}</span><h2>{file}</h2></div><button disabled={busy} className="primary" onClick={analyze}>{busy?'AI가 주제와 근거를 분석하고 있어요…':'AI 분석 시작'}<FlaskConical size={16}/></button></div><div className="notice">{notice}</div><div className="metrics"><div><span>불러온 리뷰</span><strong>{reviews.length.toLocaleString()}<small>건</small></strong></div><div><span>분석 대상</span><strong>{active.length.toLocaleString()}<small>건</small></strong></div><div><span>체험단 제외</span><strong>{exclude?reviews.filter(r=>r.sponsored).length:0}<small>건</small></strong></div><div><span>발견한 주제</span><strong>{stats.length}<small>개</small></strong></div></div><div className="section-title"><div><h2>어떤 이야기가 많았을까요?</h2><p>주제를 선택하면 관련 원문으로 연결됩니다.</p></div><label className="toggle"><input type="checkbox" checked={exclude} onChange={e=>{setExclude(e.target.checked);setPage(1)}}/><span/>체험단 리뷰 제외</label></div><div className="legend">{sentiments.map(s=><span key={s}><i className={s}/>{s}</span>)}<small>각 주제를 언급한 리뷰 기준 · 주제 간 중복 가능</small></div><div className="theme-grid">{stats.map((t,i)=><div className={'theme-card '+(theme===t.name?'selected':'')} key={t.name}><button className="theme-head" onClick={()=>select(t.name)}><span className="theme-num">0{i+1}</span><b>{t.name}</b><span>{t.items.length}건 <ArrowUpRight size={15}/></span></button><p>{[...new Set(t.items.map((r:Result)=>r.subtheme))].join(' · ')}</p><div className="stack">{sentiments.map(s=>{const n=t.items.filter((r:Result)=>r.sentiment===s).length;return n>0&&<button key={s} className={s} style={{width:`${n/t.items.length*100}%`}} aria-label={`${t.name} ${s} ${n}건`} title={`${s} ${n}건`} onClick={()=>select(t.name,s)}/>})}</div><div className="theme-footer"><span>부정 반응</span><b>{Math.round(t.items.filter((r:Result)=>r.sentiment==='부정').length/t.items.length*100)}% <small>/ {t.items.length}건 중</small></b></div></div>)}</div>{!stats.length&&<div className="empty">AI 분석을 실행하면 실제 리뷰에서 발견한 주제가 표시됩니다.<br/><small>아래 원문 검색과 체험단 필터는 바로 사용할 수 있어요.</small></div>}
 <div ref={list} className="review-section"><div className="section-title"><div><h2>원문에서 직접 확인하세요 <span className="count">{shown.length}</span></h2><p>AI의 해석은 참고하고, 판단은 실제 경험을 바탕으로.</p></div><button className="plain" onClick={()=>{setTheme('전체');setSentiment('전체');setQuery('');setPage(1)}}>필터 초기화</button></div><div className="filters"><div className="search"><Search size={18}/><input aria-label="리뷰 키워드 검색" placeholder="궁금한 키워드를 검색하세요. 예: 발열, 통화" value={query} onChange={e=>{setQuery(e.target.value);setPage(1)}}/></div><select aria-label="주제 필터" value={theme} onChange={e=>{setTheme(e.target.value);setPage(1)}}><option>전체</option>{themes.map(t=><option key={t.name}>{t.name}</option>)}</select><select aria-label="감정 필터" value={sentiment} onChange={e=>{setSentiment(e.target.value);setPage(1)}}>{['전체',...sentiments].map(s=><option key={s}>{s}</option>)}</select><select aria-label="정렬" value={sort} onChange={e=>setSort(e.target.value)}>{['기본순','낮은 별점순','최신순'].map(s=><option key={s}>{s}</option>)}</select></div><div className="scope"><SlidersHorizontal size={13}/>{theme==='전체'?'전체 주제':theme} · {sentiment==='전체'?'모든 반응':sentiment} · {exclude?'체험단 제외':'체험단 포함'}</div>{shown.slice(0,page*12).map(r=>{const rr=filteredResults.filter(v=>v.id===r.id&&(theme==='전체'||v.theme===theme));return <article className="review" key={r.id}><div className="review-top"><span className="stars">{r.rating?`★ ${r.rating}`:'별점 없음'}</span><span>{r.date||'날짜 없음'}</span><span>{r.option}</span>{r.sponsored&&<span className="sponsor">체험단 표시</span>}<small>#{r.id+1}</small></div><p>{highlight(r.text,rr[0]?.evidence||'')}</p><div className="review-tags">{rr.map(v=><button key={v.theme} onClick={()=>select(v.theme,v.sentiment)}><span className={'tag '+v.sentiment}>{v.sentiment}</span>{v.theme}<span className="subtheme">{v.subtheme}</span></button>)}</div></article>})}{!shown.length&&<div className="empty">선택한 조건에 맞는 리뷰가 없습니다.</div>}{shown.length>page*12&&<button className="more" onClick={()=>setPage(page+1)}>리뷰 더 보기 ({Math.min(page*12,shown.length)} / {shown.length})</button>}</div></>}
 <footer><span className="footer-brand">DemandLab.</span><span>더 잘 읽고, 더 나은 선택을.</span><span>Built by OEG</span></footer></section></main>{settings&&<div className="modal-backdrop"><div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="modal"><button className="close" aria-label="닫기" onClick={()=>setSettings(false)}><X/></button><KeyRound className="modal-icon"/><h2 id="settings-title">AI 분석 연결</h2><p>OpenAI API 키를 연결하면 업로드한 리뷰에서 주제를 발견하고, 주제별 반응을 분석합니다.</p><label>API 키<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder="sk-…"/></label><small>키는 현재 탭의 메모리에만 유지되며 분석 시 서버를 거쳐 OpenAI로 전달됩니다. 리뷰 본문이 OpenAI로 전송되며 API 사용 비용이 발생합니다. 최대 100건 · 리뷰당 4,000자.</small><button className="primary full" onClick={()=>setSettings(false)}>{key?'설정 적용':'나중에 연결하기'}</button><button className="text-button" onClick={()=>{setKey('');setSettings(false)}}>키 지우기</button></div></div>}</div>
}
