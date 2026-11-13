# WORLDFORGE

사용자 제작 세계관 기반 1인칭 AI RPG — **서버 없이 브라우저에서 단독 실행**되는 싱글플레이 게임.

- 웹: GitHub Pages (`main` 브랜치에 푸시하면 자동 배포)
- 오프라인: `worldforge-offline.html` 한 파일을 받아 더블클릭으로 실행 (`file://`)
- AI: 사용자 본인의 API 키(BYOK) — Claude, OpenAI 호환(OpenAI · OpenRouter · Ollama · LM Studio)
- 세이브: 브라우저 IndexedDB + 파일 내보내기/가져오기

- AI 없이도: 갈래 카드가 있는 세계(내장 「에테리아」)는 API 키 없이 선택지로 체험할 수 있다

설계 문서: [`docs/design-v6-momentum.md`](docs/design-v6-momentum.md) (속도와 파장 — 지금의 기준) · [`docs/design-review-v2.md`](docs/design-review-v2.md) · 패키지 형식: [`docs/package-format.md`](docs/package-format.md)

### 한 턴이 굴러가는 방식 (v0.116)

```
플레이어의 선택 (갈래 카드의 갈림길 · 걸린 것) 또는 자유 입력
  → 돌아오는 후폭풍 · 판정 3단(성공 · 대가 · 실패하되 전개) · 걸린 것 적용   ← 엔진
  → GM 판단 AI (판정·이동·말할 인물·다음에 펼칠 카드)
  → 긴장 → 국면 전환 → 다음 갈래 카드                                      ← 엔진
  → 서술자 AI (서술 + 끝에 선택지) — 보통 턴은 AI 요청 2번
```

## 개발

```bash
npm install
npm run dev            # 개발 서버
npm test               # 엔진 단위 테스트 (vitest)
npm run build          # dist/        → GitHub Pages용
npm run build:single   # dist-single/ → 단일 index.html (file:// 실행용)
```

## 구조

```
src/
├── engine/            # 순수 TypeScript 게임 엔진 (UI·네트워크 의존 없음, 테스트 대상)
│   ├── schema.ts      #   세계관 패키지 스키마 v0 (Fact / Claim / Belief)
│   ├── character/     #   SRD 5.2.1 캐릭터 규칙: 능력치, 기술, 직업, 생성 검증, 판정 수정치
│   ├── dice/          #   시드 기반 RNG, 주사위, d20 판정, DC 등급
│   ├── knowledge/     #   지식 필터 — 모르는 정보는 프롬프트에 넣지 않는다
│   ├── combat/        #   존 기반 카드 전투: 카드 정의, 몬스터, 규칙 해결, 적 AI
│   ├── package/       #   패키지 검사기 (참조 무결성, 조건식, 인젝션 의심 경고)
│   ├── scenario.ts    #   시나리오 엔진: 조건식, 퀘스트 진행, 플래그, 발견, 결말
│   ├── phase.ts       #   긴장(drama)·국면·강도 곡선 (설계 v6)
│   ├── stakes.ts      #   선택지에 걸린 것 (설계 v6)
│   ├── storylets.ts   #   갈래 카드 덱 (설계 v6)
│   ├── relationship.ts #  NPC 관계 4축, 단계, 비밀 공개·동행 기준
│   ├── canon.ts       #   즉흥 설정(Canon L2) 검증, 보호 주제, NPC→플레이어 지식 전달 규칙
│   └── state/         #   이벤트 소싱: 이벤트 로그 → 상태 재구성 (되돌리기·리플레이)
├── importers/         # 외부 캐릭터 가져오기: CHARX·CCv3/V2/V1·PNG 카드 → 인물·지식
├── gm/worldgen/       # AI 세계관 생성 보조: 초안 스키마, 정리기, 생성 프롬프트
├── gm/                # AI GM 턴 파이프라인: Director → 엔진 → Actor(필요한 인물만) → Narrator(+선택지), 전투 진행
│                      #   offline.ts: AI 없이 카드로 진행 · 분기 다양성 점검 / stakes.ts · storylets.ts · phase.ts · tiers.ts
├── llm/               # 제공자 독립 LLM 어댑터 (Anthropic SDK / OpenAI 호환 fetch)
├── storage/           # IndexedDB(Dexie) 세이브·패키지 라이브러리, .wpk 가져오기/내보내기, 설정
├── data/              # 샘플 세계 (Phase 0 검증용, 수작업 JSON)
└── ui/                # React 화면
```

## 릴리스

`package.json`의 `version`을 올리고 `CHANGELOG.md`에 같은 버전 섹션을 추가해 `main`에 병합하면,
GitHub Actions가 `vX.Y.Z` 태그와 GitHub Release를 만들고 오프라인 HTML을 첨부한다.

## GitHub Pages 설정 (최초 1회)

저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 지정한다.
공개 저장소는 무료, 비공개 저장소의 Pages는 유료 플랜이 필요하다.

## 로컬 모델 사용

브라우저에서 로컬 서버를 호출하려면 CORS 허용이 필요하다.

- Ollama: `OLLAMA_ORIGINS=* ollama serve` → Base URL `http://localhost:11434/v1`
- LM Studio: 개발자 서버 설정에서 CORS 활성화 → Base URL `http://localhost:1234/v1`

## 보안 메모

- API 키는 사용자 브라우저에만 저장되며, 이 저장소나 서버로 전송되지 않는다. 키를 코드나 커밋에 넣지 말 것.
- GitHub Pages에서는 같은 `*.github.io` 출처의 다른 페이지와 브라우저 저장소를 공유한다. "키 기억하기"를 끄면 탭을 닫을 때 삭제된다.

## 라이선스

WORLDFORGE는 **GPL-3.0-or-later**로 배포한다 (`LICENSE`, `NOTICE`).

- RisuAI 모듈(.risum)·CHARX 형식은 RisuAI(GPL-3.0)의 `src/ts/process/modules.ts`를 따라 읽는다.
- `src/vendor/rpack/`의 rpack 해독 표는 RisuAI의 Rpack(© Kwaroran)에서 옮겼다. 원본은 RisuAI 안에서만 MIT이고 그 밖에서는 AGPL-3.0이므로, 이 부분은 **AGPL-3.0**으로 배포한다 (GPLv3 13조에 따라 결합 가능). 원본 라이선스 파일을 함께 둔다.
- 웹 버전(GitHub Pages)과 오프라인 HTML 모두 상단의 **소스 (GPL)** 링크로 소스 코드를 받을 수 있다.

### 캐릭터 카드로 만든 세계 (개인용)

다른 사람의 캐릭터 카드(CHARX 등)로 만든 세계는 **개인용**으로 표시된다. 이 브라우저에서 혼자 플레이할 수만 있고 `.wpk`·세이브 내보내기, JSON 전체 편집이 막힌다. 같은 ID로 다시 저장해도 표시는 지워지지 않는다. 카드와 이미지의 저작권은 원작자에게 있다. (브라우저 안에서 동작하는 프로그램이므로 기술적으로 완벽한 복제 방지는 아니다 — 원작자의 권리를 존중해 주세요.)

### 규칙

규칙 엔진은 SRD 5.2.1(CC-BY-4.0) 범위에서 구현한다. "D&D"는 Wizards of the Coast의 상표이므로 제품명·UI에 사용하지 않는다.
