# Achmage Yogurt 모바일 베타 0.1

2026-11-27. 실행 주소: https://laguna821.github.io/achmage-yogurt/

Safari로 열고 기록함 암호·복구 키를 만든 뒤 **새로 가져오기**에서 녹음, 음성·전사 파일, YouTube 자막을 선택한다. Safari 공유 → 홈 화면에 추가로 설치한다. 데스크톱 앱을 실행해 두거나 Apple 개발자 계정을 만들 필요가 없다.

## 구현한 범위

- IndexedDB에 제목·전사·본문·맥락·API 설정·앱 내 녹음 조각을 AES-256-GCM으로 암호화한다. 저장마다 무작위 nonce, 레코드 ID를 AAD로 사용한다. 암호는 PBKDF2-SHA256 600,000회로 키를 감싼다. 복구 키·마스터 키를 URL, 코드, localStorage에 넣지 않는다.
- 5초 단위 MediaRecorder 저장. 전면 녹음과 중지 후 전사. 화면 잠금·전화·앱 전환 중 계속 녹음되는 것은 보장하지 않는다. 파일 컨테이너 특성상 비정상 종료된 녹음은 완전 복구가 안 될 수 있다.
- Mediabunny로 WAV/MP3/M4A 등 기기에서 지원하는 코덱을 구간 단위로 해독하고, 최대 30초 PCM을 OfflineAudioContext로 16 kHz mono 변환한다. 원본 파일 전체를 decodeAudioData에 전달하지 않는다. 앱 내 녹음은 암호화 조각을 필요한 범위만 읽는다.
- Whisper Tiny q8(기능 확인용), Small q8(기본), Large v3 Turbo q4f16(실험)을 Worker에서 실행한다. Transformers.js 3.8.1, Mediabunny 1.66.5를 고정했다. 각 모델 revision·가중치 크기·SHA-256은 `app/mobile-lab/core/models.manifest.json`에 있다. 가중치를 스트리밍 검증한 뒤 ONNX가 읽는다. 캐시 또는 정확한 ONNX 파일 직접 가져오기를 지원한다. 토크나이저·설정은 첫 실행에 추가 다운로드한다.
- 입력 파일은 1 MiB씩 모든 바이트를 해시해 동일성을 확인한다. 구간 저장 후에만 완료 커서를 전진시킨다. 중단 후 같은 원본을 다시 선택해 미완료 구간부터 재개한다. 다른 모델·언어로 중간에 바꾸면 혼합하지 않고 중단한다.
- YouTube 직접 자막 획득 경로를 구현했다. 브라우저 CORS/요청 제한/자막 없음은 사용자에게 설명한다. 실패하면 숨겨진 프록시, 유료 API, 전체 영상 재전사로 전환하지 않는다. 자막·전사 파일과 붙여넣기가 대체 경로다. **정적 웹앱에서 모든 YouTube 링크를 자동 처리한다는 약속은 아니다.**
- 명시적으로 설정한 HTTPS OpenAI 호환 Chat Completions 서버에 전사와 참고 텍스트를 보내는 AI 정리. 데스크톱의 근거 분석 → 상세 작성 → 원문 대조·최종 편집 프롬프트를 재사용한다. 분량이 큰 전사는 구간별로 완료·캐시한다. 출력 중단/빈 답변은 기존 완성본을 덮어쓰지 않는다. AI는 기본 무료 전사와 별개이며 API 이용료가 생길 수 있다.
- 공통 Markdown 라이브 편집기, Pele 도식·소스 전환, MD 복사·파일 내보내기. 본문에는 재생 타임라인을 강제로 추가하지 않는다. TXT/MD 맥락과 확인 질문에 대한 답을 덧붙여 다시 정리할 수 있다.
- OPFS에 암호문만 스트리밍해 만드는 `.ayvault` 백업: 앱 내 녹음 포함, 외부에서 가져온 원본 파일은 제외. 복원은 별도 DB에 쓰고 모든 항목과 암호화된 끝 목록을 검증한 뒤 활성 DB를 전환한다. 중간에 잘리거나 손상된 파일은 기존 기록을 유지한다.
- `.aynote` 암호화 공유 파일에는 제목·본문·맥락·전사가 포함된다. 새 무작위 키를 따로 전달한다. 키를 가진 누구나 열 수 있으며 계정/기기 고정 공유가 아니다. 음성은 공유 파일에서 제외한다.
- 정적 PWA: 앱·WASM만 서비스 워커에 캐시한다. AI 응답·API 키·개인 문서를 서비스 워커가 캐시하지 않는다. 작업 중 업데이트를 활성화하지 않으며 사용자가 저장 후 업데이트한다. 오류 알림은 닫을 수 있다.

## cmds-share에서 채택한 점과 바꾼 점

검토한 cmds-share 2.5.5의 암호화 공유는 URL fragment 키를 가진 사람이 여는 방식이었다. 계정 인증으로 해석하지 않는다. 여기서는 키를 전체 기록함의 열쇠와 분리하고, 제목·본문·맥락·전사를 한 암호문에 넣는다. 공개 앱 주소에는 개인 자료를 업로드하지 않는다. 암호화는 신뢰할 수 없는 앱 코드 자체나 잠금 해제 상태의 기기 탈취까지 방어하는 수단은 아니다. 별도 계정 접근 제한·Cloudflare Access 배포 마법사는 이번 베타에 포함하지 않는다.

## 검증과 한계

- TypeScript, 단위 보안/데이터 검증, Chromium 430px 화면·실제 IndexedDB/OPFS 검증을 수행했다.
- 1,201개 **가상 ASR 결과**로 커서 저장 전 종료·재개·중복 방지 및 암호화 백업 복원을 검사했다. 10시간 실제 음성 전사 시험이 아니다.
- 실제 WAV/M4A/MP3 디코딩 및 65초 파일의 30+30+5초 처리, 암호화 녹음 읽기를 확인했다.
- 실제 Tiny WASM 실행 경로와 공개 영어 음성 인식, 모델을 캐시한 뒤 오프라인 재전사, Small Node CPU 인식을 확인했다. Tiny는 합성음성을 오인식했고 Small은 같은 표본을 인식했다. 한국어 정확도 비교가 아니다.
- Chromium 소프트웨어 GPU의 Small 시험은 제한 시간 내 완료되지 않았다. 이를 iPhone GPU의 속도로 해석하지 않는다. iPhone14 Pro Max의 WebGPU/f16/OPFS 사전 지원만 기존 사용자 결과로 확인했다. **이번 실제 ASR 버전의 iPhone 실행·속도·발열은 미확인이다. Turbo도 실험 옵션이다.**
- AI 네트워크·3단계 흐름 검증은 합성 응답으로 수행했다. 유료 AI 호출·개인 음성 업로드·Sonnet 호출은 하지 않았다.
- 긴 문서의 정리는 구간별 원문 검수를 한다. 구간 간 전체 문서 중복 제거·재구성은 아직 추가 작업이다. Gmail/볼트/웹 조사, 이미지/PDF 증거 추출, 영상 화면 캡처, 딥리서치, 구독 CLI 연결은 모바일에 포함하지 않는다.
- 10시간 실기기 시험을 출시 조건으로 삼지 않는다. 다음 사용자 확인은 한국어+영어 용어를 섞은 30–60초 녹음, 일시 중지·재개, 백업 복원이다. 시간이 긴 녹음을 iOS 백그라운드에서 무제한 처리한다고 보장하지 않는다.

## 배포·개발

`pnpm --filter @yogurt/app mobile:build`로 정적 파일을 만든다. `app/mobile-lab-dist`만 Pages에 배포한다. 모델·개인 파일·API 키는 배포물에 넣지 않는다. 현재 빌드는 로컬에서 수행하므로 앱 사용량이나 ASR 길이에 따라 GitHub Actions 실행 시간이 증가하지 않는다. GitHub Pages 트래픽 및 모델 다운로드 호스트의 정책 자체가 사라지는 것은 아니다.

기존 설치형 앱·프로필은 변경하지 않는다. 모바일 소스는 `app/mobile-lab`에 있으며 초기 시험 화면을 실제 모바일 앱으로 확장했다.

연구 연결:
- cmds-share: `research:rr-9a8b75cc784341fa263bbc62ade3329a:ba8e9c7201c68e12dceaa89505d699bf6b678ff12435a7c0ce3ed2b9b73a10e1`
- 실행계획: `research:rr-a47a662e3bbb2d9db9a011be7ed721c3:d1077a48c0f41676d13b5efdf665813a2a823bd851f4b430f1b632189a1fd3d3`
- ASR 불일치 대조: `research:rr-89861c06513de869c791db778fed4b47:5694da4a4c78277cb5acd76c82c7c66360c48578d70d64cbf167845274df3492`

재현 가능한 자동 검사(저장 데이터는 가상 자료):

```sh
pnpm -C app exec vitest run test/mobile.test.ts
pnpm -C app typecheck
pnpm --filter @yogurt/app mobile:build
# 터미널 1: 빌드된 화면
python3 -m http.server 5188 --bind 127.0.0.1 --directory app/mobile-lab-dist
# 터미널 2: UI·암호화·녹음·AI 모의 응답·오프라인 앱 화면
node app/scripts/mobile-ui-smoke.mjs
# 터미널 3: 저장 구조 시험용 개발 서버
pnpm -C app exec vite --config mobile-lab/vite.config.ts --host 127.0.0.1 --port 5189
# FFmpeg로 합성 WAV/M4A/MP3를 만든 뒤 1201개 논리 구간 저장/복구 검사
node app/scripts/mobile-storage-smoke.mjs
```

Playwright Chromium이 필요하다. 스모크 출력은 시스템 임시 폴더 또는 `YOGURT_TEST_OUTPUT`에 저장한다. 스토리지 검사는 실제 ASR 성능 시험이 아니며, UI의 AI 응답도 외부 서비스를 호출하지 않는 모의 응답이다.
