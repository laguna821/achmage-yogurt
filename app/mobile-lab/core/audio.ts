import {
  Input,
  BlobSource,
  ALL_FORMATS,
  AudioBufferSink,
  CustomSource,
  type Source,
} from "mediabunny";
export const CHUNK_SECONDS = 30;
export async function openAudio(file: Blob | Source) {
  const input = new Input({
    source: file instanceof Blob ? new BlobSource(file) : file,
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode()))
      throw Error(
        "이 기기에서 이 음성 코덱을 읽을 수 없습니다. WAV 또는 M4A/AAC 파일을 선택하세요.",
      );
    const duration = await track.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0)
      throw Error("음성 길이를 확인할 수 없습니다.");
    const sink = new AudioBufferSink(track);
    return {
      duration,
      close: () => input.dispose(),
      async chunk(index: number, signal: AbortSignal) {
        const start = index * CHUNK_SECONDS,
          end = Math.min(duration, start + CHUNK_SECONDS);
        if (end <= start) throw Error("잘못된 음성 구간입니다.");
        const context = new OfflineAudioContext(
          1,
          Math.ceil((end - start) * 16000),
          16000,
        );
        let count = 0;
        for await (const { buffer, timestamp } of sink.buffers(start, end)) {
          signal.throwIfAborted();
          const from = Math.max(start, timestamp),
            to = Math.min(end, timestamp + buffer.duration);
          if (to <= from) continue;
          const node = context.createBufferSource();
          node.buffer = buffer;
          node.connect(context.destination);
          node.start(from - start, from - timestamp, to - from);
          count++;
        }
        signal.throwIfAborted();
        if (!count) throw Error("음성 구간을 해독하지 못했습니다.");
        const rendered = await context.startRendering();
        signal.throwIfAborted();
        return { start, end, pcm: rendered.getChannelData(0) };
      },
    };
  } catch (e) {
    input.dispose();
    throw e;
  }
}

export function recordedSource(key: CryptoKey, id: string, sizes: number[]) {
  const ends: number[] = [];
  let total = 0;
  for (const size of sizes) {
    total += size;
    ends.push(total);
  }
  return new CustomSource({
    getSize: () => total,
    maxCacheSize: 2 * 1024 * 1024,
    read: (start, end) =>
      new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            const { getBlob } = await import("./vault");
            for (let i = 0; i < sizes.length; i++) {
              const from = i === 0 ? 0 : ends[i - 1];
              if (ends[i] <= start || from >= end) continue;
              const blob = await getBlob(key, `recording:${id}:${i}`);
              controller.enqueue(
                new Uint8Array(
                  await blob
                    .slice(
                      Math.max(0, start - from),
                      Math.min(sizes[i], end - from),
                    )
                    .arrayBuffer(),
                ),
              );
            }
            controller.close();
          } catch (e) {
            controller.error(e);
          }
        },
      }),
  });
}
