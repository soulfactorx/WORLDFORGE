# 세계관 패키지 형식 (.wpk) — 스키마 v0

`.wpk`는 zip 파일이며 `world.json`(필수)과 `manifest.json`(참고용 사본)을 담는다.
게임 안의 **세계관 제작** 화면에서 만들고 내보낼 수 있고, `.json` 하나만 가져와도 된다.
엔진은 패키지 안의 코드를 실행하지 않는다. 모든 규칙은 데이터이며, 가져올 때 검사기가 확인한다.

## 최상위 구조

| 키 | 필수 | 설명 |
|---|---|---|
| `manifest` | ✓ | `id`(작가.세계, 소문자), `type: "world"`, `name`, `version`(1.0.0), `schemaVersion: "0"`, `author`, `license`, `contentRating`(all/teen/mature), `locales` |
| `locations` | ✓ | 장소. `id`, `name`, `description`(플레이어가 감각으로 아는 것), `connections`(장소 ID), `improvisation`, `discoveries` |
| `characters` | ✓ | 인물. `id`, `name`, `appearance`, `personality`, `speech`, `locationId`, `improvisation`, `relationship`, `secretTrust`, `secretFear`, `companion` |
| `facts` | ✓ | 세계의 진실. AI 프롬프트에 직접 들어가지 않는다. `secrecy` 0~5, `subjects`, `protectedTopic` |
| `claims` | ✓ | 누군가 믿을 수 있는 명제. `truth`: true/false/partial |
| `beliefs` | ✓ | `holder`(인물 ID)가 `claim`을 `state`(rumor/partial/confirmed/mistaken/secret)로 안다 |
| `encounters` | | 전투 조우. `locationId`, `enemies[{monsterId, zone: 2|3}]`, `trigger`(Director 전용) |
| `quests` | | 임무. `start`(조건), `stages[{objective, hint, complete}]`, `rewards` |
| `flags` | | Director가 세울 수 있는 이야기 결정. `when`, `locationId`, `requires` |
| `endings` | | 결말. `condition`, `epilogue`(서술 방향) |
| `start` | ✓ | `locationId`, `openingScene` |

## 핵심 원칙

- **플레이어는 아무것도 모른 채 시작한다.** `holder: "player"` 믿음은 넣지 않는다.
- **NPC는 자기 `beliefs`에 있는 것만 안다.** 다른 사실은 그 NPC의 프롬프트에 존재하지 않는다.
- **비밀(`secret`)은 관계가 쌓여야 털어놓는다.** 신뢰 `secretTrust`(기본 40) 또는 두려움 `secretFear` 이상.
- **즉흥 설정 범위:** `none`(지어내기 금지) / `minor`(작은 세부사항) / `free`. 핵심 장소·인물은 `none`.
- **보호 주제:** 비밀 사실에 `protectedTopic`(내용을 드러내지 않는 이름표)과 `subjects`를 달면 AI가 그 주제를 지어내지 않는다.

## 조건식

```jsonc
{ "all": [ … ] }  { "any": [ … ] }  { "not": … }
{ "knows": "claim/…", "min": "partial" }       // 플레이어 지식 (min 기본 rumor)
{ "at": "loc/…" }                              // 플레이어 위치
{ "cleared": "enc/…" }                         // 이긴 조우
{ "inParty": "npc/…" }                         // 동료
{ "relationship": "npc/…", "axis": "trust", "gte": 20, "lte": 80 }
{ "flag": "chose_stay" }                       // flags에 선언된 것만
{ "questDone": "quest/…" }
{ "level": 2 }
```

## 사용할 수 있는 데이터

- 직업: `fighter`, `rogue`, `cleric`, `wizard`
- 기술: `acrobatics`, `animal_handling`, `arcana`, `athletics`, `deception`, `history`, `insight`, `intimidation`, `investigation`, `medicine`, `nature`, `perception`, `performance`, `persuasion`, `religion`, `sleight_of_hand`, `stealth`, `survival`
- 몬스터: `wolf`, `goblin_warrior`

## 검사기

- **오류**가 있으면 플레이할 수 없다: 없는 ID 참조, 중복 ID, 알 수 없는 조건·직업·몬스터·기술, 형식 위반.
- **경고**는 알림만 한다: 일방통행 연결, 시작 장소에서 갈 수 없는 장소, 알 방법이 없는 명제, AI 지시로 보이는 문장이나 링크(프롬프트 인젝션 의심).

예시는 내장 샘플 "안개골짜기"를 **복제해서 편집**으로 열어 보면 된다.
