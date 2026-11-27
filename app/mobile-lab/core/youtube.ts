import { youtubeUrl, parseTranscript } from "../../src/shared/imports";
/** Browser direct route only. No hidden proxy, cookies, repeated 429 requests or automatic audio download. */
export function playerResponse(html: string): any {
  for (const marker of [
    "ytInitialPlayerResponse =",
    "ytInitialPlayerResponse=",
  ]) {
    const at = html.indexOf(marker);
    if (at < 0) continue;
    const start = html.indexOf("{", at + marker.length);
    let depth = 0,
      inString = false,
      escape = false;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (inString) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0)
        return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw Error(
    "YouTube 재생 정보에 접근할 수 없습니다. 자막 파일을 가져오거나 전사문을 붙여넣으세요.",
  );
}
export async function getCaptions(raw: string, signal: AbortSignal) {
  const url = youtubeUrl(raw);
  signal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  const request = async (u: string) => {
    let r: Response;
    try {
      r = await fetch(u, { credentials: "omit", mode: "cors", signal });
    } catch (e) {
      if (signal.aborted) throw e;
      throw Error(
        "YouTube 직접 자막 접근이 브라우저/CORS 또는 네트워크에서 차단되었습니다. 데스크톱 Yogurt에서 가져온 자막을 이곳에 넣을 수 있습니다.",
      );
    }
    if (r.status === 429)
      throw Error(
        "YouTube 요청 제한(429)입니다. 자동으로 반복 요청하지 않습니다. 나중에 다시 시도하거나 자막을 가져오세요.",
      );
    if (!r.ok) throw Error("YouTube 응답 오류: " + r.status);
    return r.text();
  };
  const player = playerResponse(await request(url));
  const tracks =
    player.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || !tracks.length)
    throw Error(
      "읽을 수 있는 자막이 없습니다. 음성 파일을 가져와 기기에서 전사하세요.",
    );
  const sorted = [...tracks].sort(
    (a, b) =>
      (b.languageCode === "ko" ? 4 : 0) +
      (b.kind === "asr" ? 0 : 1) -
      ((a.languageCode === "ko" ? 4 : 0) + (a.kind === "asr" ? 0 : 1)),
  );
  const track = sorted[0];
  const caption = new URL(track.baseUrl);
  if (
    caption.protocol !== "https:" ||
    !["www.youtube.com", "youtube.com"].includes(caption.hostname)
  )
    throw Error("예상하지 못한 자막 주소입니다.");
  caption.searchParams.set("fmt", "vtt");
  const parsed = parseTranscript(await request(caption.href), "vtt");
  return {
    url,
    title: player.videoDetails?.title || "YouTube 영상",
    language: track.languageCode,
    automatic: track.kind === "asr",
    turns: parsed.turns,
  };
}
