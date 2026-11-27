export const MODELS = {
  tiny: {
    label: "Whisper Tiny · 빠른 기능 확인",
    repo: "onnx-community/whisper-tiny",
    revision: "ff4177021cc41f7db950912b73ea4fdf7d01d8e7",
    dtype: "q8",
    download: "약 41 MB",
    hint: "한국어 품질이 낮습니다. 다운로드·전사 동작 확인용입니다.",
  },
  small: {
    label: "Whisper Small · 기본",
    repo: "onnx-community/whisper-small",
    revision: "36050c46d777d46dc4b5f43f6d90574fc38f8732",
    dtype: "q8",
    download: "약 249 MB",
    hint: "한국어·영어 혼용을 지원합니다. 실제 속도는 기기에서 확인해야 합니다.",
  },
  turbo: {
    label: "Whisper Large v3 Turbo · 실험",
    repo: "onnx-community/whisper-large-v3-turbo",
    revision: "360ebcde2559d60bb474678be3c1de9ef347d01a",
    dtype: { encoder_model: "q4f16", decoder_model_merged: "q4f16" },
    download: "약 564 MB",
    hint: "WebGPU f16 필수. 파일 크기보다 실행 메모리가 더 크며 iPhone에서 종료될 수 있습니다.",
  },
} as const;
export type ModelId = keyof typeof MODELS;

/** Availability policy, not a claim about every Apple device's memory limit. */
export function isAppleMobile(nav: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}) {
  return (
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && (nav.maxTouchPoints || 0) > 1)
  );
}
export function asrUnavailable(
  model: ModelId,
  device: "webgpu" | "wasm",
  appleMobile: boolean,
): string | undefined {
  if (model === "turbo" && appleMobile)
    return "이 모바일 베타에서는 iPhone·iPad의 Turbo 실행을 중지했습니다. 초기화 중 페이지 재시작이 확인됐습니다. 아래에서 Small + CPU 또는 Tiny + CPU를 선택하세요.";
  if (model === "turbo" && device !== "webgpu")
    return "현재 Turbo 파일은 GPU 전용입니다. CPU를 사용하려면 Small 또는 Tiny로 모델도 바꿔야 합니다.";
}
