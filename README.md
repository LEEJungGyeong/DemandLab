# DemandLab — 전체 소스 인계본

OEG / 컴퓨터공학과 이정경·오지수

현재 제작된 CSV 리뷰 분석 서비스의 소스 스냅샷입니다. 기존 화면, 기능, API, 컴포넌트, 설정을 변경하지 않았습니다. 이 인계용 README와 `.env.example`, 파일 무결성 목록만 추가했으며 원래 README는 `README.starter.md`로 보존했습니다.

## 1. 기술 스택

- TypeScript, React 19, Next.js App Router 형태의 소스
- Vinext + Vite로 실행/빌드 (일반적인 `next dev` 프로젝트와 구분)
- 스타일: `app/globals.css`, Noto Sans KR 웹폰트, Lucide 아이콘
- 백엔드: `app/api/analyze/route.ts`의 동일 출처 POST API
- AI: OpenAI Chat Completions API / `gpt-4.1-mini`
- 배포 런타임: Cloudflare Workers, Sites용 플러그인과 진입점 포함
- pnpm 11.25.0, 잠금 파일 `pnpm-lock.yaml`
- Drizzle/D1 보일러플레이트는 있으나 실제 DB는 사용하지 않음

정확한 의존성 버전은 package.json 및 pnpm-lock.yaml 기준입니다.

## 2. VS Code에서 설치하고 실행하기

Node.js 22.13.0 이상을 사용하세요. 제작 환경은 Node.js 24였습니다. 인터넷 연결이 필요합니다.

1. ZIP 압축을 풀고 `DemandLab` 폴더 자체를 VS Code에서 엽니다.
2. VS Code 터미널에서 다음을 실행합니다.

```sh
npm install -g pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm dev
```

터미널에 출력되는 주소를 여세요. 기본 개발 주소는 `http://localhost:5173`입니다. 맥/Windows/Linux에서 같은 명령을 사용합니다. pnpm이 이미 해당 버전으로 설치되어 있으면 첫 명령은 생략합니다.

```sh
pnpm build
pnpm start
```

`pnpm build`는 배포 산출물을 만들고 `pnpm start`는 빌드된 Worker를 로컬에서 미리 봅니다. 로컬 실행에 Cloudflare 계정이나 ChatGPT 로그인은 필요하지 않습니다. 새 체크아웃에서는 실행 스크립트가 자동으로 portable 모드를 선택합니다.

이 프로젝트는 pnpm으로 전환되어 package-lock.json이 없습니다. `npm ci` 및 기존 `install:ci` 스크립트는 사용하지 말고 위 pnpm 명령을 사용하세요. 빌드 실패 시 Node 버전과 의존성 설치 오류부터 확인하세요. `next dev`나 별도의 Python 서버로 실행하는 프로젝트가 아닙니다.

## 3. 환경변수와 API 키

현재 앱을 실행하기 위한 필수 환경변수는 없습니다. `.env.example`에 이 사실과 선택적 로컬 도구 설정을 적었습니다.

실제 AI 분석:

1. 화면 오른쪽 위의 **AI 연결 설정**을 누릅니다.
2. 본인의 OpenAI API 키를 입력합니다.
3. CSV를 업로드하고 열을 연결한 뒤 **AI 분석 시작**을 누릅니다.

현재 소스는 서버의 `OPENAI_API_KEY` 환경변수를 읽지 않습니다. `.env`에 키를 넣는 것만으로는 연결되지 않습니다. 원래 구현을 보존하기 위해 이 동작도 그대로 두었습니다.

키는 현재 탭의 React 메모리에만 유지되며 서버 POST 요청을 거쳐 OpenAI에 전달됩니다. 리뷰 본문이 OpenAI로 전송되고 별도의 API 사용료가 발생합니다. ChatGPT 구독과 별개입니다. 키나 리뷰는 DB에 저장하지 않습니다. 새로고침하면 키와 업로드 데이터, 분석 결과가 사라집니다.

실제 키·비밀번호·배포 토큰은 ZIP에 포함하지 않았습니다.

## 4. 현재 작동하는 기능

- CSV/TSV 업로드, 파일 크기 5MB 제한
- UTF-8 및 EUC-KR 디코딩, 따옴표/쉼표/다중 행 CSV 처리
- 리뷰 본문·별점·작성일·구매 옵션 열 수동 연결과 미리보기
- 빈 본문 및 완전히 같은 본문 중복 제거
- 체험단/무료 제공 문구 정규식 필터, 포함·제외 집계
- 리뷰 키워드 검색, 낮은 별점순 및 최신순 정렬, 더 보기
- API 키 연결 시 AI 주제·하위 주제 발견, 주제별 긍정·부정·중립·혼합 분류
- AI 근거 인용이 실제 원문에 포함되는지 서버에서 검증
- 주제 카드·감정 막대 선택 시 원문 목록 필터, 근거 문장 강조
- 예시 CSV 다운로드, 예시 데이터 둘러보기
- 모바일 대응 레이아웃

AI 요청은 한 번에 100개 이하, 리뷰당 4,000자 이하입니다. 현재는 전체 업로드 리뷰를 AI에 보내고, 체험단 필터는 표시/집계 대상을 바꿉니다. 주제 이름 발견 단계까지 체험단을 제외하는 구현은 아닙니다.

## 5. 예시/미구현/제한 사항

- **예시 데이터로 둘러보기**의 리뷰와 분석은 기능 설명용 가상 데이터 및 미리 작성한 결과입니다. 실제 AI 실행 결과가 아닙니다.
- 쿠팡 링크 자동 수집은 구현되어 있지 않습니다. 현재 입력은 CSV입니다.
- 구매 조건 의미 검색, AI 작성 리뷰 판별, 리뷰 작성 가이드/검수, 제품 비교는 구현되어 있지 않습니다.
- 하위 주제는 표시되지만 별도의 하위 주제 필터는 없습니다.
- 장기 저장, 계정별 데이터, 프로젝트 이력, 분석 결과 내보내기는 없습니다.
- 체험단 문구 필터는 표시된 특정 문구만 인식합니다. 남은 리뷰의 실구매 여부를 보증하지 않습니다.
- 주제 및 감정 분석 정확도는 실험으로 검증하지 않았습니다.
- 실제 OpenAI API 성공 응답은 제작 시 키가 없어 종단 간 검증하지 못했습니다. API 경로와 오류 처리는 소스에 구현되어 있습니다.
- AI 프롬프트는 JSON 응답을 요구하고 일부 필드를 검증하지만 모든 이상 응답에 대한 완전한 스키마 검증은 없습니다.
- 예시 모드에서 AI를 실행하려면 역시 본인의 API 키가 필요합니다.

## 6. 폴더 안내

- `app/page.tsx`: 전체 메인 UI, CSV 파서, 업로드/필터/검색, 예시 데이터, API 연결
- `app/globals.css`: 전체 디자인 및 반응형 스타일
- `app/layout.tsx`: HTML/메타데이터
- `app/api/analyze/route.ts`: 실제 AI 분석 서버 엔드포인트
- `app/chatgpt-auth.ts`: Sites 인증 보조 코드 (메인 화면에서 사용하지 않음)
- `components/`, `hooks/`, `lib/`: 스타터 컴포넌트/유틸리티 포함, 사용하지 않는 것도 보존
- `worker/index.ts`: Cloudflare Worker 진입점
- `scripts/`, `vendor/`: 실행/빌드/로컬 Sites 지원 코드와 라이선스
- `.openai/hosting.json`: 기존 Site 식별자 및 DB/스토리지 바인딩 설정
- `db/`, `drizzle/`, `examples/d1/`: 선택적 DB 예제/연결 코드
- `vite.config.ts`, `next.config.ts`, `tsconfig.json` 등: 기존 실행 설정
- `README.starter.md`: 원본 스타터 가이드
- `SOURCE_MANIFEST.json`: 파일별 SHA-256 및 원본 소스 커밋 정보

DB 스키마 `db/schema.ts`는 비어 있고, hosting의 d1/r2 값은 null입니다. 운영 리뷰 DB나 이전 업로드 데이터는 없습니다.

## 7. 외부 의존성과 ZIP에서 빠진 것

포함하지 않은 재생성/비밀 파일:

- `node_modules`, 빌드 산출물(dist/.next 등), 캐시/로그
- `.git` 이력과 원격 저장소 인증정보
- `.sites-runtime`, `.wrangler` 등 환경별 상태/임시 데이터
- 실제 `.env`, `.dev.vars`, API 키, 비밀번호, 배포 자격증명

외부 서비스:

- OpenAI API: 실제 AI 분석 시 필요
- Google Fonts: Noto Sans KR 로드 (연결 실패 시 시스템 폰트 사용)
- npm 레지스트리: 최초 의존성 설치 시 필요
- Cloudflare/Sites: 현재 호스팅 환경. 로컬 개발과 다르게 본인의 별도 배포 설정/권한 필요

기존 Site의 URL·접근 정책·ChatGPT 로그인 설정·호스팅 계정·배포 이력은 플랫폼에 있으며 ZIP으로 이전되지 않습니다. `.openai/hosting.json`의 project_id는 비밀이 아니므로 원본 그대로 보존했지만, 이 ID를 보유한다고 배포 권한을 갖는 것은 아닙니다. 다른 계정에 배포하려면 해당 환경의 새 프로젝트 설정을 해야 합니다.

## 8. 인계 검증

제작 중 빌드 성공, 브라우저에서 예시 모드·주제/감정 원문 필터·키워드 검색을 확인했습니다. CSV의 BOM·쉼표·다중 행·TSV·미완성 따옴표 테스트도 통과했습니다.

이번 내보내기에서는 원본과 파일 해시를 비교하고 ZIP 구조 및 비밀정보 패턴을 점검했습니다. 다른 컴퓨터의 신규 설치 및 실제 OpenAI 호출 성공은 별도 확인이 필요합니다. 환경별 의존성 다운로드 제한은 이 ZIP에 포함할 수 없습니다.
