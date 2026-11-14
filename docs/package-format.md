# 세계관 패키지 형식 (.wpk) — 스키마 v0

`.wpk`는 zip 파일이며 `world.json`(필수)과 `manifest.json`(참고용 사본)을 담는다.
게임 안의 **세계관 제작** 화면에서 만들고 내보낼 수 있고, `.json` 하나만 가져와도 된다.
엔진은 패키지 안의 코드를 실행하지 않는다. 모든 규칙은 데이터이며, 가져올 때 검사기가 확인한다.

## 최상위 구조

| 키 | 필수 | 설명 |
|---|---|---|
| `manifest` | ✓ | `id`(작가.세계, 소문자), `type: "world"`, `name`, `version`(1.0.0), `schemaVersion: "0"`, `author`, `license`, `contentRating`(all/teen/mature), `locales` |
| `locations` | ✓ | 장소. `id`, `name`, `description`(플레이어가 감각으로 아는 것), `connections`(장소 ID), `improvisation`, `discoveries` |
| `characters` | ✓ | 인물. `id`, `name`, `appearance`, `personality`, `speech`, `locationId`, `improvisation`, `relationship`, `secretTrust`, `secretFear`, `companion`, `background`(이 인물만 아는 과거), `greeting`(첫 만남의 말), `portrait`(data URL, 300KB 이하), `source`(가져온 카드의 출처) |
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

## 이야기 연결 (v0.85)

임무·조우·장면을 직접 잇는 항목이다. 모두 선택 항목이라 이전 패키지는 그대로 동작한다.

### 조우 `encounters[]`

| 필드 | 뜻 |
|---|---|
| `when` | 엔진 조건. 참일 때만 일어날 수 있다. 비우면 — 이 조우가 임무 단계의 완료 조건(`cleared`·`encounter`)이나 `via`에 걸려 있으면 **그 단계가 진행 중일 때만**, 아니면 언제나. 걸린 조우를 언제나 열어 두려면 `{ "all": [] }` |
| `force` | 이 조건이 참이 되면 GM 판단 없이 그 장소에서 바로 시작 |
| `intro` | 전투 직전 한 줄 (서술 재료) |
| `onVictory` · `onDefeat` · `onFlee` | 결과에 따라 엔진이 적용하는 이야기 효과 |
| `retry` | 지거나 달아난 뒤 다시 일어나기까지의 턴 수. 기본 `3`, `0` = 바로, `"gone"` = 다시 일어나지 않는다 |

조건 `{ "encounter": "enc/…", "is": "victory" | "defeat" | "fled" }` — 가장 최근 결과 (`is`를 빼면 "치렀다"). `cleared`는 승리만 본다.

### 이야기 효과

- `{ "startScene": "scene/…" }` · `{ "startEncounter": "enc/…" }` — 바로 이어지는 전환. 그 장면·조우의 장소·조건을 보지 않고, 전투·장면이 없을 때 앞에서부터 하나씩 시작한다.
- `{ "moveTo": "loc/…" }` — 플레이어를 옮긴다 (붙잡혀 끌려감 등).

예: 담판이 깨지면 싸움으로 — 장면의 실패 끝에 `"effects": [{ "startEncounter": "enc/border-skirmish" }]`.
예: 지면 붙잡힌다 — 조우에 `"onDefeat": [{ "setFlag": "captured" }, { "moveTo": "loc/cell" }, { "startScene": "scene/escape" }]`.

### 장면 `scenes[].entry`

```json
"entry": { "mode": "offer", "trigger": "플레이어가 발터에게 담판을 청할 때" }
```

- 비우면 기본: 상대 인물(`npcId`)이 있으면 `offer`, 없으면 `button` (`auto: true`면 `auto`).
- `button` = 🎭 버튼으로만 · `offer` = 버튼 + 플레이어의 행동이 `trigger`에 해당하면 GM이 연다 · `auto` = 조건이 맞는 순간 저절로.
- 열리는 조건은 그대로 `start`·`npcId`·`locationId`.

### 임무 단계 `quests[].stages[].via`

```json
"via": { "encounter": "enc/…", "scene": "scene/…" }
```

이 단계가 풀리는 고비. 비워도 완료 조건의 `cleared`·`encounter`·`sceneEnd`에서 찾는다. GM 판단·서술·GM 안내가 이 고비 쪽으로 이야기를 이끌고, 걸린 조우는 이 단계에서만 일어난다.

### 관계 사건 `relationBeats[].scene`

사건이 열려 있는 동안 GM이 그 장면을 열 수 있다 (장면의 진입 방식과 상관없이).

## 속도와 파장 (설계 v6, v0.111~)

모두 선택 항목이라 이전 패키지는 그대로 동작한다. 설계: [`design-v6-momentum.md`](design-v6-momentum.md).

### 시간 `time`

```json
"time": { "pace": "fast" }
```

한 턴은 "다음 갈림길까지"다. GM 판단 AI가 비트(대화 한 판 30분 · 장면 하나 2시간 · 몽타주 8시간)를 고르고, 세계는 속도(`slow` ×0.5 · `normal` · `fast` ×2)만 정한다. 예전의 `mode`·`perTurn`·`steps`·`move`·`maxPerTurn`은 읽지 않는다(검사기 경고). 진행 시계는 `{ "every": "beat", "by": 1 }`(턴마다)로 찰 수 있다.

### 긴장과 기류 축 `vars`

- **긴장** `drama`(0~10, 처음 2)은 엔진이 둔다. 선언하지 않아도 조건 `{ "var": "drama", "gte": 7 }`·효과 `{ "var": "drama", "add": 2 }`에 쓴다. 실패·전투·징조·사건으로 오르고 휴식·해결로 내린다.
- 세계 수치에 `poles`(양 끝의 이름)를 달면 **기류 축**이 된다: `{ "id": "path", "name": "봉인의 길", "initial": 0, "min": -5, "max": 5, "poles": ["봉인을 지킨다", "고신의 힘을 쥔다"] }`. 선택지가 이 축을 움직인다.

### 국면 `phases[]`

```json
{ "id": "phase/rift", "name": "균열", "tone": "이 국면의 공기·문체", "enter": { "var": "drama", "gte": 7 },
  "from": ["phase/unrest"], "announce": "바뀔 때 한 줄", "tint": "dark", "music": "dark", "gmStyle": "horror",
  "attitudes": { "npc/…": "이 국면에서 그 인물은" }, "closed": ["loc/…"], "effects": [ … ] }
```

엔진은 턴마다 위에서부터 들어갈 수 있는 첫 국면으로 옮긴다(`from`이 있으면 그 국면에서만). 들어간 뒤 3턴은 머문다. `phases`를 비우면 긴장으로 움직이는 기본 셋(평온·술렁임·위기), `"autoPhases": false`면 국면 없음. 조건 `{ "phase": "phase/…" }`.

### 걸린 것 (stake)

선택지·갈래 카드의 갈림길에 붙는 방향. 엔진이 결과를 적용한다:
`escalate` · `defuse` · `side:세력ID` · `bond:인물ID` · `betray:인물ID` · `expose:명제ID` · `theme:수치ID:+` / `theme:수치ID:-` · `thread:카드ID`.
배신·폭로·판을 키움·누구 편은 2~3턴 뒤 후폭풍으로 돌아온다.

### 갈래 카드 `storylets[]`

```json
{ "id": "card/…", "title": "…", "situation": "플레이어 앞에 펼쳐지는 상황",
  "when": { "storylet": "card/앞카드", "is": "a" }, "phases": ["phase/…"], "locationId": "loc/…", "tags": ["main"], "quest": "quest/…",
  "weight": 2, "repeat": { "after": 5 }, "text": "AI 없이 진행할 때 보여 줄 글",
  "options": [
    { "id": "a", "label": "선택지의 뼈대", "stake": "betray:npc/…", "check": { "skill": "deception", "dc": "medium" },
      "success": [ … ], "cost": [ … ], "fail": [ … ], "successText": "…", "failText": "…",
      "fallout": [{ "inTurns": 2, "storylet": "card/…" }] }
  ] }
```

- 덱: 조건(`when`)·국면·장소가 맞고, 아직 고르지 않은(또는 `repeat` 시간이 지난) 카드. `tags`의 `twist`는 국면마다 하나.
- 펼쳐지는 때: 예약된 카드(후폭풍·`openStorylet`) > GM이 고른 카드 > 잔잔하면 엔진이 무게대로 뽑는다(조건 있는 카드 기본 2, 없는 카드 1).
- 갈림길을 고르면 판정(3단: 성공 · 대가 있는 성공 · 실패하되 전개) → `success`(성공·대가) / `cost`(비우면 엔진이 고른 대가) / `fail`(비우면 엔진이 고른 전개) → 걸린 것 → 후폭풍 카드 예약.
- 조건 `{ "storylet": "card/…", "is": "갈림길ID" }` · `{ "questStage": "quest/…", "is": 0 }`. 효과 `{ "advanceQuest": "quest/…" }`(임무의 지금 단계를 끝냄) · `{ "openStorylet": "card/…", "inTurns": 2 }`.
- AI 없이(체험판) 진행할 때는 `text`·`successText`·`failText`가 서술이 된다 (없으면 `situation`).

### 플레이 기본 AI 모델 `playModels` (v0.119)

```json
"playModels": { "narrator": "claude-sonnet-5-5", "judge": "claude-haiku-5-5" }
```

제작자가 추천하는 모델 이름. 플레이어의 설정에 등록된 제공자로 요청하고, 플레이어가 플레이 중에 바꿀 수 있다.

## 검사기

- **오류**가 있으면 플레이할 수 없다: 없는 ID 참조, 중복 ID, 알 수 없는 조건·직업·몬스터·기술, 형식 위반.
- **연결 점검**(편집기 이야기 흐름·전체 점검): 어떤 임무·조건과도 이어지지 않은 조우·장면, 실패하면 막다른 고비.
- **경고**는 알림만 한다: 일방통행 연결, 시작 장소에서 갈 수 없는 장소, 알 방법이 없는 명제, AI 지시로 보이는 문장이나 링크(프롬프트 인젝션 의심).

예시는 내장 샘플 "안개골짜기"를 **복제해서 편집**으로 열어 보면 된다.

## 외부 캐릭터 카드 가져오기

편집기 **인물** 탭의 **CHARX · 캐릭터 카드 가져오기**로 RisuAI CHARX(.charx), Character Card V3/V2(.png·.json), V1(.json)을 인물로 바꿀 수 있다.

| 카드 필드 | 세계관 |
|---|---|
| `name` / `nickname` | 이름 |
| `description` | 외형(추정) + 배경 |
| `personality` | 성격 |
| `mes_example` | 말투 |
| `first_mes` | 첫 만남의 말 |
| `character_book` 항목 | 명제 + 믿음 (아는 사실 / 비밀 / 소문 / 버림 중 선택) |
| 아이콘 에셋 | 초상화 (256px로 축소) |
| `scenario`, `system_prompt`, `post_history_instructions` | 사용하지 않음 (AI에게 넘기지 않음) |
| RisuAI 스크립트·정규식·Lua | 미지원 (실행하지 않음) |

`{{char}}`·`{{user}}` 매크로는 이름과 "당신"으로 바뀌고 조사도 맞춰진다. 원본 파일은 브라우저에 보존된다. 원작자의 권리와 배포 조건을 지켜야 한다.
