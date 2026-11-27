# iPhone 단독 PWA 설계 검토 — 2026-11-27

원 설계와 정책 검토 기록이다. 2026-11-27 모바일 베타를 구현했으며 현재 기능·검증·제약은 [모바일 베타](MOBILE-BETA.md)를 따른다. iPhone에서 새 실제 ASR 버전의 검증은 아직 남아 있다. 구현 순서와 출시 기준은 [실행계획](MOBILE-TEST-PLAN.md)을 따른다.

## 권장 구성

- 모바일 전용 정적 PWA를 HTTPS로 배포하고 홈 화면에 추가한다. Apple 개발자 서명 프로필을 사용하지 않는다.
- 앱 코드·WASM만 정적 호스팅한다. 로컬에서 빌드해 직접 업로드하므로 GitHub Actions와 원격 빌드가 필수는 아니다. 개발 컴퓨터는 앱 사용 중 필요하지 않다.
- 녹음 또는 Files 가져오기 → 기기 내 WebGPU/검증된 WASM 전사 → Markdown 편집·내보내기. 서버 추론·DB·음성 업로드·텔레메트리는 기본 구성에 없다.
- 모델은 지원 형식·revision·checksum이 명시된 번들을 Files에서 가져온다. 데스크톱 GGML 모델이 ONNX 엔진에서 그대로 작동한다고 가정하지 않는다.
- 선택적 온라인 모델 다운로드는 해당 호스트 정책에 종속된다. 앱 호스팅의 무료 정적 요청과 모델 배포를 혼동하지 않는다.
- 모델·원본·중간 결과는 OPFS/IndexedDB에 저장한다. Storage API의 persist/estimate를 확인하고 Files 백업·복원을 제공한다. 서비스 워커는 앱 코드·런타임을 캐시한다.

## 현재 정책과 선택

| 항목 | 공식 문서 확인 | 설계 |
| --- | --- | --- |
| Cloudflare Static Assets | 정적 요청 무료·무제한, Worker script 호출 별도 | 정적 asset 직접 제공만 사용 |
| Pages | 무료 월 500빌드, 20,000파일, 개별 asset 25MiB | 미리 빌드한 앱 직접 업로드, 모델 제외 |
| Workers Free | 일 100,000요청, 호출당 CPU 10ms | 전사·프록시로 사용하지 않음 |
| R2 Standard | 월 10GB-month, Class A 100만, Class B 1천만 무료분, 초과 별도 | 기본 구성에서 제외 |
| GitHub Pages | Free는 public 저장소, 사이트 1GB, 월 100GB soft bandwidth | 앱 코드 배포 대안 |
| Actions | 현재 Free private 포함 compute 월 $12; public standard runner/Pages 무료, 큰 runner·스토리지 별도 | 로컬 빌드로 runner 실행 생략 |

Cloudflare run_worker_first와 Workers Caching은 별도 요청 계량 경로가 될 수 있다. 단순 정적 제공 구성과 혼동하지 않는다. 영구무료 정책이나 모든 호스팅 제한의 제거를 보장하는 설계는 아니다.

## 모델과 장시간 사용 검증

Safari 26은 iOS WebGPU를 제공하며 Transformers.js는 Whisper WebGPU 예제를 제공한다. API 지원 자체가 모든 모델의 성공이나 실시간 속도를 보장하지 않는다.

ONNX Community turbo q4f16 weights 예시는 encoder 370MB + merged decoder 194MB, 약 564MB다. tokenizer/config·텐서·KV cache·GPU 버퍼·오디오 메모리는 별도다. 파일 크기를 실행 RAM으로 해석하지 않는다.

한국어 다국어 base/small과 turbo를 비교한다. 영어 전용 .en 모델을 기본값으로 사용하지 않는다. 정확도 측정 없이 tiny를 한국어 기본값으로 확정하지 않는다. Turbo는 검증 전 실험 옵션이다.

기기에서 30초 한국어·영어 혼합 샘플로 준비 시간·전사 속도·고유명사 오류·메모리 실패를 검사한다. 대표 수 분 표본으로 기기 동작과 중단 복구를 확인하고, 많은 구간과 실패 상황은 개발환경 자동시험으로 검증한다. 10시간은 긴 입력 설계 예시이며 전체 길이의 실기기 시험을 출시 조건으로 삼지 않는다. 짧은 시험으로 장시간 발열·배터리 지속성을 보장하지 않는다. WebGPU adapter/features/limits와 shader-f16을 확인한다. 실패 시 자동으로 서버에 전송하지 않는다.

화면 잠금·백그라운드 장시간 녹음을 실기기 검증 전 보장하지 않는다. 원본을 주기적으로 저장하고 전사를 구간 단위로 처리한다. 긴 오디오 전체를 RAM에 펼치지 않도록 decoder를 선정한다. 마지막 확정 구간과 overlap 정보를 저장해 화면 복귀 후 재개한다. 전화·GPU device loss·탭 종료·용량 부족·업데이트 중단을 검증한다. 동일 iPhone 음성 메모에서 녹음 후 파일을 가져오는 경로를 함께 제공한다. 컴퓨터는 필요 없다.

오프라인 표시는 앱·모델 캐시 검증 후 제공한다. 브라우저 데이터 삭제 가능성에 대비해 Files 백업·복원을 제공한다.

## 기능 경계

1. 로컬 녹음/파일 → 전사 → 편집 → MD/원본 내보내기를 첫 범위로 한다.
2. 고급 생성형 후처리는 별도 LLM 문제다. 기기 내 LLM은 한국어 품질·RAM·발열 검사 후 선택 기능으로 검토한다. 데스크톱 구독 CLI 인증이 웹앱으로 자동 이전되지 않는다.
3. 외부 고급 AI는 사용자 선택 연결로 검토하고 무료 기본 전사와 비용을 구분한다.
4. YouTube 자동 획득은 데스크톱 yt-dlp/FFmpeg 및 브라우저 CORS 차이가 있어 정적 PWA에서 동일 기능을 약속하지 않는다. 우선 음성/전사 파일 가져오기를 제공한다.
5. Gmail·볼트·웹 조사까지 포함하는 데스크톱 정리 품질을 오프라인 ASR만으로 달성했다고 표시하지 않는다.

## 공식 근거

- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- https://webkit.org/blog/14403/updates-to-storage-policy/
- https://huggingface.co/docs/transformers.js/guides/webgpu
- https://huggingface.co/onnx-community/whisper-large-v3-turbo/tree/main/onnx
