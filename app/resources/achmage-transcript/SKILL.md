---
name: achmage-transcript
description: "Turn a recording transcript (Plaud, Daglo, Clova Note, Zoom, or any speaker-labelled text) into a faithful, long-form Markdown write-up with landscape Mermaid diagrams: a full record of a meeting, lecture, seminar, colloquium or interview, or an official minutes document for circulation. Works with or without supporting materials. Works out who each 'Speaker N' is from evidence, repairs mis-heard names and terms, cross-checks open points in local files, mail and the web, and asks the user only what evidence cannot settle, in one batch. Output starts headings at ##, uses only paragraphs, '-' bullets, tables and Mermaid, so it converts cleanly to HWPX. Use when the user asks for 전사 정리, 회의록 정리, 녹취록 정리, 강의 녹음 정리, 세미나·콜로키움 정리, 배포용 회의록, Plaud 정리, or hands over a transcript with 'Speaker 1' labels. Not for transcribing audio, and not for signing finished minutes."
aliases:
  - achmage-transcript
tags:
  - skill
  - skill/achmage-transcript
  - skill-category/document-processing
metadata:
  version: "0.3.0"
  status: "candidate"
  short-description: "녹음 전사문을 화자 확정, 용어 보정, 가로형 도식을 갖춘 풀텍스트 정리본이나 배포용 회의록으로 정리"
---

# 전사 정리 (Achmage Transcript)

녹음을 받아 적은 전사문을, 그 자리에 없던 사람이 녹음을 다시 듣지 않아도 되는 글로 정리한다. 회의, 강의, 세미나, 콜로키움, 인터뷰에 같은 방식으로 쓴다. 회의 자료나 수기 메모가 있으면 대조에 쓰고, 없으면 전사문과 검색만으로 진행한다.

## 만드는 것

- **정리본 (record, 기본)**: 내용을 빠짐없이 풀어 쓴 풀텍스트. 요약하지 않고, 말버릇과 반복만 지운다. 핵심 개념마다 가로형 도식이 들어간다.
- **배포용 회의록 (minutes)**: 안건 순서와 공식 문체(개조식)로 짠 문서. 결재선과 다른 부서가 읽는다. 사용자가 회의록, 배포용, 보고용을 말할 때 만든다.

두 산출물 모두 편집 규칙이 같다. 제목은 `##`에서 시작하고, 본문은 문단, `-` 불릿, 표 세 가지와 Mermaid 도식만 쓴다. 이 규칙을 지켜야 한글(HWPX) 변환이 깨끗하게 나온다.

## 원칙 넷

1. **내용은 전부, 말의 소음은 0.** 줄이는 방법은 내용이 아닌 것을 지우는 것 하나뿐이다. 내용을 일반화해서 압축하면 요약이 된다.
2. **라벨은 사람이 아니다.** `Speaker 3`은 기계가 목소리를 묶은 번호다. 한 라벨에 두 사람이 섞이고, 한 사람이 두 라벨로 갈린다. 이름은 증거로 붙인다.
3. **받아 적힌 글자를 믿지 않는다.** 고유명사와 숫자는 음성 인식이 가장 자주 틀리는 곳이다. 자료, 메모, 검색으로 대조한다.
4. **사람에게는 증거로 못 푸는 것만, 한 번에 묻는다.** 초안을 먼저 완성하고, 질문은 기본값을 붙여 끝에 한 번만 낸다.

## 입력

- **발화 단위 전사 (필수)**: 화자 라벨과 시각이 붙은 원문. AI 요약본만 받았다면 원문을 먼저 구한다. 요약본에는 누가 말했는지 가릴 단서가 지워져 있어 화자 확정과 대조를 할 수 없다. Plaud는 웹의 Transcript 탭이나 내보내기(TXT, SRT)에서 얻는다. 구할 수 없으면 그 한계를 먼저 알리고 요약본의 용어 보정만 한다.
- **있으면 쓰는 것**: 회의 자료나 강의 자료, 수기 메모, 참석자 명단, 같은 모임의 지난 기록, AI 요약본. 없어도 진행한다.
- **정할 것**: 산출물(정리본, 회의록, 둘 다)과 도식 대상(노트, Pele). 말이 없으면 정리본과 노트로 한다.

## 절차

순서대로 한다. 각 단계의 "넘어가는 조건"을 채운 뒤에 다음으로 간다. 참조 문서는 그 단계에 들어갈 때 읽는다. 명령의 `S`는 이 스킬 폴더의 `scripts`, `W`는 작업 폴더 `_work`다. Python 3.9 이상과 Node 20 이상이면 되고 추가 설치는 없다.

### 1. 입력을 읽고 작업 폴더를 만든다

- 받은 자료와 메모를 모두 읽는다. 전사 원문은 아직 통째로 읽지 않아도 된다.
- 세션의 종류를 정한다: 회의, 강의, 세미나·콜로키움, 인터뷰.
- 산출물을 둘 폴더 옆에 `_work/`를 만든다.
- 넘어가는 조건: 세션 종류, 산출물, 도식 대상을 정했다.

### 2. 용어집과 명단을 쓴다

`W/glossary.txt`를 아래 형식으로 쓴다. 자료와 메모에 나오는 고유명사를 빠짐없이 옮긴다. 줄 끝의 `# ...`는 출처다.

```text
# 사람
김민수 # 회의자료
박서연 # 수기 메모
# 용어
한빛 리조트 # 워크숍 준비안
지산학 프로젝트 # 회의자료
이상원미술관 # 추정
```

- `# 사람` 아래: 자료, 메모, 명단에 나오는 모든 사람 이름. 참석하지 않은 사람도 넣는다.
- `# 용어` 아래: 기관과 부서, 사업과 행사, 장소, 과목, 제품, 직책과 직책이 붙는 이름(학장, 학장상, 전공주임, 교육조교). 세 글자 이상.
- 자료에 없지만 전사를 훑어보다 떠오른 표기는 출처를 `# 추정`으로 적는다.
- 참석자 명단이 있으면 `W/roster.txt`에 한 줄에 한 명씩 쓴다.
- 자료가 전혀 없으면 [보정과 교차 확인](references/corrections.md)의 "자료가 없을 때"를 따른다.
- 넘어가는 조건: `glossary.txt`가 있다.

### 3. 준비 명령을 돌린다

`python S/transcript.py prepare 원문파일 --work W --roster W/roster.txt`

전사를 `W/turns.txt`(`[시각] 라벨: 내용`)로 통일하고, 화자 단서 `W/speakers.md`와 오인식 후보 `W/terms.md`를 만든다. 명단이 없으면 `--roster`를 뺀다.

- 넘어가는 조건: 세 파일이 생겼고, `turns.txt`를 처음부터 끝까지 읽었다.

### 4. 화자를 확정한다

[화자 확정](references/speakers.md)을 읽고 `speakers.md`의 단서로 라벨마다 이름, 근거, 확신 단계(확정, 유력, 미정)를 정한다. 결과를 `W/speaker-map.json`에 쓴다.

- 넘어가는 조건: 모든 라벨에 이름이나 역할을 붙였고, 확정이 아닌 라벨을 확인 대장의 질문에 올렸다.

### 5. 용어와 사실을 보정한다

[보정과 교차 확인](references/corrections.md)을 읽고 `terms.md`의 후보를 문맥과 맞춰 본다. 풀리지 않는 것은 싼 것부터 확인한다: 받은 자료, 사용자의 로컬 기록, 연결된 메일과 일정, 웹. 결과를 `W/corrections.json`에 쓴다.

- `terms.md`가 못 잡은 오인식도 있다. `turns.txt`를 읽으며 뜻이 통하지 않는 낱말, 문맥과 어긋나는 숫자, 영문 약어의 한글 받아쓰기를 찾아 함께 적는다.
- `corrections.json`의 `from`은 `turns.txt`에서 그 글자를 복사해 적는다. 조사(이, 가, 은, 는)는 뺀다. 띄어쓰기는 달라도 된다.
- 넘어가는 조건: `terms.md`의 모든 줄에 대해 보정함, 다른 대상이라 보정 안 함, 미확인 가운데 하나로 정했다.

### 6. 확인 대장을 쓰고 일괄 반영한다

[확인 대장 양식](assets/ledger-template.md)대로 `W/ledger.md`를 쓴다. 그다음 반영한다.

`python S/transcript.py apply W/turns.txt --speakers W/speaker-map.json --corrections W/corrections.json --out W/turns.named.txt`

- 출력의 "아직 이름이 없는 라벨"과 "치환 대상이 없던 항목"을 확인한다. 치환 대상이 없던 항목은 `from`을 고쳐 다시 돌린다.
- 대장은 여기서 처음 쓰고, 7단계와 8단계에서 새로 알게 된 것(배포용에서 뺀 것, 검수 결과, 늘어난 질문)을 덧붙여 전달 전에 최종본으로 만든다.
- 넘어가는 조건: `turns.named.txt`가 생겼다. 이후 작성은 이 파일만 원문으로 삼는다.

### 7. 쓴다

쓰기 전에 세 문서를 읽는다: [쓰기 규칙](references/writing.md), [편집 규칙](references/format.md), [도식](references/diagrams.md). 회의록을 만들면 [배포용 회의록](references/minutes.md)도 읽는다.

- 정리본은 `turns.named.txt`를 앞에서부터 따라가며 쓴다. 한 번에 다 쓰려 하지 말고 주제 섹션 하나씩, 그 구간의 원문을 다시 읽고 쓴다.
- 회의록은 회의 자료의 안건 순서를 뼈대로 삼고, 안건마다 원문에서 해당 구간을 찾아 쓴다.
- AI 요약본을 받았으면 다 쓴 뒤에 한 번 읽는다. 요약본에는 있는데 내 글에 없는 항목이 있으면 원문에서 확인해 보탠다. 요약본의 문장을 그대로 가져오지는 않는다.
- 넘어가는 조건: 산출물 파일이 있다.

### 8. 검수한다

`python S/transcript.py check 산출물.md --profile record --width 760 --sources 자료들 W/turns.txt`

회의록은 `--profile minutes`, 한글 문서로 변환할 것은 `--width 680`, Pele 대상 유형을 썼으면 `--target pele`을 준다. 형식 검사, 숫자 점검, 도식 렌더 검수를 한 번에 한다.

- 형식 검사의 오류는 모두 고친다.
- 도식 렌더에서 실패, 세로형, 폭 초과가 나오면 [도식](references/diagrams.md)의 패턴으로 다시 짠다. 통과한 그림도 PNG를 모두 열어 본다. 그림 폴더는 요약에 나온다.
- 형식 검사의 주의도 읽는다. "한 줄 사슬 도식"과 "도식의 대부분이 한 유형"은 도식을 다시 짜라는 뜻이고, 회의록의 "민감 표현 후보"는 그 줄을 다시 읽으라는 뜻이다.
- 숫자 점검에 나온 값은 하나씩 근거를 확인해 대장에 적는다. 근거가 없으면 지운다.
- 넘어가는 조건: 요약의 형식 검사가 "통과"이고 도식 렌더가 "모두 통과"다. 렌더를 못 했으면 못 했다고 전달에 적는다.

### 9. 질문 묶음을 내고 전달한다

[사람에게 묻기](references/hitl.md)에 따라 남은 질문을 한 번에 낸다. 답을 받으면 6단계부터 다시 돌려 반영한다. 사용자가 자리에 없어 물을 수 없으면 기본값으로 끝까지 완성하고, 질문 묶음을 대장과 전달 양쪽에 남긴다. 묻지 못했다는 이유로 이름을 지우거나 멈추지 않는다.

## 작업 폴더

`_work/`에는 `glossary.txt`, `roster.txt`, `turns.txt`, `speakers.md`, `terms.md`, `speaker-map.json`, `corrections.json`, `turns.named.txt`, `ledger.md`, `diagrams/`가 남는다. 원본 파일은 덮어쓰지 않는다. 산출물을 사용자의 볼트에 넣으라는 말이 없으면 작업 폴더 옆에 두고 위치를 알린다.

## 호스트에 맞추기

이 스킬은 Codex, Claude Code, Aside, 그 밖의 터미널 에이전트에서 같은 절차로 돈다. 도구만 그 호스트의 것을 쓴다.

- **질문**: 질문 도구가 있으면 그것으로, 없으면 답변 끝에 질문 묶음을 적는다.
- **로컬 검색**: 사용자가 알려 준 범위(볼트, 드롭박스, 프로젝트 폴더)에서 읽기만 한다.
- **메일과 일정**: 연결되어 있을 때만 쓴다. 없으면 건너뛰고 건너뛰었다고 대장에 적는다.
- **웹 검색**: 공개된 이름과 사실(기관명, 지명, 제품명)의 표기 확인에만 쓴다.
- **도식 렌더**: 같은 볼트의 `achmage-pele`를 자동으로 찾는다. 못 찾으면 `--pele 경로`를 준다. 그래도 없으면 문법 검사만 했다고 보고한다.

사적인 자료(메일, 볼트)는 확인 대장에 적힌 특정 의문을 풀 때만 찾고, 찾은 내용 중 그 의문과 무관한 것은 산출물에 옮기지 않는다.

## 자주 틀리는 곳

- 요약본을 고쳐 쓰는 것으로 끝낸다. 요약본은 초안일 뿐이고, 모든 문단을 `turns.named.txt`와 맞춰 봐야 한다.
- 화자 확정을 소거법만으로 끝낸다. 소거는 "유력"까지다.
- 유사도가 높다는 이유로 다른 사람의 이름을 명단의 이름으로 바꾼다. 문맥에서 같은 사람인지 확인한다.
- 자료의 값과 발언의 값이 다를 때 조용히 한쪽을 고른다. 대장에 둘 다 적는다.
- 세로로 긴 흐름도를 그린다. 한 줄에 4단계까지, 넘으면 줄을 나눈다.
- 불릿을 공백으로 들여쓴다. 탭으로 들여쓴다.
- 회의록에 "(전사 불확실)" 같은 표시를 남긴다. 회의록에는 확인된 것만 쓴다.

## 완료 판정

- `check`의 형식 검사가 통과하고, 모든 도식이 통과했다. 렌더를 못 했으면 못 했다고 적었다.
- 본문에 `Speaker N` 같은 라벨이 남지 않았다. 이름을 못 붙인 사람은 역할로 적었다.
- 숫자, 날짜, 이름, 결정, 담당, 기한이 원문이나 자료에서 확인된다.
- 확인 대장에 무엇을 어떤 근거로 고쳤는지, 무엇이 미확인인지, 어떤 바깥 기록을 봤는지 적혀 있다.

## 전달

아래 순서로 짧게 전한다. 검사한 것과 못 한 것을 구분해 말한다.

1. 배포 전에 꼭 확인할 것. "유력" 단계의 이름이 결정이나 담당에 쓰였으면 맨 앞에 적는다.
2. 산출물 경로.
3. 화자 대응표(이름, 확신, 근거).
4. 보정한 용어 수와 주요 항목.
5. 검수 결과.
6. 질문 묶음.

한글 문서로 내보내는 일은 변환기나 `hallym-kordoc`의 몫이며, 이 스킬은 변환에 맞는 Markdown까지 책임진다.

## 함께 쓰는 것

- `assets/plaud-template.md`: Plaud 앱에 넣는 전사 템플릿. 이 스킬과 같은 쓰기 규칙과 편집 규칙으로 요약본을 만든다. 그 요약본은 7단계의 초안으로 쓸 수 있다.
- `achmage-pele`: 도식의 유형 선택 기준과 렌더러.
- `hallym-kordoc`: 완성한 Markdown을 한림대 양식 HWPX로 조판.
- `hallym-meeting-sign`: 완성된 회의록 PDF의 서명 배치.
