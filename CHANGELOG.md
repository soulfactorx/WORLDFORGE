# Changelog

## [0.1.0] - 2026-11-04

첫 골격 릴리스. 서버 없이 브라우저에서 단독 실행된다.

### 추가
- GitHub Pages 웹 빌드 + `file://`에서 실행되는 단일 HTML 오프라인 빌드
- 엔진: 시드 기반 주사위, d20 판정(이점/불리점), DC 등급, Fact/Claim/Belief 지식 필터, 이벤트 소싱 상태
- AI GM 턴 파이프라인: Director(구조화 출력) → 검증 → 주사위 → Narrator(확정 결과만 서술)
- BYOK AI 연결: Claude, OpenAI 호환(OpenAI·OpenRouter·Ollama·LM Studio)
- IndexedDB 세이브, 턴 되돌리기, 세이브 파일 내보내기/가져오기, 단일 탭 잠금
- 샘플 세계 "안개골짜기"
