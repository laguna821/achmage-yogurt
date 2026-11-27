import { prepareWeights, modelCacheName } from "./modelCache";
import { env, pipeline } from "@huggingface/transformers";
import { MODELS, type ModelId, isAppleMobile, asrUnavailable } from "./models";
env.allowLocalModels = false;
env.useBrowserCache = false;
env.useCustomCache = true;
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.wasmPaths = new URL("../ort/", self.location.href).href;
let transcriber: any;
self.onmessage = async (event: MessageEvent) => {
  const { id, action, model, device, pcm, language } = event.data;
  try {
    if (action === "prepare" || action === "load") {
      const m = MODELS[model as ModelId];
      if (!m) throw Error("알 수 없는 모델입니다.");
      const unavailable = asrUnavailable(
        model,
        device,
        isAppleMobile(navigator),
      );
      if (unavailable) throw Error(unavailable);
      if (device === "webgpu") {
        const adapter = await (navigator as any).gpu?.requestAdapter();
        if (!adapter)
          throw Error(
            "WebGPU를 사용할 수 없습니다. 설정에서 CPU를 직접 선택하세요.",
          );
        if (model === "turbo" && !adapter.features.has("shader-f16"))
          throw Error("Turbo는 f16 지원이 필요합니다.");
      } else if (model === "turbo")
        throw Error("Turbo는 WebGPU 모드에서만 시험할 수 있습니다.");
      env.customCache = await caches.open(modelCacheName);
      const start = performance.now();
      if (action === "prepare") {
        await prepareWeights(model, (progress) =>
          self.postMessage({ id, progress }),
        );
        self.postMessage({
          id,
          result: { prepareMs: performance.now() - start },
        });
        return;
      }
      transcriber = await pipeline("automatic-speech-recognition", m.repo, {
        device,
        dtype: m.dtype as any,
        revision: m.revision,
        progress_callback: (progress: any) =>
          self.postMessage({ id, progress }),
      });
      self.postMessage({ id, result: { loadMs: performance.now() - start } });
    } else {
      if (!transcriber) throw Error("모델을 먼저 불러오세요.");
      const start = performance.now();
      const output = await transcriber(pcm, {
        language: language === "auto" ? undefined : language,
        task: "transcribe",
        return_timestamps: false,
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      self.postMessage({
        id,
        result: { text: output.text, ms: performance.now() - start },
      });
    }
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
