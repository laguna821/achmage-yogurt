# 개발·서명 없는 배포

Node 24와 pnpm 10.7.0을 사용합니다. 원래 MIT 저작권 고지를 유지합니다. 현재 소스와 이 컴퓨터의 Linux 설치 버전은 `0.4.0-achmage.2`입니다. GitHub의 기존 Windows/macOS/Linux 사전 릴리스는 `0.4.0-achmage.1`이며, 이번 YouTube 오류 수정으로 원격 설치본을 다시 배포하지 않았습니다.

```sh
pnpm install --frozen-lockfile
pnpm -C app typecheck
pnpm -C app exec vitest run
pnpm -C app native
pnpm -C app prepare:tools
pnpm -C app exec electron-vite build
```

`native`는 해당 OS의 오디오·시스템·Whisper 헬퍼를 컴파일합니다. `prepare:tools`는 FFmpeg/FFprobe, Node, yt-dlp, CPython, 공식 Codex 클라이언트와 PDF worker를 준비합니다. 사용자 프로필·자격 증명·음성 모델을 빌드에 복사하지 않습니다. 다운로드 체크섬·출처는 `resources/tools/manifest.json`에 남습니다.

서명·공증 없이 **실행한 플랫폼**에서 패키징:

```sh
# app 폴더에서, 플랫폼에 맞는 명령 하나
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --linux AppImage --publish never
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --win nsis --publish never
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac zip --publish never
```

Windows PowerShell의 환경변수 설정은 `$env:CSC_IDENTITY_AUTO_DISCOVERY='false'`입니다. Mac `identity: null`, `notarize: false`, Windows `signExecutable: false`를 유지합니다. 서명 자격증명은 필요하지 않습니다. 자동 업로드도 하지 않습니다.

## Linux에서 Windows·Mac 교차 빌드

이번에는 Actions 사용량을 소비하지 않도록 로컬 교차 빌드를 사용했습니다. `app/out`을 먼저 완성한 뒤 저장소 루트에서 실행합니다.

```sh
node app/scripts/cross-desktop.mjs win32 /absolute/temp/cross-windows
node app/scripts/cross-desktop.mjs darwin /absolute/temp/cross-mac
```

- `unzip`, `tar`, 7zz가 필요합니다. Windows 기반 설치본을 추출할 때는 `SEVEN_ZIP=/absolute/path/to/7zz`로 지정할 수 있습니다.
- Windows NSIS 제거 프로그램은 electron-builder에 포함된 `UninstallerReader`로 중간 PE에서 추출합니다. Linux의 Wine 초기화나 Windows 실행이 필요하지 않습니다. 교차 빌드 스크립트 안에서 해당 NSIS 호출만 한정해 바꿉니다.
- 이 경로는 원래 Yogurt `v0.3.38`의 공개 설치본에서 **변경하지 않은** 플랫폼별 캡처·Whisper 헬퍼를 가져옵니다. 공식 release asset의 SHA256 digest로 확인합니다. 기존 앱 UI·개인 데이터는 가져오지 않습니다.
- Codex 플랫폼 패키지는 npm의 실제 버전 별칭을 사용합니다. 다운로드의 npm integrity와 실행파일 SHA256을 기록합니다.
- 생성된 플랫폼 전용 설정 JSON을 직접 전달하여 호스트 Linux 리소스와 섞이지 않게 합니다.
- Mac 교차 빌드는 ZIP입니다. Linux에서 DMG 생성·Apple 서명·공증은 하지 않습니다. Mac 바이너리의 fuse 수정도 수행하지 않습니다.
- 교차 빌드는 실기기 검증을 대체하지 않습니다. Windows 오디오 캡처·설치/제거, macOS 마이크·시스템 오디오 권한과 로그인은 실제 장치에서 별도 확인해야 합니다.

교차 빌드는 압축 레벨 1을 기본으로 사용하여 빌드 시간을 줄입니다. `ELECTRON_BUILDER_COMPRESSION_LEVEL`로 변경할 수 있습니다.

결과는 `app/dist/`입니다. 네이티브 헬퍼 자체를 바꾸는 작업은 이 교차 경로로 배포하면 안 됩니다. 해당 OS에서 `native`를 재빌드하고 시험해야 합니다.

## GitHub 사용량

두 활성 워크플로는 모두 `workflow_dispatch` 전용입니다. push/PR/schedule로 자동 실행하지 않습니다. 업로드 아티팩트 보관은 3일, 작업 타임아웃은 55분입니다. 기존 upstream 워크플로는 `.github/upstream-workflows/`에 자료로만 보관했습니다.

현재 연결 범위로는 계정의 Actions 잔여량을 조회하지 못했습니다. 저장소는 비공개이며 이번 빌드에서 Actions를 실행하지 않았습니다. 수동 실행 전 계정 Billing에서 포함량·사용량·예산을 확인해야 합니다. 저장소 commit/push와 Actions runner 사용량은 서로 다릅니다.

초기 배포는 자동 업데이트를 사용하지 않습니다. 공개 배포나 자동 업데이트를 켜기 전 플랫폼 실기기 시험과 각 런타임의 배포 라이선스/소스 제공 의무를 검토하세요. GPL FFmpeg는 제공한 버전·빌드 출처와 라이선스를 계속 동봉해야 합니다.
