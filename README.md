# YouTube Essay Generator — Obsidian Plugin

YouTube 영상 URL에서 트랜스크립트를 추출해 **AEON 스타일(영어)** 또는 **뉴필로소퍼 스타일(한국어)** 에세이를 자동 생성하는 Obsidian 플러그인입니다.

---

## 작동 방식

```
YouTube URL
    │
    ▼
youtube-transcript 패키지로 자막 추출 (API 키 불필요)
    │
    ▼
Claude API 다단계 생성
  1단계: 전체 개요(목차) 생성
  2단계: 서론 작성
  3단계: 각 섹션 순차 작성 (토큰 초과 방지)
  4단계: 결론 작성
    │
    ▼
소제목 목차 포함 마크다운 파일로 저장
```

**토큰 효율**: 트랜스크립트가 길면 청크로 분할 → 먼저 요약 → 개요 생성 → 섹션별 작성  
(한 번에 전체를 보내지 않아 API 비용 절감)

---

## 빌드 & 설치

> **주의**: Google Drive 등 특수 경로에서는 npm 패키지 설치 시 오류가 발생할 수 있습니다.  
> 반드시 **일반 로컬 경로** (예: `C:\dev\youtube-essay-plugin`)에서 빌드하세요.

### 1. 빌드

```bash
# 프로젝트 폴더를 로컬 경로로 복사한 뒤
cd C:\dev\youtube-essay-plugin

npm install
npm run build
```

빌드 후 `main.js` 파일이 생성됩니다.

### 2. Obsidian에 설치

1. Obsidian vault의 `.obsidian/plugins/` 폴더에 `youtube-essay-plugin` 폴더 생성
2. 다음 3개 파일을 복사:
   - `main.js`
   - `manifest.json`
   - (선택) `styles.css`
3. Obsidian → Settings → Community Plugins → 플러그인 목록에서 **YouTube Essay Generator** 활성화

### 3. 설정

Settings → YouTube Essay Generator:

| 항목 | 설명 |
|------|------|
| **Anthropic API Key** | `console.anthropic.com`에서 발급 |
| **Claude Model** | Opus 4.8 (고품질) / Sonnet 4.6 (빠름) |
| **Output Folder** | 에세이 저장 폴더 (기본: `Essays`) |
| **Default Language** | 한국어(뉴필로소퍼) / English(AEON) |

---

## 사용법

1. Obsidian 좌측 리본의 🎬 아이콘 클릭 (또는 Command Palette → "Generate essay from YouTube URL")
2. YouTube URL 입력
3. 언어/스타일 선택
4. **Generate Essay** 클릭
5. 진행 상황 바를 보며 대기 (영상 길이에 따라 1~5분)
6. 완료 시 에세이 노트가 자동으로 열림

---

## 에세이 스타일

### 🇺🇸 AEON Style (English)
- 생생한 장면이나 도발적인 질문으로 시작
- 철학·과학·심리·문화를 가로지르는 지적 탐구
- 소제목은 목차가 아닌 챕터 제목처럼 시적으로
- 3,000–6,000 단어 분량

### 🇰🇷 뉴필로소퍼 스타일 (한국어)
- 일상의 장면이나 철학적 질문으로 도입
- 소크라테스·하이데거·푸코 등 철학 전통과 현대적 대화
- 소제목은 질문형 또는 명상적 문구
- 수사적 질문으로 독자 내면 성찰 유도
- 3,000–6,000자 이상 충분한 분량

---

## 생성 결과 예시

```markdown
---
title: "의식의 미결 문제: 우리는 왜 느끼는가"
source: "https://www.youtube.com/watch?v=..."
generated: "2026-06-10"
style: "뉴필로소퍼 에세이"
language: "ko"
---

# 의식의 미결 문제: 우리는 왜 느끼는가

## 목차

1. [어둠 속의 붉은색](#section-1)
2. [좀비의 철학적 가능성](#section-2)
...

---

어제 저녁, 창밖으로 지는 노을을 바라보다 문득 이런 생각이 들었다...

## 어둠 속의 붉은색 {#section-1}
...
```

---

## 제한 사항

- 자동 자막이 없는 영상은 트랜스크립트 추출 불가
- `youtube-transcript` 패키지는 비공식 API 사용 → YouTube 업데이트 시 깨질 수 있음
- API 비용: Opus 기준 영상당 약 $0.05–0.20 (영상 길이에 따라 다름)
