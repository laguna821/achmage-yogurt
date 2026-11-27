import { createSHA256 } from "hash-wasm";
import manifest from "./models.manifest.json";
import type { ModelId } from "./models";
export const modelCacheName = "achmage-yogurt-models-v1";
type Weight = { file: string; bytes: number; sha256: string };
const location = (model: ModelId, weight: Weight) =>
  `https://huggingface.co/${manifest[model].repo}/resolve/${manifest[model].revision}/${weight.file}`;
async function verify(
  body: ReadableStream<Uint8Array> | null,
  expected: Weight,
  progress: (n: number) => void,
) {
  if (!body) throw Error("모델 파일이 비어 있습니다.");
  const reader = body.getReader(),
    hash = await createSHA256();
  let count = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > expected.bytes)
        throw Error("모델 파일 크기가 맞지 않습니다.");
      hash.update(value);
      progress(count / expected.bytes);
    }
    if (count !== expected.bytes || hash.digest("hex") !== expected.sha256)
      throw Error(
        "모델 파일 검증에 실패했습니다. 파일이 불완전하거나 선택한 버전과 다릅니다.",
      );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Each pinned weight is streamed through SHA-256 before ONNX is allowed to load it. */
export async function prepareWeights(
  model: ModelId,
  progress: (p: object) => void,
) {
  const cache = await caches.open(modelCacheName);
  for (const weight of manifest[model].weights) {
    const url = location(model, weight),
      cached = await cache.match(url);
    if (cached) {
      try {
        await verify(cached.body, weight, (n) =>
          progress({
            status: "progress",
            file: "검증 " + weight.file,
            progress: n * 100,
          }),
        );
        continue;
      } catch {
        await cache.delete(url);
        throw Error(
          "저장된 모델 검증에 실패했습니다. 다시 시작하면 올바른 파일을 다운로드합니다.",
        );
      }
    }
    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) throw Error(`모델 다운로드 오류 ${response.status}`);
    const writing = cache.put(url, response.clone());
    try {
      await Promise.all([
        writing,
        verify(response.body, weight, (n) =>
          progress({
            status: "progress",
            file: weight.file,
            progress: n * 100,
          }),
        ),
      ]);
    } catch (e) {
      await writing.catch(() => {});
      await cache.delete(url);
      throw e;
    }
  }
}
export async function importWeights(
  model: ModelId,
  files: File[],
  progress: (s: string) => void,
) {
  const cache = await caches.open(modelCacheName);
  for (const file of files) {
    const weight = manifest[model].weights.find(
      (w) => w.file.split("/").pop() === file.name,
    );
    if (!weight) throw Error("선택한 모델에 해당하지 않는 파일: " + file.name);
    await verify(file.stream(), weight, (n) =>
      progress(file.name + " 검증 " + Math.round(n * 100) + "%"),
    );
    await cache.put(
      location(model, weight),
      new Response(file, {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
  }
}
