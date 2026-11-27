import type { ModelId } from "./models";
export class Asr {
  private worker = new Worker(new URL("./asr.worker.ts", import.meta.url), {
    type: "module",
  });
  private seq = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason: unknown) => void }
  >();
  constructor(private progress: (p: any) => void) {
    this.worker.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      if (e.data.progress) {
        this.progress(e.data.progress);
        return;
      }
      this.pending.delete(e.data.id);
      if (e.data.error) p.reject(Error(e.data.error));
      else p.resolve(e.data.result);
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values())
        p.reject(Error(e.message || "음성 엔진이 중단되었습니다."));
      this.pending.clear();
    };
  }
  call(
    action: string,
    args: object,
    transfer: Transferable[] = [],
  ): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, action, ...args }, transfer);
    });
  }
  load(model: ModelId, device: "webgpu" | "wasm") {
    return this.call("load", { model, device });
  }
  transcribe(pcm: Float32Array, language: string) {
    return this.call("transcribe", { pcm, language }, [pcm.buffer]);
  }
  close() {
    this.worker.terminate();
    for (const p of this.pending.values())
      p.reject(new DOMException("일시 중지했습니다.", "AbortError"));
    this.pending.clear();
  }
}
