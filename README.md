# WORLDFORGE

사용자 제작 세계관 기반 1인칭 AI RPG — **서버 없이 브라우저에서 단독 실행**되는 싱글플레이 게임.

- 웹: GitHub Pages (`main` 브랜치에 푸시하면 자동 배포)
- 오프라인: `worldforge-offline.html` 한 파일을 받아 더블클릭으로 실행 (`file://`)
- AI: 사용자 본인의 API 키(BYOK) — Claude, OpenAI 호환(OpenAI · OpenRouter · Ollama · LM Studio)
- 세이브: 브라우저 IndexedDB + 파일 내보내기/가져오기

설계 문서: [`docs/design-review-v2.md`](docs/design-review-v2.md)

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
│   ├── canon.ts       #   즉흥 설정(Canon L2) 검증, 보호 주제, NPC→플레이어 지식 전달 규칙
│   └── state/         #   이벤트 소싱: 이벤트 로그 → 상태 재구성 (되돌리기·리플레이)
├── gm/                # AI GM 턴 파이프라인: Director → Rules → Actor(NPC별) → Narrator → Recorder, 전투 진행
├── llm/               # 제공자 독립 LLM 어댑터 (Anthropic SDK / OpenAI 호환 fetch)
├── storage/           # IndexedDB(Dexie) 세이브, 파일 내보내기/가져오기, 설정
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

## 라이선스 메모

규칙 엔진은 SRD 5.2.1(CC-BY-4.0) 범위에서 구현한다. "D&D"는 Wizards of the Coast의 상표이므로 제품명·UI에 사용하지 않는다.
