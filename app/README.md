# Do it(두잇) Widget

macOS용 상시 노출 할 일·일정 위젯의 첫 실행 가능한 MVP입니다.

## 실행

```bash
npm install
npm run dev
```

## macOS 다운로드용 앱 만들기

```bash
npm run package:mac
```

생성 결과는 `release/Do it Widget-0.1.0.dmg`와 `release/mac/Do it Widget.app`입니다. 현재 빌드는 Apple 개발자 서명·공증 전의 로컬 테스트용 unsigned 앱입니다.

## 현재 범위

- 접힘 기본, hover 시 남은 할 일 개수, 클릭 시 전체 목록
- 개중요 / 챙겨두자 / 천천히 중요도
- 체크박스 완료 및 오늘 할 일 추가
- 회의 시작 30분 전 위젯 안내 계산
- 기기 상단 중앙 기본 배치, 드래그 이동 및 위치 저장
- 할 일별 macOS 푸시 리마인드
- 항상 위, 자동 실행, 내용 숨김 설정
- 로컬 영구 저장

Notion 및 Microsoft 인증·동기화는 다음 단계이며 설정 버튼은 현재 비활성화되어 있습니다.
