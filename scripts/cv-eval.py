#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
R3-2.5 / CV-1：纯 CV 测量原型（只出数，不做产品）。

    python scripts/cv-eval.py                 # 全套：口径 B 主表 + 口径 A + 变体 + 病灶
    python scripts/cv-eval.py --variant base  # 只跑基线
    python scripts/cv-eval.py --json out.json # 明细落盘

本机解释器要带 Pillow + numpy（`python` 是 WorkBuddy 自带的裸解释器，没有 PIL）：
    "C:\\Users\\17897\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" scripts/cv-eval.py

────────────────────────────────────────────────────────────────────
一、真值从哪来

图是我们自己渲染的，坐标全在 `src/examples/<id>.json` 的 `render_specs[*]` 里，
所以真值不需要人标：
  · 线段 = `edges[].points` 的逐段（缺 points 时按 from/to 折线还原），只取轴对齐段；
  · 结点 = `nodes[].kind === 'dot'`；
  · 符号 = `nodes[].kind ∈ SYMBOL_KINDS`，中心就是节点的 (x, y)。
user unit → 图像像素的唯一权威是 `getScreenCTM()`（拍图时一并存进 `<name>.meta.json`），
不拿 viewBox 与 rect 自己推 —— preserveAspectRatio 的留白推错一次，整张表就是假的。

二、两个「长线段」口径（先说清，不然数是自说自话）

  A 口径（§2 字面）：长度 ≥120 **图像像素**。本仓库的图是 viewBox 754 单位缩到 535px
    渲染的（scale≈0.71），照字面取 120px，A3-CB 只剩 1 条、A2 一条都没有（全图 16 条），
    指标退化成一个样本 —— 所以 A 口径只作附列。
  B 口径（主表）：长度 ≥60 **图元单位**（≈42 图像像素 @scale 0.71）。这一档是反解
    `docs/R3总计划.md` §R3-2.5 那张基线表得到的：只有 T=60u 能同时给出「长水平 5 /
    长竖直 4 / 结点 3」，与文档逐位吻合。也就是说文档说的「长导线」实际是这个量级。

三、识别这一侧：只复现 §0 描述的基线原型

  「按行/列扫长游程 + 局部密度找结点」——就是这两个动作，不多做：
    1. 墨迹掩膜：与背景色的通道最大差 > INK_T（γ 无关，直接比 RGB）；
    2. 长游程：每行取连续墨迹 ≥ MINLEN 的段，每列同理，再把共线且在容差内的游程并成一条；
    3. 结点：以墨迹在 W×W 窗口里的占比 > DOT_DENSITY 为候选，连通域质心即候选点。
  没有符号阶段、没有跨器件补线、没有文字扣除 —— 这些正是要量化的病灶。

四、命中判定（§2 写死的）

  线段：同朝向、位置差 ≤4px、重叠 ≥80% 真值长度；
  结点：距离 ≤4px；
  符号：框中心 ≤12px 且 kind 一致（基线无符号阶段 → 未测）；
  端到端同解：识别结构 → draftToGraph → 与快照 result 逐位差 ≤1e-12（同上，未测）。
  精确率用**双向 80%**（重叠既要 ≥80% 真值长度、也要 ≥80% 检出长度），
  这样「把两条线并成一条跨过真实断口」这种过度合并会被扣成 FP，不会白送分。
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "docs" / "shots"
EXAMPLES = ROOT / "src" / "examples"

SYMBOL_KINDS = {
    "res",
    "vsrc",
    "isrc",
    "npn",
    "pnp",
    "nmos",
    "nmos-r90",
    "pmos",
    "opamp",
    "ctrlsrc",
    "diode",
    "gnd",
}

# 口径 B：60 图元单位；口径 A：120 图像像素
MODE_B_UNITS = 60.0
MODE_A_PIXELS = 120.0

INK_T = 40.0          # 与背景的通道最大差
DOT_DENSITY = 0.30    # 局部密度阈值（§0 的「局部密度法」）
DOT_WIN_UNITS = 12.7  # 窗口边长 = 12.7 图元单位（≈ dot 直径 9u 的 1.4 倍）
POS_TOL = 4.0         # 位置容差 px
DOT_TOL = 4.0
OVERLAP = 0.80


# ────────────────────────────────────────────────────────────── 真值


def example_id(name: str) -> str:
    return name[:-3] if name.endswith("-pi") else name


def load_spec(name: str) -> dict:
    ex = json.loads((EXAMPLES / f"{example_id(name)}.json").read_text(encoding="utf-8"))
    spec_id = "pi" if name.endswith("-pi") else "main"
    for spec in ex["render_specs"]:
        if spec["id"] == spec_id:
            return spec
    raise SystemExit(f"{name}: 快照里没有 spec {spec_id}")


def spec_segments(spec: dict) -> list[tuple[str, float, float, float, bool]]:
    """(朝向, 坐标, 起, 止, 是否虚线)：朝向 H 用 y 作坐标，V 用 x。

    `dashed` 要留着：等效图里的 vbe 控制标注是 `strokeDasharray: 5 4`，
    游程法一定扫不出来 —— 这是「已知且可解释」的一类，不能混进「算法不行」里。
    """
    pos = {node["id"]: (node["x"], node["y"]) for node in spec["nodes"]}
    raw: list[tuple[str, float, float, float, bool]] = []
    for edge in spec["edges"]:
        pts = edge.get("points")
        if not pts:
            a = pos.get(edge["from"])
            b = pos.get(edge["to"])
            if not a or not b:
                continue
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            pts = [[a[0], a[1]], [mid[0], a[1]], [mid[0], b[1]], [b[0], b[1]]]
        dashed = bool(edge.get("dashed"))
        for i in range(len(pts) - 1):
            (x1, y1), (x2, y2) = pts[i], pts[i + 1]
            if abs(y1 - y2) < 1e-9 and abs(x1 - x2) > 1e-9:
                raw.append(("H", y1, min(x1, x2), max(x1, x2), dashed))
            elif abs(x1 - x2) < 1e-9 and abs(y1 - y2) > 1e-9:
                raw.append(("V", x1, min(y1, y2), max(y1, y2), dashed))
    return merge_collinear(raw)


def merge_collinear(
    segs: list[tuple[str, float, float, float, bool]], coord_tol: float = 1.0
) -> list[tuple[str, float, float, float, bool]]:
    """同朝向 + 同坐标（±1u）+ **确有重叠** → 并成一条。

    只做「去重」：两条首尾相接（重叠为 0）的独立导线段不算重复，不许并
    —— 否则 §0 基线表里 A3-CB 的「长水平 5 / 长竖直 4」会被并成 3/3。
    """
    buckets: dict[tuple[str, int], list[list[float]]] = defaultdict(list)
    for orient, coord, start, end, dashed in segs:
        key = (orient, int(round(coord)))
        placed = False
        for item in buckets[key]:
            overlap = min(item[2], end) - max(item[1], start)
            if abs(item[0] - coord) <= coord_tol and overlap > 0.5:
                item[0] = (item[0] + coord) / 2
                item[1] = min(item[1], start)
                item[2] = max(item[2], end)
                item[3] = 1.0 if (item[3] or dashed) else 0.0
                placed = True
                break
        if not placed:
            buckets[key].append([coord, start, end, 1.0 if dashed else 0.0])
    out = []
    for (orient, _), items in buckets.items():
        for coord, start, end, dashed in items:
            out.append((orient, coord, start, end, bool(dashed)))
    return out


def truth_of(name: str, meta: dict) -> dict:
    spec = load_spec(name)
    scale = abs(meta["ctm"][0])
    segs_u = spec_segments(spec)
    # 第五项是**图元单位**长度（口径 B 直接比它）；像素长度到评估时用 mapper 现算。
    segs = [(o, c, s, e, (e - s), dashed) for o, c, s, e, dashed in segs_u]
    dots = [(n["x"], n["y"]) for n in spec["nodes"] if n["kind"] == "dot"]
    symbols = [(n["kind"], n["x"], n["y"]) for n in spec["nodes"] if n["kind"] in SYMBOL_KINDS]
    texts = [(n["x"], n["y"], n.get("label") or "") for n in spec["nodes"] if n["kind"] == "text"]
    return {
        "spec": spec,
        "scale": scale,
        "segments_u": segs,      # 长度是图元单位
        "dots_u": dots,
        "symbols_u": symbols,
        "texts_u": texts,
        "text_boxes_u": meta.get("textBoxes") or [],
    }


class Map:
    """user unit → PNG 像素。png = (ctm·(u,v) − clip.origin) × dpr。

    dpr 不能漏：DPR=2 时 clip 给的是 CSS px，PNG 里是设备像素，坐标要乘 2。
    """

    def __init__(self, meta: dict):
        a, b, c, d, e, f = meta["ctm"]
        self.a, self.b, self.c, self.d, self.e, self.f = a, b, c, d, e, f
        self.ox = meta["clip"]["x"]
        self.oy = meta["clip"]["y"]
        self.k = float(meta.get("dpr", 1))
        self.scale = math.hypot(a, b)

    def pt(self, u: float, v: float) -> tuple[float, float]:
        return (
            (self.a * u + self.c * v + self.e - self.ox) * self.k,
            (self.b * u + self.d * v + self.f - self.oy) * self.k,
        )

    def seg(self, orient: str, coord: float, start: float, end: float):
        if orient == "H":
            x1, y1 = self.pt(start, coord)
            x2, y2 = self.pt(end, coord)
        else:
            x1, y1 = self.pt(coord, start)
            x2, y2 = self.pt(coord, end)
        return (orient, (y1 + y2) / 2 if orient == "H" else (x1 + x2) / 2, min(x1, x2) if orient == "H" else min(y1, y2),
                max(x1, x2) if orient == "H" else max(y1, y2))


# ────────────────────────────────────────────────────────────── 识别（基线原型）


def load_image(base: Path, name: str) -> tuple[np.ndarray, np.ndarray]:
    img = Image.open(base / f"{name}.png").convert("RGB")
    arr = np.asarray(img).astype(np.int16)
    h, w, _ = arr.shape
    corners = np.concatenate([
        arr[:8, :8].reshape(-1, 3),
        arr[:8, -8:].reshape(-1, 3),
        arr[-8:, :8].reshape(-1, 3),
        arr[-8:, -8:].reshape(-1, 3),
    ])
    bg = np.median(corners, axis=0)
    diff = np.abs(arr - bg).max(axis=2)
    return arr, diff > INK_T


def runs_1d(mask: np.ndarray) -> list[list[tuple[int, int]]]:
    """每一行的连续 True 区间（闭区间）。行内起点与终点按下标顺序配对。"""
    out: list[list[tuple[int, int]]] = []
    for row in mask:
        if not row.any():
            out.append([])
            continue
        d = np.diff(np.concatenate(([0], row.astype(np.int8), [0])))
        starts = np.flatnonzero(d == 1)
        ends = np.flatnonzero(d == -1) - 1
        out.append([(int(s), int(e)) for s, e in zip(starts, ends)])
    return out


def extract_segments(mask: np.ndarray, min_len: float, row_tol: float = 1.5) -> list[tuple[str, float, float, float]]:
    """行/列扫长游程 → 共线合并 → 长度过滤。"""
    height, width = mask.shape
    found: list[tuple[str, float, float, float]] = []

    def collect(runs_per_line, horizontal: bool):
        clusters: list[dict] = []
        for line, runs in enumerate(runs_per_line):
            for start, end in runs:
                if end - start + 1 < min_len:
                    continue
                for cl in clusters:
                    # row_tol 要随像素密度放大：DPR=2 时一条线占 2~3 行，写死 1.5 会把同一条线拆成两条
                    if abs(cl["line"] - line) <= row_tol and start <= cl["end"] + 2 * row_tol and end >= cl["start"] - 2 * row_tol:
                        cl["lines"].append(line)
                        cl["line"] = sum(cl["lines"]) / len(cl["lines"])
                        cl["start"] = min(cl["start"], start)
                        cl["end"] = max(cl["end"], end)
                        break
                else:
                    clusters.append({"line": float(line), "lines": [line], "start": start, "end": end})
        for cl in clusters:
            if cl["end"] - cl["start"] + 1 < min_len:
                continue
            if horizontal:
                found.append(("H", cl["line"], float(cl["start"]), float(cl["end"])))
            else:
                found.append(("V", cl["line"], float(cl["start"]), float(cl["end"])))

    collect(runs_1d(mask), True)
    collect(runs_1d(mask.T), False)
    return found


def extract_dots(mask: np.ndarray, win: int) -> list[tuple[float, float, float]]:
    """局部密度 → 连通域质心。返回 (x, y, 密度峰值)。"""
    half = win // 2
    if mask.shape[0] <= win or mask.shape[1] <= win:
        return []
    integral = np.pad(mask.astype(np.int32).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    h, w = mask.shape
    ys = np.arange(half, h - half)
    xs = np.arange(half, w - half)
    y0, x0 = ys - half, xs - half
    y1, x1 = ys + half + 1, xs + half + 1
    box = (
        integral[np.ix_(y1, x1)]
        - integral[np.ix_(y0, x1)]
        - integral[np.ix_(y1, x0)]
        + integral[np.ix_(y0, x0)]
    )
    dens = box / float(win * win)
    hot = dens > DOT_DENSITY
    if not hot.any():
        return []
    lab = np.zeros(hot.shape, dtype=np.int32)
    cur = 0
    from collections import deque

    for i, j in np.argwhere(hot):
        if lab[i, j]:
            continue
        cur += 1
        queue = deque([(i, j)])
        lab[i, j] = cur
        while queue:
            a, b = queue.popleft()
            for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                na, nb = a + da, b + db
                if 0 <= na < hot.shape[0] and 0 <= nb < hot.shape[1] and hot[na, nb] and not lab[na, nb]:
                    lab[na, nb] = cur
                    queue.append((na, nb))
    out = []
    for k in range(1, cur + 1):
        sel = np.argwhere(lab == k)
        if len(sel) < 2:  # 单像素孤立 → 不像实心圆
            continue
        peak = float(dens[lab == k].max())
        out.append((float(sel[:, 1].mean()) + half, float(sel[:, 0].mean()) + half, peak))
    return out


def bridge_segments(segs, mask, max_gap_px: float):
    """变体 B1：同轴共线的两段，若断口里确实有墨迹（被器件本体/文字遮住）就并成一条。"""
    out = list(segs)
    changed = True
    while changed:
        changed = False
        for i in range(len(out)):
            for j in range(i + 1, len(out)):
                o1, c1, s1, e1 = out[i]
                o2, c2, s2, e2 = out[j]
                if o1 != o2 or abs(c1 - c2) > 2.0:
                    continue
                if s1 > s2:
                    o1, c1, s1, e1, o2, c2, s2, e2 = o2, c2, s2, e2, o1, c1, s1, e1
                gap = s2 - e1
                if gap <= 0 or gap > max_gap_px:
                    continue
                # 断口里墨迹覆盖率（>=30% 才认为「被东西挡住」而不是本来就没线）
                if o1 == "H":
                    band = mask[max(0, int(round(c1)) - 2): int(round(c1)) + 3, int(e1): int(s2) + 1]
                else:
                    band = mask[int(e1): int(s2) + 1, max(0, int(round(c1)) - 2): int(round(c1)) + 3]
                cover = float(band.any(axis=0).mean()) if band.size else 0.0
                if cover < 0.30:
                    continue
                out[i] = (o1, (c1 + c2) / 2, min(s1, s2), max(e1, e2))
                del out[j]
                changed = True
                break
            if changed:
                break
    return out


# ────────────────────────────────────────────────────────────── 匹配与归因


def match(truth, det):
    """
    一对一贪心匹配，判据按 §2（**只看真值侧**）：同朝向、位置差 ≤4px、重叠 ≥80% 真值长度。

    为什么精确率也用真值侧而不搞「双向 80%」：本仓库的符号自带引脚短线，且与导线同宽同色，
    游程法必然把线「拉长」到符号体内。用双向判据会把同一个病灶罚两次（真值算漏检、
    检出算误报），把精确率压成 0 却说不清问题在哪。拉长另外单列「过度延伸」诊断。
    返回 (pair, 未中真值, 未中检出, 匹配对的长度比)。
    """
    pairs = []
    for ti, (to_, tc, ts, te) in enumerate(truth):
        for di, (do_, dc, ds, de) in enumerate(det):
            if to_ != do_ or abs(tc - dc) > POS_TOL:
                continue
            overlap = min(te, de) - max(ts, ds)
            tlen, dlen = te - ts, de - ds
            if overlap <= 0 or tlen <= 0 or dlen <= 0:
                continue
            if overlap >= OVERLAP * tlen:
                pairs.append((ti, di, overlap / tlen, dlen / tlen))
    pairs.sort(key=lambda p: (-p[2], abs(p[3] - 1.0)))
    used_t, used_d = set(), set()
    final = []
    for ti, di, score, ratio in pairs:
        if ti in used_t or di in used_d:
            continue
        used_t.add(ti)
        used_d.add(di)
        final.append((ti, di, score, ratio))
    miss_t = [i for i in range(len(truth)) if i not in used_t]
    fp_d = [i for i in range(len(det)) if i not in used_d]
    return final, miss_t, fp_d


def strip_coverage(mask, orient, coord, start, end, half=2):
    """沿真值线取一条 ±half 的带，返回（覆盖率, 断口列表）。"""
    lo, hi = int(round(start)), int(round(end))
    if hi - lo < 1:
        return 1.0, []
    if orient == "H":
        band = mask[max(0, int(round(coord)) - half): int(round(coord)) + half + 1, lo: hi + 1]
        covered = band.any(axis=0) if band.size else np.zeros(hi - lo + 1, dtype=bool)
    else:
        band = mask[lo: hi + 1, max(0, int(round(coord)) - half): int(round(coord)) + half + 1]
        covered = band.any(axis=1) if band.size else np.zeros(hi - lo + 1, dtype=bool)
    cov = float(covered.mean()) if covered.size else 0.0
    gaps, run = [], 0
    for v in covered:
        if not v:
            run += 1
        elif run:
            if run >= 6:
                gaps.append(run)
            run = 0
    if run >= 6:
        gaps.append(run)
    return cov, gaps


def disc_area(mask: np.ndarray, x: float, y: float, r: float) -> int:
    """以 (x,y) 为心、r 为半径的圆内墨迹像素数 —— 判「实心圆」用它，比局部密度稳。"""
    y0 = max(0, int(math.floor(y - r)))
    y1 = min(mask.shape[0], int(math.ceil(y + r)) + 1)
    x0 = max(0, int(math.floor(x - r)))
    x1 = min(mask.shape[1], int(math.ceil(x + r)) + 1)
    if y1 <= y0 or x1 <= x0:
        return 0
    yy, xx = np.mgrid[y0:y1, x0:x1]
    sel = (xx - x) ** 2 + (yy - y) ** 2 <= r * r
    return int(mask[y0:y1, x0:x1][sel].sum())


def segments_through(segs, x: float, y: float, tol: float = POS_TOL) -> int:
    """有多少条检出线段穿过这一点（±tol）。结点双条件的第二个条件。"""
    count = 0
    for o, c, s, e in segs:
        if o == "H" and abs(y - c) <= tol and s - tol <= x <= e + tol:
            count += 1
        elif o == "V" and abs(x - c) <= tol and s - tol <= y <= e + tol:
            count += 1
    return count


def dot_sweep(rows: list[dict]) -> str:
    """结点「实心圆面积 + ≥N 线交汇」能救回多少：全表扫阈值，报上限。

    阈值是从**这 12 张图**反推的，所以这一节只能读作「双条件的上限」，
    不能当成泛化精度 —— 真要上，得在 CV-2 用独立样本再定。
    """
    cands = [c for row in rows for c in row["dot_cands"]]
    feats = [f for row in rows for f in row["truth_dot_feats"]]
    total_truth = sum(row["truth_dots"] for row in rows)
    if not cands:
        return "（无候选）"
    f_disc = sorted(f["disc"] for f in feats)
    f_seg = sorted(f["nseg"] for f in feats)
    fp_disc = sorted(c["disc"] for c in cands if not c["tp"])
    fp_seg = sorted(c["nseg"] for c in cands if not c["tp"])

    def pct(values, q):
        if not values:
            return 0
        idx = min(len(values) - 1, max(0, int(round((len(values) - 1) * q))))
        return values[idx]

    lines = [
        "| 特征 | 真结点（中位/最小） | 误报结点（中位/最大） |",
        "|---|---|---|",
        f"| 实心圆面积（半径 {4.5 * 1.3:.1f}×scale px 内的墨迹像素） | {pct(f_disc, 0.5)} / {f_disc[0] if f_disc else 0} | {pct(fp_disc, 0.5)} / {fp_disc[-1] if fp_disc else 0} |",
        f"| 穿过该点的线段数 | {pct(f_seg, 0.5)} / {f_seg[0] if f_seg else 0} | {pct(fp_seg, 0.5)} / {fp_seg[-1] if fp_seg else 0} |",
        "",
        "| 双条件（面积≥ / 线段数≥） | 结点 recall | 结点 precision | 保留候选数 |",
        "|---|---|---|---|",
    ]
    best = None
    for seg_th in (0, 1, 2, 3):
        for disc_th in (0, 8, 12, 16, 20, 24, 28, 32):
            keep = [c for c in cands if c["disc"] >= disc_th and c["nseg"] >= seg_th]
            tp = sum(1 for c in keep if c["tp"])
            recall = tp / total_truth if total_truth else 0
            precision = tp / len(keep) if keep else 0
            if best is None or (precision > best[2] and recall >= 0.9):
                if recall >= 0.9:
                    best = (seg_th, disc_th, precision, recall, len(keep))
            if seg_th in (2, 3) and disc_th in (12, 20, 28):
                lines.append(f"| 面积≥{disc_th} / 线≥{seg_th} | {recall * 100:.0f}% | {precision * 100:.0f}% | {len(keep)} |")
    if best:
        lines.append(
            f"| **上限（recall≥90% 下最高 precision）** | {best[3] * 100:.0f}% | **{best[2] * 100:.0f}%** | {best[4]} |"
        )
    return "\n".join(lines)


def in_text(x, y, boxes, shrink=1.0):
    for x0, y0, w, h in boxes:
        if x0 + shrink <= x <= x0 + w - shrink and y0 + shrink <= y <= y0 + h - shrink:
            return True
    return False


def near_segment(x, y, segs, tol=POS_TOL):
    for o, c, s, e in segs:
        if o == "H" and abs(y - c) <= tol and s - tol <= x <= e + tol:
            return True
        if o == "V" and abs(x - c) <= tol and s - tol <= y <= e + tol:
            return True
    return False


def text_ratio(seg, boxes, samples=21):
    """这条检出线有多大比例落在文字框里。"""
    o, c, s, e = seg
    if e - s <= 0 or not boxes:
        return 0.0
    hit = 0
    for i in range(samples):
        t = s + (e - s) * i / (samples - 1)
        x, y = (t, c) if o == "H" else (c, t)
        if in_text(x, y, boxes):
            hit += 1
    return hit / samples


def attribute_miss(mask, seg, det, dashed):
    o, c, s, e = seg
    if dashed:
        return "虚线（dash 5/4 把游程打散）"
    cov, gaps = strip_coverage(mask, o, c, s, e)
    if cov < 0.35:
        return "笔画没进掩膜（细描边/低对比）"
    same = [d for d in det if d[0] == o and abs(d[1] - c) <= POS_TOL]
    if same:
        best = max(same, key=lambda d: min(e, d[3]) - max(s, d[2]))
        ratio = (best[3] - best[2]) / max(1e-6, e - s)
        if ratio > 1.25:
            return f"与相邻段粘连（检出 {ratio:.1f}× 长，重叠不足 80%）"
        if ratio < 0.80:
            return f"被切断（检出只有 {ratio:.1f}× 长）"
    if gaps:
        return f"断口（{len(gaps)} 处，最长 {max(gaps)}px）"
    return "整段未被扫出"


def attribute_fp_seg(seg, truth_segs, text_boxes):
    o, c, s, e = seg
    if text_ratio(seg, text_boxes) > 0.6:
        return "文字行（被当成导线）"
    if near_segment((s + e) / 2, c if o == "H" else c, truth_segs):
        return "与真值线段粘连 / 跨断口过度合并"
    for t in truth_segs:
        if t[0] == o and abs(t[1] - c) <= 12:
            return "与真值线段粘连 / 跨断口过度合并"
    return "符号内部笔画（边框/三角/箭头）"


def attribute_fp_dot(x, y, truth_segs, text_boxes):
    if in_text(x, y, text_boxes):
        return "文字笔画"
    if near_segment(x, y, truth_segs):
        return "线条交汇 / 线体加粗（不是实心圆）"
    return "符号内部（圆心/三角/箭头/方框角）"


# ────────────────────────────────────────────────────────────── 单图评估


def eval_image(name: str, base: Path, variant: str, min_len_mode: str, dpr_scale: float = 1.0) -> dict:
    meta = json.loads((base / f"{name}.meta.json").read_text(encoding="utf-8"))
    truth = truth_of(name, meta)
    mapper = Map(meta)
    scale = mapper.scale
    _, mask = load_image(base, name)

    if min_len_mode == "A":
        min_len = MODE_A_PIXELS
    else:
        min_len = MODE_B_UNITS * scale

    det = extract_segments(mask, min_len, row_tol=1.5 * mapper.k)
    if variant == "bridge":
        # 断口上限取「一个器件包围盒」的量级：120 图元单位
        det = bridge_segments(det, mask, max_gap_px=120.0 * scale)
    win = int(round(DOT_WIN_UNITS * scale * mapper.k))
    win += 0 if win % 2 else 1
    dots = extract_dots(mask, max(7, win))
    dot_radius = 4.5 * scale * mapper.k * 1.3

    all_px = [mapper.seg(o, c, s, e) for o, c, s, e, _, _ in truth["segments_u"]]
    truth_segs_px, dashed_px = [], []
    for (o, c, s, e), (_, _, _, _, length_u, dashed) in zip(all_px, truth["segments_u"]):
        # 口径 A 按图像像素，口径 B 按图元单位（同一张图的 scale 不同，不能混着比）
        if (min_len_mode == "A" and (e - s) >= MODE_A_PIXELS) or (min_len_mode == "B" and length_u >= MODE_B_UNITS):
            truth_segs_px.append((o, c, s, e))
            dashed_px.append(dashed)

    pairs, miss_t, fp_d = match(truth_segs_px, det)
    stretch = [ratio for _, _, _, ratio in pairs]
    truth_dots_px = [mapper.pt(u, v) for u, v in truth["dots_u"]]
    symbols_px = [(k, *mapper.pt(u, v)) for k, u, v in truth["symbols_u"]]
    texts_px = [(mapper.pt(u, v)[0], mapper.pt(u, v)[1], label) for u, v, label in truth["texts_u"]]
    text_boxes = []
    for x0, y0, w, h in truth["text_boxes_u"]:
        px, py = mapper.pt(x0, y0)
        text_boxes.append((px, py, w * scale, h * scale))

    dot_pairs = []
    used_truth_dots, used_det_dots = set(), set()
    for ti, (tx, ty) in enumerate(truth_dots_px):
        for di, (dx, dy, _) in enumerate(dots):
            if math.hypot(tx - dx, ty - dy) <= DOT_TOL and ti not in used_truth_dots and di not in used_det_dots:
                used_truth_dots.add(ti)
                used_det_dots.add(di)
                dot_pairs.append((ti, di))
                break

    misses = []
    for i in miss_t:
        o, c, s, e = truth_segs_px[i]
        reason = attribute_miss(mask, (o, c, s, e), det, dashed_px[i] if i < len(dashed_px) else False)
        misses.append({
            "orient": o,
            "coord": round(c, 1),
            "len_px": round(e - s, 1),
            "reason": reason,
        })
    fps = []
    for i in fp_d:
        o, c, s, e = det[i]
        fps.append({
            "orient": o,
            "coord": round(c, 1),
            "len_px": round(e - s, 1),
            "reason": attribute_fp_seg((o, c, s, e), truth_segs_px, text_boxes),
        })
    dot_fps = [d for i, d in enumerate(dots) if i not in used_det_dots]
    dot_fp_reasons = [attribute_fp_dot(d[0], d[1], truth_segs_px, text_boxes) for d in dot_fps]

    # 结点「双条件」的可行性：把每个候选与每个真结点的两个特征都量出来，
    # 不在这里拍阈值 —— 阈值该由 main() 做全表扫描后给（阈值从本评估集反推，
    # 只能当**上限**看，不能当成泛化能力）。
    cands = []
    for i, (dx, dy, peak) in enumerate(dots):
        cands.append({
            "x": round(dx, 1),
            "y": round(dy, 1),
            "peak": round(peak, 3),
            "disc": disc_area(mask, dx, dy, dot_radius),
            "nseg": segments_through(det, dx, dy),
            "tp": i in used_det_dots,
        })
    truth_feats = [
        {
            "disc": disc_area(mask, x, y, dot_radius),
            "nseg": segments_through(det, x, y),
        }
        for x, y in truth_dots_px
    ]

    return {
        "name": name,
        "scale": scale,
        "variant": variant,
        "min_len_mode": min_len_mode,
        "min_len_px": round(min_len, 1),
        "truth_segments": len(truth_segs_px),
        "truth_h": sum(1 for seg in truth_segs_px if seg[0] == "H"),
        "truth_v": sum(1 for seg in truth_segs_px if seg[0] == "V"),
        "det_segments": len(det),
        "seg_tp": len(pairs),
        "stretch_mean": round(sum(stretch) / len(stretch), 3) if stretch else 0.0,
        "stretch_max": round(max(stretch), 3) if stretch else 0.0,
        "misses": misses,
        "fps": fps,
        "truth_dots": len(truth_dots_px),
        "det_dots": len(dots),
        "dot_tp": len(dot_pairs),
        "dot_fps": [{"x": round(d[0], 1), "y": round(d[1], 1), "reason": r} for d, r in zip(dot_fps, dot_fp_reasons)],
        "dot_cands": cands,
        "truth_dot_feats": truth_feats,
        "symbols": len(symbols_px),
        "truth": truth,
    }


def annotate(name: str, base: Path = SHOTS, out: Path | None = None) -> Path:
    """把真值 / 检出 / 误报成因画在一张图上 —— 报告里那张图就是它生成的。"""
    from PIL import ImageDraw

    meta = json.loads((base / f"{name}.meta.json").read_text(encoding="utf-8"))
    truth = truth_of(name, meta)
    mapper = Map(meta)
    scale = mapper.scale
    _, mask = load_image(base, name)
    det = extract_segments(mask, MODE_B_UNITS * scale, row_tol=1.5 * mapper.k)
    win = int(round(DOT_WIN_UNITS * scale * mapper.k))
    win += 0 if win % 2 else 1
    dots = extract_dots(mask, max(7, win))

    truth_segs_px, dashed_px = [], []
    for (o, c, s, e), (_, _, _, _, length_u, dashed) in zip(
        [mapper.seg(*row[:4]) for row in truth["segments_u"]], truth["segments_u"]
    ):
        if length_u >= MODE_B_UNITS:
            truth_segs_px.append((o, c, s, e))
            dashed_px.append(dashed)
    truth_dots_px = [mapper.pt(u, v) for u, v in truth["dots_u"]]
    text_boxes = []
    for x0, y0, w, h in truth["text_boxes_u"]:
        px, py = mapper.pt(x0, y0)
        text_boxes.append((px, py, w * scale, h * scale))

    img = Image.open(base / f"{name}.png").convert("RGB")
    draw = ImageDraw.Draw(img)
    # 检出：蓝
    for o, c, s, e in det:
        if o == "H":
            draw.line([s, c, e, c], fill=(70, 140, 255), width=1)
        else:
            draw.line([c, s, c, e], fill=(70, 140, 255), width=1)
    # 真值：绿；虚线真值用绿色点线示意
    for (o, c, s, e), dashed in zip(truth_segs_px, dashed_px):
        step = 6 if dashed else None
        if step:
            x = s
            while x < e:
                if o == "H":
                    draw.line([x, c, min(x + 3, e), c], fill=(0, 220, 120), width=1)
                else:
                    draw.line([c, x, c, min(x + 3, e)], fill=(0, 220, 120), width=1)
                x += step
        else:
            if o == "H":
                draw.line([s, c, e, c], fill=(0, 220, 120), width=1)
            else:
                draw.line([c, s, c, e], fill=(0, 220, 120), width=1)
    # 真结点：黄圈
    for x, y in truth_dots_px:
        draw.ellipse([x - 5, y - 5, x + 5, y + 5], outline=(255, 220, 0), width=1)
    # 检出结点：按成因上色（命中=绿，文字=品红，符号=橙，线体=青）
    used = set()
    for ti, (tx, ty) in enumerate(truth_dots_px):
        for di, (dx, dy, _) in enumerate(dots):
            if di not in used and math.hypot(tx - dx, ty - dy) <= DOT_TOL:
                used.add(di)
    for di, (dx, dy, _) in enumerate(dots):
        if di in used:
            colour = (0, 220, 120)
        else:
            reason = attribute_fp_dot(dx, dy, truth_segs_px, text_boxes)
            colour = (255, 60, 200) if reason.startswith("文字") else (255, 150, 0) if reason.startswith("符号") else (0, 200, 220)
        draw.ellipse([dx - 3, dy - 3, dx + 3, dy + 3], outline=colour, width=1)
    target = out or (SHOTS / f"cv-annot-{name}.png")
    img.save(target)
    return target


def pr(tp: int, truth: int, det: int) -> tuple[float, float]:
    recall = tp / truth if truth else float("nan")
    precision = tp / det if det else float("nan")
    return recall, precision


def fmt(v: float) -> str:
    return "—" if (isinstance(v, float) and math.isnan(v)) else f"{v * 100:.0f}%"


def run_set(names, base, variant, mode) -> list[dict]:
    return [eval_image(n, base, variant, mode) for n in names]


def table(rows: list[dict], title: str) -> str:
    lines = [
        f"### {title}",
        "",
        "| 图 | 线段真值 | 检出 | 线段 recall | 线段 precision | 结点真值 | 检出 | 结点 recall | 结点 precision | 符号 acc | 端到端同解 |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    tot = Counter()
    for row in rows:
        tr, pr_ = pr(row["seg_tp"], row["truth_segments"], row["det_segments"])
        dr, dp = pr(row["dot_tp"], row["truth_dots"], row["det_dots"])
        tot["st"] += row["truth_segments"]
        tot["sd"] += row["det_segments"]
        tot["sp"] += row["seg_tp"]
        tot["dt"] += row["truth_dots"]
        tot["dd"] += row["det_dots"]
        tot["dp"] += row["dot_tp"]
        lines.append(
            f"| {row['name']} | {row['truth_segments']} | {row['det_segments']} | {fmt(tr)} | {fmt(pr_)} | "
            f"{row['truth_dots']} | {row['det_dots']} | {fmt(dr)} | {fmt(dp)} | 未测 | 未测 |"
        )
    tr, pr_ = pr(tot["sp"], tot["st"], tot["sd"])
    dr, dp = pr(tot["dp"], tot["dt"], tot["dd"])
    lines.append(
        f"| **合计** | {tot['st']} | {tot['sd']} | **{fmt(tr)}** | **{fmt(pr_)}** | "
        f"{tot['dt']} | {tot['dd']} | **{fmt(dr)}** | **{fmt(dp)}** | — | — |"
    )
    return "\n".join(lines)


def bucket(reason: str) -> str:
    """把带数字的归因折成稳定类别，便于跨图合计。"""
    if reason.startswith("虚线"):
        return "虚线（dash 5/4 打散游程）"
    if reason.startswith("断口"):
        return "断口（器件本体/文字打断）"
    if reason.startswith("与相邻段粘连"):
        return "与相邻段粘连（检出被拉长）"
    if reason.startswith("被切断"):
        return "被切断（检出过短）"
    return reason


def pathology(rows: list[dict]) -> str:
    miss_c, fp_c, dot_c = Counter(), Counter(), Counter()
    for row in rows:
        for m in row["misses"]:
            miss_c[bucket(m["reason"])] += 1
        for f in row["fps"]:
            fp_c[f["reason"]] += 1
        for d in row["dot_fps"]:
            dot_c[d["reason"]] += 1
    keys = []
    for counter in (miss_c, fp_c, dot_c):
        for key in counter:
            if key not in keys:
                keys.append(key)
    keys.sort(key=lambda k: -(miss_c[k] + fp_c[k] + dot_c[k]))
    lines = [
        "| 病灶 | 漏检线段 | 误报线段 | 误报结点 |",
        "|---|---|---|---|",
    ]
    for key in keys:
        lines.append(f"| {key} | {miss_c[key]} | {fp_c[key]} | {dot_c[key]} |")
    lines.append(f"| **合计** | **{sum(miss_c.values())}** | **{sum(fp_c.values())}** | **{sum(dot_c.values())}** |")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--variant", default="all", choices=["all", "base"])
    parser.add_argument("--only", default="")
    parser.add_argument("--json", default="")
    parser.add_argument("--annotate", default="")
    args = parser.parse_args()

    if args.annotate:
        for name in [n.strip() for n in args.annotate.split(",") if n.strip()]:
            print(f"标注图 → {annotate(name)}")
        return 0

    index = json.loads((SHOTS / "cv-index.json").read_text(encoding="utf-8"))
    names = [t["name"] for t in index["targets"]]
    if args.only:
        wanted = {n.strip() for n in args.only.split(",") if n.strip()}
        names = [n for n in names if n in wanted]

    base_rows = run_set(names, SHOTS, "base", "B")
    print(table(base_rows, "口径 B（≥60 图元单位，主表；复现 §R3-2.5 的 5/4/3）"))
    print()

    # 自校准：口径 B 必须把 A3-CB 复现成文档 §0 的「长水平 5 / 长竖直 4 / 结点 3」。
    # 这条不是装饰 —— 口径一旦被悄悄改掉，基线就没法跟文档那张表比了。
    cal = next((r for r in base_rows if r["name"] == "A3-CB"), None)
    if cal:
        good = cal["truth_h"] == 5 and cal["truth_v"] == 4 and cal["truth_dots"] == 3
        print(
            f"自校准（A3-CB）：长水平 {cal['truth_h']} / 长竖直 {cal['truth_v']} / 结点 {cal['truth_dots']}"
            f" —— {'与 §0 基线表一致' if good else '与 §0 基线表不一致，口径被改过'}"
        )
        print()
        if not good:
            raise SystemExit("口径 B 自校准失败：先别信下面的数")

    mode_a = run_set(names, SHOTS, "base", "A")
    print(table(mode_a, "口径 A（≥120 图像像素，§2 字面，附列）"))
    print()

    if args.variant == "all":
        two_x = run_set(names, SHOTS / "cv-2x", "base", "B")
        print(table(two_x, "对照组：同机 2× 像素密度（口径 B 不变；只看分辨率是不是瓶颈）"))
        print()
        for variant, title in [
            ("bridge", "改法 1：跨断口合并（同轴共线 + 断口内有墨迹）"),
        ]:
            rows = run_set(names, SHOTS, variant, "B")
            print(table(rows, title))
            print()

        print("### 改法 2 的上限：结点「实心圆面积 + ≥N 条线交汇」")
        print()
        print(dot_sweep(base_rows))
        print()

    print(pathology(base_rows))
    print()

    if args.json:
        payload = {
            "names": names,
            "base": [{k: v for k, v in row.items() if k != "truth"} for row in base_rows],
            "modeA": [{k: v for k, v in row.items() if k != "truth"} for row in mode_a],
        }
        Path(args.json).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"明细 → {args.json}", file=sys.stderr)

    # 判定（阈值写在 §4，不改）
    tot_st = sum(r["truth_segments"] for r in base_rows)
    tot_sp = sum(r["seg_tp"] for r in base_rows)
    tot_sd = sum(r["det_segments"] for r in base_rows)
    tot_dt = sum(r["truth_dots"] for r in base_rows)
    tot_dp = sum(r["dot_tp"] for r in base_rows)
    recall = tot_sp / tot_st if tot_st else 0.0
    precision = tot_sp / tot_sd if tot_sd else 0.0
    dot_recall = tot_dp / tot_dt if tot_dt else 0.0
    ok = recall >= 0.95 and precision >= 0.90 and dot_recall >= 0.90
    print(
        f"判定（§4 门槛：线段 recall ≥95% / precision ≥90% / 结点 recall ≥90%）\n"
        f"  实测 recall {recall * 100:.1f}% · precision {precision * 100:.1f}% · 结点 recall {dot_recall * 100:.1f}%\n"
        f"  → {'达标，可以进 CV-2' if ok else '不达标：CV 只能做辅助'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
