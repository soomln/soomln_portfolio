# Soomln — Web Designer Portfolio 2026

웹디자이너 최수민의 포트폴리오 사이트입니다.
Figma로 디자인하고 HTML / Sass / 바닐라 JavaScript로 직접 구현했습니다.

**사이트 보기 → https://soomln.github.io/soomln_portfolio/**

> 데스크톱 화면(1440px 기준)에 맞춰 제작했습니다. PC 브라우저에서 보시는 것을 권장합니다.

## 프로젝트

| No. | 프로젝트 | 내용 | 도구 |
|---|---|---|---|
| 01 | [Soomln 포트폴리오 웹사이트](project-portfolio.html) | 이 사이트. WebGL 연기 배경과 커서 인터랙션 | Figma · Sass · WebGL |
| 02 | [DAYLONG 수분 세럼 상세페이지](project-daylong.html) | 속건조 직장인의 하루를 따라가는 화장품 상세페이지 (11개 섹션) | Figma · Photoshop · AI 이미지 |
| 03 | [ROLL 36 하프넥 니트 상세페이지](project-roll36.html) | 필름 한 롤 콘셉트의 남녀 공용 니트 상세페이지 (6개 섹션) | Figma · Photoshop · AI 이미지 |

DAYLONG과 ROLL 36은 포트폴리오를 위한 **가상 브랜드**이며, 상세페이지 속 수치·후기·사이즈는 예시 데이터입니다.

## 주요 기능

- **WebGL 연기 배경**: 셰이더로 연기를 실시간 생성하고, 커서가 지나간 자리의 연기가 흩어집니다.
- **인터랙션**: 커스텀 커서, 스크롤 등장 애니메이션, 마우스 패럴랙스, 마그네틱 버튼, 스크롤 진행 바
- **케이스 스터디 페이지**: 프로젝트마다 기획 의도, 디자인 시스템, 860px 상세페이지 전체 보기, 작업 과정을 정리했습니다.

## 기술 스택

- HTML5, Sass(SCSS), JavaScript (라이브러리 없음)
- WebGL2 셰이더 (`js/marble.js`)
- 디자인: Figma, Photoshop

## 폴더 구조

```
index.html                메인 페이지 (6개 섹션)
project-*.html            프로젝트별 케이스 스터디 페이지
scss/
  abstracts/              색·폰트 토큰, u() 함수(1440 기준 → 화면 비율), mixin
  base/ layout/           리셋, 기본 타이포, 섹션 공통
  components/             커서, 버튼
  utilities/              스크롤 등장 애니메이션
  sections/               메인 페이지 01 hero ~ 06 contact
  pages/                  케이스 스터디 페이지
css/main.css              Sass 빌드 결과물 (직접 수정하지 않음)
js/main.js                커서, 스크롤 등장, 패럴랙스, 마그네틱 버튼
js/marble.js              WebGL 연기 배경
assets/img/               이미지 (프로젝트별 폴더)
docs/                     기획서, 와이어프레임
```

## 로컬에서 실행하기

```bash
npm install      # 처음 한 번
npm run dev      # Sass 자동 빌드 + http://localhost:5173 서버 실행 (종료: Ctrl + C)
```

> `index.html`을 더블클릭해서(file://) 열면 브라우저 보안 정책 때문에 WebGL 효과가 꺼지고 정적인 배경이 보입니다.

## 출처

- 폰트: Anton, Montserrat, Pretendard, Cormorant Garamond, DM Mono (모두 SIL Open Font License)
- 아이콘: Lucide (ISC), Tabler Icons (MIT)
- 상세페이지 이미지: Google Gemini · ChatGPT로 생성한 뒤 Photoshop으로 합성·보정

© 2026 Soomln. All rights reserved.
