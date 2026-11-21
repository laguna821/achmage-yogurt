#!/usr/bin/env python3
"""achmage-transcript helper: deterministic aids for transcript clean-up.

The model does the judgment (who is who, what was meant). This script does the
parts a model does badly by eye: counting, fuzzy-matching mis-heard Korean
terms, applying a confirmed mapping everywhere at once, and checking the
output format.

Subcommands
  normalize  any transcript export  -> "[hh:mm:ss] Label: text" lines + stats
  speakers   evidence report per speaker label (who was called before whom)
  terms      mis-heard term candidates: glossary vs transcript, jamo similarity
  apply      apply confirmed speaker map and corrections to the whole transcript
  lint       check a finished note against the output format contract
  facts      list numbers in the note that no source file contains

Python 3.9+, standard library only.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

TURN_RE = re.compile(r"^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]{1,40}?):\s?(.*)$")
GENERIC_LABEL_RE = re.compile(r"^(Speaker|화자|참석자|발화자|SPEAKER|Unknown)[ _]?\d*$")
TITLES = ("교수님", "교수", "선생님", "선생", "쌤", "박사님", "박사", "학장님", "학장", "원장님", "실장님",
          "실장", "팀장님", "팀장", "대표님", "대표", "부장님", "부장", "조교", "기자", "작가", "감독", "위원님",
          "위원장님", "위원", "주임", "처장님", "처장", "총장님", "님", "씨")
TITLE_ALT = "|".join(sorted(TITLES, key=len, reverse=True))
VOCATIVE_RE = re.compile(r"([가-힣]{2,4})\s?(" + TITLE_ALT + r")(?![가-힣]{2,})")
# 조사/어미가 붙어 사람 이름으로 잡히는 흔한 오탐
NOT_NAMES = {"우리", "저희", "다른", "모든", "여러", "어떤", "그럼", "그런", "이런", "담당", "지도", "전공", "주임",
             "외부", "내부", "신임", "해당", "각자", "일부", "전체", "기존", "참석", "위원", "심사", "교육", "연구",
             "학교", "학과", "스쿨", "대학", "강의", "수업", "이번", "다음", "지난", "두분", "분들", "이날", "그날",
             "이분", "그분", "여기", "거기", "선배", "후배", "동문", "학생", "직원", "정말", "지금", "제가", "저는", "하나"}
# 한국 성씨의 첫 글자. 호칭 앞의 낱말이 사람 이름인지 거르는 데 쓴다.
SURNAMES = set("김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진지엄채원천방공현함변염여추도소석선설마길연위표명기반라왕금옥육인맹제모탁국어은편용예봉경사부복태목형피두감음빈동온")
PARTICLE_END = tuple("는를을에서로와과만도고며면들")


def looks_like_name(s: str) -> bool:
    return 2 <= len(s) <= 4 and s[0] in SURNAMES and not s.endswith(PARTICLE_END) and s not in NOT_NAMES


# --------------------------------------------------------------------------- #
# time helpers
# --------------------------------------------------------------------------- #
def fmt_time(seconds: float) -> str:
    s = int(max(0, seconds))
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def parse_time(text: str) -> float:
    text = text.strip().replace(",", ".")
    parts = text.split(":")
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return 0.0
    while len(nums) < 3:
        nums.insert(0, 0.0)
    return nums[0] * 3600 + nums[1] * 60 + nums[2]


# --------------------------------------------------------------------------- #
# normalize
# --------------------------------------------------------------------------- #
def _from_json(data) -> list[dict]:
    if isinstance(data, dict):
        for key in ("segments", "data", "results", "utterances", "transcript", "items"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
    if not isinstance(data, list):
        raise ValueError("JSON에서 발화 목록을 찾지 못했습니다.")
    turns = []
    for item in data:
        if not isinstance(item, dict):
            continue
        text = item.get("content") or item.get("text") or item.get("transcript") or item.get("msg") or ""
        speaker = (item.get("speaker") or item.get("original_speaker") or item.get("speaker_label")
                   or item.get("name") or "Speaker ?")
        if isinstance(speaker, int):
            speaker = f"Speaker {speaker}"
        start = item.get("start_time", item.get("start", item.get("startTime", item.get("begin", 0)))) or 0
        try:
            start = float(start)
        except (TypeError, ValueError):
            start = parse_time(str(start))
        # Plaud는 밀리초, whisper류는 초 단위
        if "start_time" in item or start > 36000:
            start = start / 1000.0
        if text.strip():
            turns.append({"t": start, "speaker": str(speaker).strip(), "text": " ".join(text.split())})
    return turns


SRT_TIME_RE = re.compile(r"(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})")
TIME_TOKEN = r"\(?\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\)?"
HEAD_A = re.compile(r"^" + TIME_TOKEN + r"\s+(.{1,40}?)\s*:?$")            # 00:04 화자 1
HEAD_B = re.compile(r"^(.{1,40}?)\s+" + TIME_TOKEN + r"\s*:?$")            # 화자 1 00:04
INLINE_A = re.compile(r"^" + TIME_TOKEN + r"\s+([^:]{1,40}?):\s+(.+)$")    # 00:04 화자 1: 내용
INLINE_B = re.compile(r"^([^:\d\[]{1,40}?)\s+" + TIME_TOKEN + r"\s*:\s+(.+)$")
INLINE_C = re.compile(r"^([^:]{1,30}?):\s+(.+)$")                           # 화자 1: 내용 (시각 없음)
VTT_VOICE = re.compile(r"^<v\s+([^>]+)>(.*)$")


def _from_text(raw: str) -> list[dict]:
    lines = [ln.rstrip() for ln in raw.replace("\ufeff", "").splitlines()]
    turns: list[dict] = []
    # 1) 이미 정규화된 형식
    if sum(1 for ln in lines if TURN_RE.match(ln)) >= max(3, len([l for l in lines if l.strip()]) // 2):
        for ln in lines:
            m = TURN_RE.match(ln)
            if m:
                turns.append({"t": parse_time(m.group(1)), "speaker": m.group(2).strip(), "text": m.group(3).strip()})
            elif ln.strip() and turns:
                turns[-1]["text"] += " " + ln.strip()
        return turns
    # 2) SRT / VTT
    if any(SRT_TIME_RE.search(ln) for ln in lines[:50]):
        cur = None
        for ln in lines:
            m = SRT_TIME_RE.search(ln)
            if m:
                if cur and cur["text"]:
                    turns.append(cur)
                cur = {"t": parse_time(m.group(1)), "speaker": "Speaker ?", "text": ""}
                continue
            if cur is None or not ln.strip() or ln.strip().isdigit() or ln.strip() == "WEBVTT":
                continue
            body = ln.strip()
            mv = VTT_VOICE.match(body)
            if mv:
                cur["speaker"], body = mv.group(1).strip(), re.sub(r"</v>", "", mv.group(2)).strip()
            else:
                mi = INLINE_C.match(body)
                if mi and len(mi.group(1)) <= 20 and not cur["text"]:
                    cur["speaker"], body = mi.group(1).strip(), mi.group(2).strip()
            cur["text"] = (cur["text"] + " " + body).strip()
        if cur and cur["text"]:
            turns.append(cur)
        return turns
    # 3) 머리줄(화자+시각) 다음에 내용이 오는 형식, 또는 한 줄 형식
    cur = None
    last_t = 0.0
    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        m = INLINE_A.match(s)
        if m:
            cur = {"t": parse_time(m.group(1)), "speaker": m.group(2).strip(), "text": m.group(3).strip()}
            turns.append(cur)
            last_t = cur["t"]
            continue
        m = INLINE_B.match(s)
        if m:
            cur = {"t": parse_time(m.group(2)), "speaker": m.group(1).strip(), "text": m.group(3).strip()}
            turns.append(cur)
            last_t = cur["t"]
            continue
        m = HEAD_A.match(s)
        if m and len(m.group(2)) <= 25:
            cur = {"t": parse_time(m.group(1)), "speaker": m.group(2).strip(), "text": ""}
            turns.append(cur)
            last_t = cur["t"]
            continue
        m = HEAD_B.match(s)
        if m and len(m.group(1)) <= 25:
            cur = {"t": parse_time(m.group(2)), "speaker": m.group(1).strip(), "text": ""}
            turns.append(cur)
            last_t = cur["t"]
            continue
        m = INLINE_C.match(s)
        if m and (GENERIC_LABEL_RE.match(m.group(1).strip()) or cur is None):
            cur = {"t": last_t, "speaker": m.group(1).strip(), "text": m.group(2).strip()}
            turns.append(cur)
            continue
        if cur is not None:
            cur["text"] = (cur["text"] + " " + s).strip()
    return [t for t in turns if t["text"]]


def load_turns(path: Path) -> list[dict]:
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    stripped = raw.lstrip()
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            return _from_json(json.loads(raw))
        except (json.JSONDecodeError, ValueError):
            pass
    return _from_text(raw)


def merge_turns(turns: list[dict], gap: float) -> list[dict]:
    out: list[dict] = []
    for t in turns:
        if out and out[-1]["speaker"] == t["speaker"] and t["t"] - out[-1].get("t_last", out[-1]["t"]) <= gap:
            out[-1]["text"] += " " + t["text"]
            out[-1]["t_last"] = t["t"]
        else:
            out.append(dict(t, t_last=t["t"]))
    return out


def write_turns(turns: list[dict], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(f"[{fmt_time(t['t'])}] {t['speaker']}: {t['text']}" for t in turns) + "\n", encoding="utf-8")


def stats_table(turns: list[dict]) -> str:
    agg: dict[str, dict] = {}
    total = sum(len(t["text"]) for t in turns) or 1
    for t in turns:
        a = agg.setdefault(t["speaker"], {"turns": 0, "chars": 0, "first": t["t"], "last": t["t"]})
        a["turns"] += 1
        a["chars"] += len(t["text"])
        a["last"] = t["t"]
    rows = ["| 라벨 | 발화 수 | 글자 수 | 비중 | 첫 발화 | 마지막 발화 |", "|---|---|---|---|---|---|"]
    for sp, a in sorted(agg.items(), key=lambda kv: -kv[1]["chars"]):
        rows.append(f"| {sp} | {a['turns']} | {a['chars']} | {a['chars'] * 100 // total}% | {fmt_time(a['first'])} | {fmt_time(a['last'])} |")
    return "\n".join(rows)


def cmd_normalize(args) -> int:
    turns = load_turns(Path(args.input))
    if not turns:
        print("발화를 읽지 못했습니다. 지원 형식: Plaud trans_result.json, '[시각] 화자: 내용', '화자 시각' 머리줄 형식, SRT/VTT.", file=sys.stderr)
        return 1
    if args.merge is not None:
        turns = merge_turns(turns, args.merge)
    write_turns(turns, Path(args.out))
    dur = turns[-1]["t"]
    print(f"발화 {len(turns)}개, 길이 약 {fmt_time(dur)}, 본문 {sum(len(t['text']) for t in turns)}자 -> {args.out}\n")
    print(stats_table(turns))
    if all(t["t"] == 0 for t in turns):
        print("\n주의: 시각 정보가 없습니다. 화자 확정과 원문 대조가 어려워집니다.")
    return 0


# --------------------------------------------------------------------------- #
# Hangul jamo similarity
# --------------------------------------------------------------------------- #
CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
JONG = [""] + list("ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ")


def jamo(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch) - 0xAC00
        if 0 <= code < 11172:
            out.append(CHO[code // 588])
            out.append(JUNG[code % 588 // 28])
            out.append(JONG[code % 28])
        else:
            out.append(ch.lower())
    return "".join(out)


def cho(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch) - 0xAC00
        out.append(CHO[code // 588] if 0 <= code < 11172 else ch.lower())
    return "".join(out)


def similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, jamo(a), jamo(b), autojunk=False).ratio()


# --------------------------------------------------------------------------- #
# speakers
# --------------------------------------------------------------------------- #
def read_list(path: str | None) -> list[str]:
    if not path:
        return []
    items = []
    for ln in Path(path).read_text(encoding="utf-8-sig").splitlines():
        ln = re.sub(r"^[\s\-*\d.)]+", "", ln).strip()
        ln = re.split(r"\s*[#|(（]", ln)[0].strip()
        if ln:
            items.append(ln)
    return items


def nearest_roster(name: str, roster: list[str]) -> tuple[str, float] | None:
    best = None
    for r in roster:
        if abs(len(r) - len(name)) > 1:
            continue
        sc = similarity(name, r)
        if r[0] != name[0]:
            sc -= 0.15
        if best is None or sc > best[1]:
            best = (r, sc)
    return best if best and best[1] >= 0.6 else None


def cmd_speakers(args) -> int:
    turns = load_turns(Path(args.turns))
    roster = read_list(args.roster)
    if not roster and getattr(args, "glossary", None) and Path(args.glossary).exists():
        roster = [g["term"] for g in read_glossary(args.glossary) if g["kind"] == "person"]
    lines = ["## 화자 라벨 통계", "", stats_table(turns), ""]
    dur = turns[-1]["t"] if turns else 0
    first_seen: dict[str, float] = {}
    for t in turns:
        first_seen.setdefault(t["speaker"], t["t"])
    late = [f"{sp}({fmt_time(ts)})" for sp, ts in first_seen.items() if dur and ts > dur * 0.25]
    if late:
        lines += ["- 첫 발화가 늦은 라벨: " + ", ".join(late) + ". 늦게 온 사람이거나, 앞부분에서는 다른 라벨에 섞였을 수 있다. 그 전에 누가 자리에 없다고 언급됐는지 본다.", ""]
    if turns and turns[0]["t"] < 20 and not re.search(r"시작|안녕|반갑", " ".join(t["text"] for t in turns[:6])):
        lines += ["- 녹음이 인사나 개회 없이 시작한다. 세션 도중부터 녹음됐을 수 있다. 앞부분은 자료로 보완하고, 녹음에 없는 논의를 지어내지 않는다.", ""]
    by_sp: dict[str, list[dict]] = defaultdict(list)
    for t in turns:
        by_sp[t["speaker"]].append(t)

    # 호명 단서: 이름+호칭이 나온 발화, 그 직후 다른 라벨의 발화
    calls = []
    for i, t in enumerate(turns):
        for m in VOCATIVE_RE.finditer(t["text"]):
            name = m.group(1)
            if not looks_like_name(name) and not (roster and nearest_roster(name, roster)):
                continue
            nxt = next((u for u in turns[i + 1:i + 4] if u["speaker"] != t["speaker"]), None)
            at_end = len(t["text"]) - m.end() <= 12
            calls.append({"t": t["t"], "by": t["speaker"], "name": name, "title": m.group(2),
                          "next": nxt["speaker"] if nxt else "", "at_end": at_end,
                          "ctx": t["text"][max(0, m.start() - 25):m.end() + 25]})
    lines += ["## 호명 단서", "",
              "이름과 호칭이 함께 나온 곳이다. '발화 끝 호명'이 예이면 바로 다음 화자가 그 사람일 가능성이 크고, 아니면 제3자를 언급한 것일 수 있다. 명단이 있으면 가장 가까운 이름을 함께 적는다.",
              "'명단 근접'의 괄호 안 숫자가 0.7보다 작으면 명단에 없는 다른 사람(졸업생, 외부인)일 가능성이 크다. 문맥에서 같은 사람인지 확인한다.", "",
              "| 시각 | 부른 라벨 | 들린 이름 | 명단 근접 | 발화 끝 호명 | 직후 라벨 | 문맥 |", "|---|---|---|---|---|---|---|"]
    for c in calls:
        near = nearest_roster(c["name"], roster) if roster else None
        near_txt = "" if not near else (near[0] if near[0] == c["name"] else f"{near[0]} ({near[1]:.2f})")
        lines.append(f"| {fmt_time(c['t'])} | {c['by']} | {c['name']} {c['title']} | {near_txt} | {'예' if c['at_end'] else ''} | {c['next']} | {c['ctx'].replace('|', '/')} |")
    if not calls:
        lines.append("| - | - | 호명 없음 | | | | |")

    # 라벨별: 누구로 불린 직후 말했는가, 자기 언급, 긴 발화
    lines += ["", "## 라벨별 단서", ""]
    self_re = re.compile(r"(제가|저는|저도|제 |저희|내가|나는)")
    for sp, ts in sorted(by_sp.items(), key=lambda kv: -sum(len(x["text"]) for x in kv[1])):
        called = Counter()
        for c in calls:
            if c["next"] == sp and c["at_end"]:
                near = nearest_roster(c["name"], roster) if roster else None
                called[(near[0] if near else c["name"])] += 1
        self_named = Counter()
        for c in calls:
            if c["by"] == sp:
                near = nearest_roster(c["name"], roster) if roster else None
                self_named[(near[0] if near else c["name"])] += 1
        lines.append(f"### {sp}")
        lines.append("")
        lines.append(f"- 직전 발화 끝에서 불린 이름: {', '.join(f'{n} {k}회' for n, k in called.most_common()) or '없음'}")
        lines.append(f"- 이 라벨이 입에 올린 이름(본인이 아닐 가능성이 큼): {', '.join(f'{n} {k}회' for n, k in self_named.most_common(12)) or '없음'}")
        selfs = sorted((t for t in ts if self_re.search(t["text"])), key=lambda t: -len(t["text"]))[:args.samples]
        lines.append("- 자기 언급이 들어간 긴 발화:")
        for t in sorted(selfs, key=lambda t: t["t"]):
            lines.append(f"\t- [{fmt_time(t['t'])}] {t['text'][:args.width]}{'…' if len(t['text']) > args.width else ''}")
        if not selfs:
            lines.append("\t- 없음")
        lines.append("")
    if roster:
        lines += ["## 명단", "", "- " + ", ".join(roster), ""]
    out = "\n".join(lines)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(out + "\n", encoding="utf-8")
        print(f"화자 단서 보고서 -> {args.out} (호명 {len(calls)}건, 라벨 {len(by_sp)}개)")
    else:
        print(out)
    return 0


# --------------------------------------------------------------------------- #
# terms
# --------------------------------------------------------------------------- #
def read_glossary(path: str) -> list[dict]:
    """용어집: '# 사람' 아래는 사람 이름, '# 용어' 아래는 그 밖의 고유명사. 줄 끝의 '# 출처'는 출처 표시."""
    out, kind, seen = [], "term", set()
    for ln in Path(path).read_text(encoding="utf-8-sig").splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith("#"):
            head = s.lstrip("#").strip()
            kind = "person" if re.search(r"사람|인물|이름|명단|people|person", head, flags=re.I) else "term"
            continue
        s = re.sub(r"^[\-*\d.)\s]+", "", s)
        term, _, source = s.partition("#")
        term = term.strip()
        key = re.sub(r"\s+", "", term)
        if len(key) >= 2 and re.search(r"[가-힣]", key) and key not in seen:
            seen.add(key)
            out.append({"term": term, "key": key, "kind": kind, "source": source.strip()})
    return out


def cmd_terms(args) -> int:
    turns = load_turns(Path(args.turns))
    entries = read_glossary(args.glossary)
    meta = {g["term"]: g for g in entries}
    glossary = [(g["term"], g["key"]) for g in entries]
    exact = set(k for _, k in glossary)
    found: dict[tuple[str, str], dict] = {}
    title_after = re.compile(r"^\s?(" + TITLE_ALT + r")")
    for t in turns:
        cands = []  # 이 발화에서 나온 후보: (점수, 시작, 끝, 원문 조각, 용어, 호칭 동반)
        # 공백을 지운 문자열에서 창을 밀며 비교하되, 원문 위치를 기억한다
        chars = [(i, ch) for i, ch in enumerate(t["text"]) if not ch.isspace()]
        flat = "".join(ch for _, ch in chars)
        flat_cho = cho(flat)
        for term, key in glossary:
            L = len(key)
            if key in flat:
                continue  # 이 발화에는 올바른 표기가 이미 있다
            key_cho = cho(key)
            for width in (L, L - 1, L + 1):
                if width < 2 or width > len(flat):
                    continue
                for s in range(0, len(flat) - width + 1):
                    win = flat[s:s + width]
                    if win in exact or not re.search(r"[가-힣]", win):
                        continue
                    wc = flat_cho[s:s + width]
                    if width == L:
                        if sum(1 for a, b in zip(wc, key_cho) if a != b) > max(1, L // 4):
                            continue
                    elif wc[0] != key_cho[0]:
                        continue
                    sc = similarity(win, key)
                    orig_end = chars[s + width - 1][0] + 1
                    has_title = bool(title_after.match(t["text"][orig_end:orig_end + 6]))
                    if meta[term]["kind"] == "person":
                        # 사람 이름: 호칭이 뒤따르면 느슨하게, 아니면 엄격하게
                        if width != L or sc < (args.min_name if has_title else 0.85):
                            continue
                        heard = t["text"][chars[s][0]:orig_end]
                        if " " in heard or not looks_like_name(win):
                            continue  # 이름은 띄어 쓰지 않고 성씨로 시작한다
                    else:
                        if sc < args.min:
                            continue
                        if width != L and (width < 3 or sc < 0.85):
                            continue  # 길이가 다른 창은 아주 비슷할 때만
                    if L <= 2 and not has_title:
                        continue  # 두 글자 용어는 호칭이 뒤따를 때만
                    cands.append((sc + (0.001 if width == L else 0), chars[s][0], orig_end, term, has_title))
        # 같은 자리에 걸친 후보는 가장 비슷한 하나만 남긴다
        taken: list[tuple[int, int]] = []
        for sc, a, b, term, has_title in sorted(cands, key=lambda c: -c[0]):
            if any(a < tb and ta < b for ta, tb in taken):
                continue
            taken.append((a, b))
            orig = t["text"][a:b]
            rec = found.setdefault((orig, term), {"score": sc, "count": 0, "first": t["t"], "title": has_title,
                                                  "ctx": t["text"][max(0, a - 18):b + 18]})
            rec["count"] += 1
            rec["score"] = max(rec["score"], sc)
            rec["title"] = rec["title"] or has_title
    # 같은 원문 조각이 여러 용어에 걸리면 가장 비슷한 것만 남긴다
    best: dict[str, tuple[str, dict]] = {}
    for (orig, term), rec in found.items():
        if orig not in best or rec["score"] > best[orig][1]["score"]:
            best[orig] = (term, rec)
    # 더 긴 후보에 포함되는 짧은 조각은 뺀다
    keep = []
    items = sorted(best.items(), key=lambda kv: -kv[1][1]["score"])
    for orig, (term, rec) in items:
        if any(orig != o2 and orig in o2 and t2 == term and r2["score"] >= rec["score"] for o2, (t2, r2) in items):
            continue
        keep.append((orig, term, rec))
    lines = ["## 오인식 후보 (자료의 표기와 비슷하게 들린 곳)", "",
             "후보일 뿐이다. 문맥을 읽고 같은 대상을 가리킬 때만 보정한다. 유사도가 높아도 다른 사람이나 다른 말일 수 있다.", "",
             "| 전사 표기 | 용어집 표기 | 구분 | 출처 | 유사도 | 횟수 | 호칭 동반 | 첫 시각 | 문맥 |", "|---|---|---|---|---|---|---|---|---|"]
    for orig, term, rec in keep:
        g = meta[term]
        lines.append(f"| {orig} | {term} | {'사람' if g['kind'] == 'person' else '용어'} | {g['source'] or '-'} | {rec['score']:.2f} | {rec['count']} | {'예' if rec['title'] else ''} | {fmt_time(rec['first'])} | {rec['ctx'].replace('|', '/')} |")
    if not keep:
        lines.append("| - | - | - | - | - | - | - | - | 후보 없음 |")
    whole = "".join("".join(t["text"].split()) for t in turns)
    absent = [g for g, k in glossary if k not in whole]
    lines += ["", "## 전사에 한 번도 그대로 나오지 않은 자료 용어", "",
              "회의에서 언급되지 않았거나, 위 표처럼 다르게 받아 적혔을 수 있다.", "", "- " + (", ".join(absent) if absent else "없음"), ""]
    out = "\n".join(lines)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(out + "\n", encoding="utf-8")
        print(f"오인식 후보 {len(keep)}건, 미등장 용어 {len(absent)}개 -> {args.out}")
    else:
        print(out)
    return 0


# --------------------------------------------------------------------------- #
# apply
# --------------------------------------------------------------------------- #
def cmd_apply(args) -> int:
    turns = load_turns(Path(args.turns))
    smap, overrides = {}, []
    if args.speakers:
        data = json.loads(Path(args.speakers).read_text(encoding="utf-8-sig"))
        overrides = data.pop("overrides", []) if isinstance(data, dict) else []
        smap = {k: v for k, v in data.items() if isinstance(v, str) and v.strip()}
    corr = []
    if args.corrections:
        data = json.loads(Path(args.corrections).read_text(encoding="utf-8-sig"))
        corr = [(c["from"], c["to"]) for c in data if c.get("from") and c.get("to") is not None and c.get("apply", True)]
        corr.sort(key=lambda c: -len(c[0]))
    ov = {}
    for o in overrides:
        ov[fmt_time(parse_time(o["time"]))] = o["speaker"]
    counts = Counter()
    ov_used = Counter()
    for t in turns:
        key = fmt_time(t["t"])
        if key in ov:
            t["speaker"] = ov[key]
            ov_used[key] += 1
        elif t["speaker"] in smap:
            t["speaker"] = smap[t["speaker"]]
        for a, b in corr:
            # 띄어쓰기가 달라도 찾는다: '대규마이너스'로 적어도 '대규 마이너스'가 바뀐다
            pat = r"\s*".join(re.escape(ch) for ch in a if not ch.isspace())
            t["text"], n = re.subn(pat, b.replace("\\", "\\\\"), t["text"])
            if n:
                counts[(a, b)] += n
    write_turns(turns, Path(args.out))
    left = Counter(t["speaker"] for t in turns if GENERIC_LABEL_RE.match(t["speaker"]))
    print(f"적용 완료 -> {args.out}")
    print("화자 대응:", ", ".join(f"{k}={v}" for k, v in smap.items()) or "없음")
    if ov:
        print("발화 단위 재지정:", ", ".join(f"{k}→{v}{'' if ov_used[k] else ' (해당 시각 없음)'}" for k, v in ov.items()))
    if left:
        print("아직 이름이 없는 라벨:", ", ".join(f"{k} {v}회" for k, v in left.items()))
    print("보정 치환:")
    for (a, b), n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {a} -> {b}: {n}곳")
    unused = [a for a, b in corr if (a, b) not in counts]
    if unused:
        print("치환 대상이 없던 항목:", ", ".join(unused))
        print("  -> from이 전사의 글자와 다르다. turns.txt에서 그 대목을 찾아 글자 그대로(조사는 빼고) 다시 적는다.")
    same = [a for a, b in corr if a == b]
    if same:
        print("from과 to가 같은 항목(지운다):", ", ".join(same))
    return 0


# --------------------------------------------------------------------------- #
# lint
# --------------------------------------------------------------------------- #
# note: 노트 앱(Obsidian 등)의 Mermaid가 그대로 그리는 유형. pele: Pele가 그림으로 바꿔 넣는 문서(HWPX 등)에서 추가로 쓰는 유형.
MERMAID_NOTE = ("flowchart", "graph", "sequenceDiagram", "stateDiagram-v2", "classDiagram", "erDiagram", "gantt", "pie",
                "mindmap", "timeline", "quadrantChart", "journey", "xychart-beta", "block-beta")
MERMAID_PELE = MERMAID_NOTE + ("kanban", "swimlane-beta", "ishikawa-beta", "venn-beta", "radar-beta", "treeView-beta", "treemap-beta",
                               "architecture-beta", "C4Context", "C4Container", "C4Component", "C4Dynamic", "C4Deployment",
                               "requirementDiagram", "gitGraph", "packet-beta", "cynefin-beta", "wardley-beta",
                               "agentflow-beta", "usecase-beta", "eventmodeling", "sankey-beta")
MARKERS = ("전사 불확실", "확인 필요", "녹음 불명확")
# 배포용 회의록에서 다시 읽어 볼 표현 (오류가 아니라 주의)
SENSITIVE_RE = re.compile(r"알지 못했|몰랐|잊어버|따졌|항의|불만|받아들여지지 않|거절|문제 삼|교통사고|건강 문제|개인 사정|말하지 않아도|비공개|놀고 있|핵계|탓")
# '참석자 11명' 같은 본문 표현은 라벨이 아니다
LEFTOVER_LABEL_RE = re.compile(r"\b(?:Speaker|SPEAKER)[ _]?\d+|(?:화자|발화자|참석자) ?\d+(?!\s?(?:명|인|분|개|석|년|월|일|\d))")


def cmd_lint(args) -> int:
    text = Path(args.note).read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    errors, warns = [], []
    kinds_used: Counter = Counter()
    blocks = list(re.finditer(r"^```([^\n]*)\n(.*?)^```\s*$", text, flags=re.S | re.M))
    body = text
    for m in blocks:
        lang = m.group(1).strip()
        if lang != "mermaid":
            errors.append(f"mermaid가 아닌 코드 블록: ```{lang or '(언어 없음)'}")
        else:
            src = m.group(2)
            first = next((ln.strip() for ln in src.splitlines() if ln.strip() and not ln.strip().startswith("%%")), "")
            kind = first.split()[0] if first else ""
            allowed = MERMAID_PELE if args.target == "pele" else MERMAID_NOTE
            if kind not in allowed and not kind.startswith("railroad"):
                hint = " (Pele로 그림을 넣는 문서라면 --target pele)" if kind in MERMAID_PELE else ""
                errors.append(f"이 대상에서 쓸 수 없는 도식 유형: {kind or '(비어 있음)'}{hint}")
            kinds_used[kind] += 1
            if kind == "sankey-beta" and re.search(r"[가-힣]", src.split("\n", 1)[-1].split("%%")[0]):
                errors.append("sankey에 한글 라벨: Pele 1.6.0에서 실패한다. 표나 값이 적힌 흐름도로 바꾼다")
            if kind == "mindmap" and re.search(r"^\s+[^%\s\[\]\"(]*[()]", re.sub(r"root\(\(.*?\)\)", "", src), flags=re.M):
                errors.append("mindmap 라벨에 괄호: 파싱이 깨진다. 괄호를 빼거나 풀어 쓴다")
            if kind in ("flowchart", "graph"):
                direction = (first.split() + [""])[1]
                n_nodes = len(set(re.findall(r"\b([A-Za-z][A-Za-z0-9_]*)\s*[\[({]", src)))
                if direction in ("TD", "TB", "") and "direction LR" not in src and n_nodes >= 5:
                    warns.append(f"위에서 아래로 흐르는 흐름도({n_nodes}개 노드): 세로형일 수 있다. 렌더 검수의 판정을 따르고, 세로형이면 LR이나 줄 나눔으로 다시 짠다")
                if direction == "LR" and "subgraph" not in src:
                    chain = max((ln.count("-->") + ln.count("-.->") for ln in src.splitlines()), default=0)
                    if chain >= 5:
                        warns.append("한 줄에 6단계 이상 이어진 가로 흐름도: 폭을 넘는다. 4단계씩 줄을 나눈다")
            if "@caption:" not in src:
                errors.append(f"도식에 %% @caption 이 없음 ({kind})")
            if "@alt:" not in src:
                errors.append(f"도식에 %% @alt 가 없음 ({kind})")
            if re.search(r"^\s*(style|classDef|linkStyle)\b", src, flags=re.M):
                errors.append(f"도식에 색·스타일 지정이 있음 ({kind})")
            if re.search(r"<(?!br\s*/?>)[a-zA-Z/]", src):
                errors.append(f"도식 라벨에 줄바꿈(<br/>) 외의 HTML 태그가 있음 ({kind})")
            if kind in ("flowchart", "graph") and re.search(r"\b[A-Za-z0-9_]+[\[({]+[가-힣]", src):
                warns.append("흐름도 라벨에 큰따옴표가 없는 곳이 있음")
            nodes = len(set(re.findall(r"\b([A-Za-z][A-Za-z0-9_]*)\s*[\[({]", src)))
            if nodes > 14:
                warns.append(f"도식 노드가 {nodes}개: 둘로 나눌지 검토")
            if kind in ("flowchart", "graph"):
                cap = (re.search(r"@caption:\s*(.+)", src) or [None, ""])[1].strip()
                rich = ("{" in src) or ("-.->" in src) or ("|" in src) or src.count("subgraph") >= 2 or "@key" in src and nodes >= 6
                if not rich and nodes <= 6:
                    warns.append(f"한 줄 사슬 도식({cap}): 상자를 순서대로 이은 것뿐이라 문장 한 줄과 같다. 갈림, 조건, 묶음, 선 라벨을 더하거나 시간 순서면 timeline으로 바꾼다")
        body = body.replace(m.group(0), "\n")
    if text.count("```") % 2:
        errors.append("닫히지 않은 코드 블록이 있음")
    lines = body.split("\n")
    nonempty = [ln for ln in lines if ln.strip()]
    if not nonempty or not nonempty[0].startswith("## "):
        errors.append(f"첫 줄이 '## ' 제목이 아님: {nonempty[0][:40] if nonempty else '(빈 문서)'}")
    heads = [ln.strip() for ln in lines if re.match(r"^## ", ln)]
    if args.profile == "record":
        if heads and heads[0] != "## 개요":
            errors.append(f"정리본의 첫 섹션이 '## 개요'가 아님: {heads[0]}")
    else:
        for need in ("회의 개요", "주요 결과", "결정 사항", "후속 조치"):
            if not any(need in h for h in heads):
                errors.append(f"회의록에 '## {need}' 섹션이 없음")
        if not any("향후 일정" in h for h in heads):
            warns.append("회의록에 '## 향후 일정' 섹션이 없음 (일정이 하나도 언급되지 않았을 때만 생략)")
        if heads and "회의 개요" not in heads[0]:
            errors.append(f"회의록의 첫 섹션이 '## 회의 개요'가 아님: {heads[0]}")
        for mk in MARKERS:
            n_mk = len(re.findall(r"\([^()\n]*" + mk + r"[^()\n]*\)", text))
            if n_mk:
                errors.append(f"회의록에 '({mk})' 표시가 {n_mk}곳 남음: 확인해 고치거나, 그 값을 빼고 질문 묶음에 올린다")
        for no, ln in enumerate(lines, 1):
            ms = SENSITIVE_RE.search(ln)
            if ms:
                warns.append(f"{no}행 민감 표현 후보 '{ms.group(0)}': 당사자를 깎아내리거나 다른 부서를 탓하는 말로 읽히면 사실만 남기고 고친다 ({ln.strip()[:46]})")
        bl = [ln.strip() for ln in lines if re.match(r"^\s*- ", ln)]
        spoken = [b for b in bl if re.search(r"(다|요|니다)\.$", b)]
        if bl and len(spoken) / len(bl) > 0.1:
            warns.append(f"개조식 종결이 아닌 불릿이 {len(spoken)}줄: '~함', '~임', '~예정'으로 통일한다 (예: {spoken[0][:30]})")
    section, kinds = None, defaultdict(Counter)
    for no, ln in enumerate(lines, 1):
        s = ln.strip()
        if not s:
            continue
        if re.match(r"^# ", ln):
            errors.append(f"{no}행: '#' 제목 사용")
        elif re.match(r"^#{5,} ", ln):
            errors.append(f"{no}행: '####'보다 깊은 제목")
        elif re.match(r"^#{2,4} ", ln):
            section = s
            continue
        if re.match(r"^\s*\d+[.)]\s", ln):
            errors.append(f"{no}행: 번호 목록 ({s[:30]})")
        if re.match(r"^\s*[*+]\s", ln):
            errors.append(f"{no}행: '-'가 아닌 불릿 ({s[:30]})")
        if s.startswith(">"):
            errors.append(f"{no}행: 인용 또는 콜아웃 ({s[:30]})")
        if re.match(r"^(-{3,}|\*{3,}|_{3,})$", s):
            errors.append(f"{no}행: 구분선")
        if re.search(r"</?[a-zA-Z][^>]*>", s):
            errors.append(f"{no}행: HTML 태그 ({s[:30]})")
        if re.search(r"!\[[^\]]*\]\(", s) or "![[" in s:
            errors.append(f"{no}행: 이미지")
        if re.match(r"^\s*- \[[ xX]\]", ln):
            errors.append(f"{no}행: 체크박스")
        ml = LEFTOVER_LABEL_RE.search(s)
        if ml:
            errors.append(f"{no}행: 화자 라벨이 이름으로 바뀌지 않음 ({ml.group(0)})")
        mb = re.match(r"^(\s*)- ", ln)
        if mb:
            indent = mb.group(1)
            if " " in indent:
                errors.append(f"{no}행: 불릿을 공백으로 들여씀 (탭으로 들여써야 변환기가 단계를 읽는다)")
            depth = indent.count("\t") + len(indent.replace("\t", "")) // 2
            if depth > args.max_depth - 1:
                errors.append(f"{no}행: 불릿 깊이 {depth + 1}단 (최대 {args.max_depth}단)")
            kinds[section]["bullet"] += 1
        elif s.startswith("|"):
            kinds[section]["table"] += 1
        else:
            kinds[section]["para"] += 1
    # 표 열 수 일관성
    table: list[str] = []
    for ln in lines + [""]:
        if ln.strip().startswith("|"):
            table.append(ln.strip())
        elif table:
            cols = {len(re.split(r"(?<!\\)\|", r.strip("|"))) for r in table}
            if len(cols) > 1:
                errors.append(f"표의 열 수가 행마다 다름: {table[0][:40]}")
            if len(table) < 2 or not re.match(r"^\|[\s:\-|]+\|$", table[1]):
                errors.append(f"표 머리 구분줄이 없음: {table[0][:40]}")
            table = []
    if args.profile == "record":
        for sec, c in kinds.items():
            if sec and c["bullet"] >= 4 and c["para"] == 0 and "결정" not in sec and "일정" not in sec and "과제" not in sec:
                warns.append(f"문단 없이 불릿만 있는 섹션: {sec}")
    marker_counts = {mk: len(re.findall(r"\([^()\n]*" + mk + r"[^()\n]*\)", text)) for mk in MARKERS}
    n_diag = sum(1 for m in blocks if m.group(1).strip() == "mermaid")
    print(f"제목 {sum(1 for ln in lines if re.match(r'^#{2,4} ', ln))}개, 문단 {sum(c['para'] for c in kinds.values())}줄, "
          f"불릿 {sum(c['bullet'] for c in kinds.values())}줄, 표 행 {sum(c['table'] for c in kinds.values())}줄, 도식 {n_diag}개, 본문 {len(text)}자")
    print("남은 표시:", ", ".join(f"{k} {v}곳" for k, v in marker_counts.items()))
    if kinds_used:
        print("도식 유형:", ", ".join(f"{k} {v}" for k, v in kinds_used.most_common()))
        if n_diag >= 4 and kinds_used.most_common(1)[0][1] / n_diag > 0.6:
            warns.append("도식의 대부분이 한 유형: 내용의 모양(순서, 역할, 시간, 분류, 수량)에 맞는 다른 유형을 검토")
    for w in warns:
        print("주의:", w)
    for e in errors:
        print("오류:", e)
    print("결과:", "통과" if not errors else f"오류 {len(errors)}건")
    return 1 if errors else 0


# --------------------------------------------------------------------------- #
# facts
# --------------------------------------------------------------------------- #
NUM_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")
KNUM = {"한": 1, "두": 2, "세": 3, "네": 4, "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8, "아홉": 9, "열": 10}


YEAR_RE = re.compile(r"(?<!\d)(19|20)\d{2}(?=\s?[.년/\-])")
TIME_RE = re.compile(r"(?<!\d)(\d{1,2}):(\d{2})(?!\d)")
DATE_RES = (re.compile(r"(?<![\d.])(\d{1,2})\.\s?(\d{1,2})\.(?!\d)"),      # 11. 24.
            re.compile(r"(?<![\d.])(\d{1,2})\.\s?(\d{1,2})(?=\s?[(~])"),   # 1. 12(화) / 12. 21~22
            re.compile(r"(?<!\d)(\d{1,2})/(\d{1,2})(?!\d)"),               # 11/24
            re.compile(r"(?<!\d)(\d{1,2})\s?월\s?(\d{1,2})\s?일"))          # 11월 24일


def _facts_of(text: str) -> dict:
    """글에서 연도, 시각, 날짜(월일 쌍), 그 밖의 숫자를 따로 뽑는다. 각 항목은 (값, 시작, 끝)."""
    out = {"year": [], "time": [], "date": [], "num": []}
    mask = list(text)

    def take(kind, m, val):
        if any(mask[i] == "\0" for i in range(m.start(), m.end())):
            return
        out[kind].append((val, m.start(), m.end()))
        for i in range(m.start(), m.end()):
            mask[i] = "\0"

    for m in YEAR_RE.finditer(text):
        take("year", m, m.group(0))
    for m in TIME_RE.finditer(text):
        take("time", m, f"{int(m.group(1))}:{m.group(2)}")
    for rx in DATE_RES:
        for m in rx.finditer(text):
            mo, d = int(m.group(1)), int(m.group(2))
            if 1 <= mo <= 12 and 1 <= d <= 31:
                take("date", m, (mo, d))
    rest = "".join(mask)
    for m in NUM_RE.finditer(rest):
        out["num"].append((m.group(0).replace(",", "").rstrip("."), m.start(), m.end()))
    return out


def cmd_facts(args) -> int:
    note = Path(args.note).read_text(encoding="utf-8-sig")
    note = re.sub(r"^```mermaid\n.*?^```\s*$", "", note, flags=re.S | re.M)
    src_text = ""
    for p in args.sources:
        src_text += "\n" + Path(p).read_text(encoding="utf-8-sig", errors="replace")
    src_text = re.sub(r"(\d)\s+(?=(만|억|천|명|개|월|일|시|분|대|세트|학점|%))", r"\1", src_text)  # '4,700 만' -> '4,700만'
    src = _facts_of(src_text)
    have = {k: set(v for v, _, _ in src[k]) for k in src}
    label = {"year": "연도", "time": "시각", "date": "날짜", "num": "숫자"}
    missing, total = [], Counter()
    for no, ln in enumerate(note.splitlines(), 1):
        f = _facts_of(ln)
        for kind in ("year", "time", "date", "num"):
            for val, a, b in f[kind]:
                if kind == "num" and len(val) < 2 and not re.match(r"\s?(명|개|건|대|회|차|시|학점|과목|세트|곳|박|층|%|만|억|천|팀|주|번)", ln[b:b + 3]):
                    continue
                total[kind] += 1
                if val in have[kind]:
                    continue
                shown = f"{val[0]}. {val[1]}." if kind == "date" else val
                missing.append((no, label[kind], shown, ln.strip()[max(0, a - 18):b + 18]))
    print("점검한 값: " + ", ".join(f"{label[k]} {total[k]}개" for k in ("date", "time", "year", "num")) + f" / 출처에서 찾지 못한 것 {len(missing)}개")
    print("날짜는 월과 일이 쌍으로, 시각과 숫자는 통째로 출처에 있어야 찾은 것으로 본다.")
    print("못 찾았다고 틀린 것은 아니다. 말로 한 수(한글로 받아 적힌 수), '어제'나 '내일'에서 계산한 날짜, 합계는 출처에 그 모양으로 없다.")
    print("아래 항목은 하나씩 근거를 확인해 확인 대장에 적고, 근거가 없으면 지운다. 찾은 것으로 나온 값도 맥락이 맞는지는 이 점검이 보장하지 않는다.\n")
    for no, kind, tok, ctx in missing:
        print(f"  {no}행  [{kind}] {tok}  …{ctx}…")
    return 0


# --------------------------------------------------------------------------- #
# prepare / check: 여러 단계를 한 번에
# --------------------------------------------------------------------------- #
def _run_self(*argv: str) -> tuple[int, str]:
    import subprocess
    r = subprocess.run([sys.executable, str(Path(__file__).resolve()), *argv], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout + r.stderr).strip()


def cmd_prepare(args) -> int:
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    turns = work / "turns.txt"
    code, out = _run_self("normalize", args.input, "--out", str(turns))
    print(out + "\n")
    if code:
        return code
    glossary = Path(args.glossary) if args.glossary else work / "glossary.txt"
    sp = ["speakers", str(turns), "--out", str(work / "speakers.md")]
    if args.roster:
        sp += ["--roster", args.roster]
    elif glossary.exists():
        sp += ["--glossary", str(glossary)]
    print(_run_self(*sp)[1])
    if glossary.exists():
        print(_run_self("terms", str(turns), "--glossary", str(glossary), "--out", str(work / "terms.md"))[1])
    else:
        print(f"용어집이 없어 오인식 후보는 건너뛰었다. {glossary} 를 만든 뒤 prepare를 다시 돌리면 terms.md가 생긴다.")
    print(f"\n다음: {work / 'speakers.md'} 와 {work / 'terms.md'} 를 읽고 speaker-map.json, corrections.json, ledger.md 를 쓴다.")
    return 0


def cmd_check(args) -> int:
    import shutil
    import subprocess
    note = args.note
    work = Path(args.work) if args.work else Path(note).resolve().parent / "_work"
    lint_args = ["lint", note, "--profile", args.profile, "--target", args.target]
    lcode, lout = _run_self(*lint_args)
    print("=== 형식 검사 ===\n" + lout + "\n")
    fsum = "출처를 주지 않아 건너뜀"
    if args.sources:
        _, fout = _run_self("facts", note, "--sources", *args.sources)
        print("=== 숫자 점검 ===\n" + fout + "\n")
        m = re.search(r"찾지 못한 것 (\d+)개", fout)
        fsum = f"출처에서 못 찾은 값 {m.group(1) if m else '?'}개 (하나씩 근거 확인)"
    rsum, rcode = "Node가 없어 렌더하지 못함", 2
    node = shutil.which("node")
    if node:
        stem = re.sub(r"\W+", "_", Path(note).stem)[-40:]
        out_dir = work / "diagrams" / stem
        cmd = [node, str(Path(__file__).resolve().parent / "render_diagrams.mjs"), note, "--out", str(out_dir), "--width", str(args.width)]
        if args.pele:
            cmd += ["--pele", args.pele]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        rcode = r.returncode
        print("=== 도식 렌더 검수 ===\n" + (r.stdout + r.stderr).strip() + "\n")
        rsum = {0: f"모두 통과 (그림: {out_dir})", 1: f"다시 볼 도식 있음 (그림: {out_dir})", 2: "Pele를 찾지 못해 렌더하지 못함. 문법 검사만 한 상태"}.get(rcode, "렌더 실패")
    print("=== 요약 ===")
    print("형식 검사:", "통과" if lcode == 0 else "오류 있음. 고친 뒤 다시 돌린다")
    print("숫자 점검:", fsum)
    print("도식 렌더:", rsum)
    return 1 if (lcode or rcode == 1) else 0


# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("normalize", help="전사 내보내기 파일을 '[시각] 화자: 내용' 형식으로 통일")
    p.add_argument("input")
    p.add_argument("--out", required=True)
    p.add_argument("--merge", type=float, default=None, metavar="SEC", help="같은 화자의 연속 발화를 이 간격(초) 안에서 합침")
    p.set_defaults(fn=cmd_normalize)

    p = sub.add_parser("speakers", help="화자 라벨별 단서 보고서")
    p.add_argument("turns")
    p.add_argument("--roster", help="참석자 명단 파일 (한 줄에 한 명)")
    p.add_argument("--glossary", help="명단이 없을 때 용어집의 '# 사람' 항목을 명단으로 쓴다")
    p.add_argument("--out")
    p.add_argument("--samples", type=int, default=6)
    p.add_argument("--width", type=int, default=160)
    p.set_defaults(fn=cmd_speakers)

    p = sub.add_parser("terms", help="자료 용어와 비슷하게 들린 오인식 후보")
    p.add_argument("turns")
    p.add_argument("--glossary", required=True, help="자료에서 뽑은 이름·지명·사업명 목록 (한 줄에 하나)")
    p.add_argument("--min", type=float, default=0.75, help="용어의 유사도 하한 (기본 0.75, 더 넓게 보려면 0.65)")
    p.add_argument("--min-name", type=float, default=0.55, help="호칭이 뒤따르는 사람 이름의 유사도 하한 (기본 0.55)")
    p.add_argument("--out")
    p.set_defaults(fn=cmd_terms)

    p = sub.add_parser("apply", help="확정된 화자 대응과 보정을 전사 전체에 일괄 적용")
    p.add_argument("turns")
    p.add_argument("--speakers", help='{"Speaker 1": "이름", "overrides": [{"time": "00:34:22", "speaker": "이름"}]}')
    p.add_argument("--corrections", help='[{"from": "들린 표기", "to": "바른 표기"}]')
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_apply)

    p = sub.add_parser("prepare", help="전사 통일, 화자 단서, 오인식 후보를 한 번에")
    p.add_argument("input")
    p.add_argument("--work", required=True, help="작업 폴더 (_work)")
    p.add_argument("--roster", help="참석자 명단 파일")
    p.add_argument("--glossary", help="용어집 (기본: 작업 폴더의 glossary.txt)")
    p.set_defaults(fn=cmd_prepare)

    p = sub.add_parser("check", help="형식 검사, 숫자 점검, 도식 렌더 검수를 한 번에")
    p.add_argument("note")
    p.add_argument("--profile", choices=("record", "minutes"), default="record")
    p.add_argument("--target", choices=("note", "pele"), default="note")
    p.add_argument("--width", type=int, default=760, help="본문 폭 (노트·보고서 760, 한글 문서 680)")
    p.add_argument("--sources", nargs="*", help="숫자를 대조할 출처 파일들 (자료, 메모, turns.txt)")
    p.add_argument("--work", help="작업 폴더 (기본: 노트 옆의 _work)")
    p.add_argument("--pele", help="achmage-pele 폴더 (같은 볼트면 자동으로 찾는다)")
    p.set_defaults(fn=cmd_check)

    p = sub.add_parser("lint", help="완성 노트의 형식 검사")
    p.add_argument("note")
    p.add_argument("--profile", choices=("record", "minutes"), default="record", help="record: 풀텍스트 정리, minutes: 배포용 회의록")
    p.add_argument("--target", choices=("note", "pele"), default="note", help="note: 노트 앱이 직접 그림, pele: Pele가 그림으로 바꿔 넣음(HWPX 등)")
    p.add_argument("--max-depth", type=int, default=3)
    p.set_defaults(fn=cmd_lint)

    p = sub.add_parser("facts", help="노트의 숫자 중 출처 파일에 없는 것 나열")
    p.add_argument("note")
    p.add_argument("--sources", nargs="+", required=True)
    p.set_defaults(fn=cmd_facts)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
