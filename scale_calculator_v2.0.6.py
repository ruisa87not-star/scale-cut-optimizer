import csv
import re
import threading
from collections import Counter
from pathlib import Path
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox, filedialog

try:
    from tkinterdnd2 import TkinterDnD, DND_FILES
    _DND_AVAILABLE = True
except ImportError:
    _DND_AVAILABLE = False

from copy import deepcopy
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# ─────────────────────────────────────────
# 1. CORE LOGIC & GLOBAL FULL OPTIMIZATION
# ─────────────────────────────────────────

def expand_data(data):
    items = []
    for length, qty in data:
        items.extend([length] * qty)
    return items

def solve_global_optimization(items, capacity, threshold, offcut_bins):
    """
    工業級全局混合優化引擎：
    將現有餘料與標準新料視為一體，透過 Falkenauer 評分矩陣進行動態交換。
    """
    # ── Step 1: 建立初始解 (使用改良型 BFD) ──
    remaining_items = sorted(items, reverse=True)
    bins = [] 
    
    # 先建立舊餘料桶
    for offcut_cap in sorted(offcut_bins, reverse=True):
        bins.append({"capacity": offcut_cap, "items": [], "is_offcut": True})
        
    # 用 BFD 概念把物品塞入桶中（優先塞舊餘料，塞不下就開新料）
    for item in remaining_items:
        best_idx, min_space = None, max(capacity, max(offcut_bins) if offcut_bins else 0) + 1
        for idx, b in enumerate(bins):
            rem = b["capacity"] - sum(b["items"])
            if rem >= item and (rem - item) < min_space:
                best_idx = idx
                min_space = rem - item
                
        if best_idx is not None:
            bins[best_idx]["items"].append(item)
        else:
            bins.append({"capacity": capacity, "items": [item], "is_offcut": False})

    # ── Step 2: 全局深度局部搜尋 (混合餘料與新料進行 Move & Swap) ──
    bins_opt, m, s = deep_local_search_hybrid(bins, threshold)
    
    # ── Step 3: 拆分結果以符合後續報表與圖表輸出 ──
    used_offcuts = []
    final_new_bins = []
    final_new_rems = []
    
    for b in bins_opt:
        rem = b["capacity"] - sum(b["items"])
        if b["is_offcut"]:
            used_offcuts.append({
                "cap": b["capacity"],
                "items": sorted(b["items"], reverse=True),
                "rem": rem
            })
        else:
            if b["items"]: # 確保不是空桶
                final_new_bins.append(sorted(b["items"], reverse=True))
                final_new_rems.append(rem)
                
    # 為了對照組報表 BFD，我們單純對所有零件做一次標準 BFD 作為保底基準（不考慮舊餘料）
    bfd_bins_raw = []
    for item in sorted(items, reverse=True):
        bi, ms = None, capacity + 1
        for idx, b in enumerate(bfd_bins_raw):
            rem = capacity - sum(b)
            if rem >= item and (rem - item) < ms:
                bi, ms = idx, rem - item
        if bi is not None: bfd_bins_raw[bi].append(item)
        else: bfd_bins_raw.append([item])
    bfd_rems_raw = [capacity - sum(b) for b in bfd_bins_raw]

    return used_offcuts, final_new_bins, final_new_rems, bfd_bins_raw, bfd_rems_raw, m, s


def calc_fitness_hybrid(bins, threshold):
    """
    混合型核心適應度函數：
    1. 針對新料：嚴厲懲罰小於門檻的死亡碎料 (<150)。
    2. 針對舊餘料：鼓勵盡量用完 (rem=0) 或是留下足夠大的二次餘料 (rem>=150)。
    """
    score = 0
    for b in bins:
        if not b["items"]: continue
        fill = b.get("used", sum(b["items"]))
        rem = b["capacity"] - fill
        base_score = (fill / b["capacity"]) ** 2
        
        if b["is_offcut"]:
            if rem == 0: score += base_score * 1.5      
            elif rem >= threshold: score += base_score  
            else: score += base_score * 0.5            
        else:
            if rem == 0: score += base_score * 1.2
            elif rem >= threshold: score += base_score
            else: score += base_score * 0.05            
    return score


def deep_local_search_hybrid(initial_bins, threshold, max_steps=8000):
    """ 全局混合型局部搜尋：打破舊餘料與新料的隔閡，全面互相交換物件 """
    current_bins = [
        {
            "capacity": b["capacity"],
            "items": list(b["items"]),
            "is_offcut": b["is_offcut"],
            "used": sum(b["items"]),
        }
        for b in initial_bins
    ]
    current_fitness = calc_fitness_hybrid(current_bins, threshold)
    
    improved = True
    steps, moves_made, swaps_made = 0, 0, 0
    
    while improved and steps < max_steps:
        improved = False
        steps += 1
        
        current_bins.sort(key=lambda b: calc_fitness_hybrid([b], threshold))
        
        # ── 全局 Move (搬移) ──
        for i in range(len(current_bins)):
            if not current_bins[i]["items"]: continue
            item_idx = 0
            while item_idx < len(current_bins[i]["items"]):
                item = current_bins[i]["items"][item_idx]
                moved = False
                for j in range(len(current_bins)):
                    if i == j: continue
                    if current_bins[j]["used"] + item <= current_bins[j]["capacity"]:
                        current_bins[j]["items"].append(item)
                        current_bins[j]["used"] += item
                        val = current_bins[i]["items"].pop(item_idx)
                        current_bins[i]["used"] -= val
                        
                        new_fitness = calc_fitness_hybrid(current_bins, threshold)
                        if new_fitness > current_fitness + 1e-9:
                            current_fitness = new_fitness
                            improved, moved = True, True
                            moves_made += 1
                            break
                        else:
                            current_bins[i]["items"].insert(item_idx, val)
                            current_bins[i]["used"] += val
                            current_bins[j]["items"].pop()
                            current_bins[j]["used"] -= item
                if not moved:
                    item_idx += 1
            if improved: break
        if improved: continue

        # ── 全局 Swap (跨新舊料精準交換) ──
        for i in range(len(current_bins)):
            if not current_bins[i]["items"]: continue
            for j in range(i + 1, len(current_bins)):
                for idx_i, item_i in enumerate(current_bins[i]["items"]):
                    for idx_j, item_j in enumerate(current_bins[j]["items"]):
                        if item_i == item_j: continue
                        
                        used_i = current_bins[i]["used"]
                        used_j = current_bins[j]["used"]
                        new_used_i = used_i - item_i + item_j
                        new_used_j = used_j - item_j + item_i

                        if new_used_i <= current_bins[i]["capacity"] and \
                           new_used_j <= current_bins[j]["capacity"]:
                            
                            current_bins[i]["items"][idx_i] = item_j
                            current_bins[j]["items"][idx_j] = item_i
                            current_bins[i]["used"] = new_used_i
                            current_bins[j]["used"] = new_used_j
                            
                            new_fitness = calc_fitness_hybrid(current_bins, threshold)
                            if new_fitness > current_fitness + 1e-9:
                                current_fitness = new_fitness
                                improved = True
                                swaps_made += 1
                                break
                            else:
                                current_bins[i]["items"][idx_i] = item_i
                                current_bins[j]["items"][idx_j] = item_j
                                current_bins[i]["used"] = used_i
                                current_bins[j]["used"] = used_j
                    if improved: break
                if improved: break
                
        current_bins = [b for b in current_bins if b["items"] or b["is_offcut"]]

    return current_bins, moves_made, swaps_made

# ─────────────────────────────────────────
def _piece_cost(length):
    """Material consumed by one order piece."""
    return length


def _new_bin(capacity):
    return {"capacity": capacity, "items": [], "is_offcut": False, "used": 0}


def _remaining(bin_data):
    return bin_data["capacity"] - bin_data["used"]


def _plan_metrics(bins, threshold):
    """Unused offcuts remain inventory, so they are never counted as waste."""
    active_bins = [b for b in bins if b["items"]]
    active_new = [b for b in active_bins if not b["is_offcut"]]
    dead_remainders = [
        _remaining(b) for b in active_bins
        if 0 < _remaining(b) < threshold
    ]
    return {
        "new_rolls": len(active_new),
        "dead_scrap_length": sum(dead_remainders),
        "dead_scrap_count": len(dead_remainders),
        "offcut_consumed": sum(b["used"] for b in active_bins if b["is_offcut"]),
        "recoverable_remainder": sum(
            _remaining(b) for b in active_bins if _remaining(b) >= threshold
        ),
    }


def _objective(bins, threshold):
    """Business objective: fewer new rolls, less scrap, then use offcuts."""
    metrics = _plan_metrics(bins, threshold)
    new_remainder = sum(
        _remaining(b) for b in bins if b["items"] and not b["is_offcut"]
    )
    return (
        metrics["new_rolls"],
        metrics["dead_scrap_length"],
        metrics["dead_scrap_count"],
        -metrics["offcut_consumed"],
        new_remainder,
    )


def _build_best_fit_plan(items, capacity, offcut_bins):
    """Fast first pass with cached usage (unlike the old repeated sums)."""
    bins = [
        {"capacity": offcut, "items": [], "is_offcut": True, "used": 0}
        for offcut in sorted(offcut_bins, reverse=True)
    ]
    for item in sorted(items, reverse=True):
        cost = _piece_cost(item)
        fitting = [
            (idx, bin_data) for idx, bin_data in enumerate(bins)
            if _remaining(bin_data) >= cost
        ]
        if fitting:
            _, target = min(
                fitting,
                key=lambda pair: (
                    _remaining(pair[1]) - cost,
                    0 if pair[1]["is_offcut"] else 1,
                ),
            )
        else:
            target = _new_bin(capacity)
            bins.append(target)
        target["items"].append(item)
        target["used"] += cost
    return bins


def _try_empty_new_roll(bins, source_idx, node_limit=12000):
    """Atomically relocate a complete new roll through bounded backtracking."""
    source = bins[source_idx]
    if source["is_offcut"] or not source["items"]:
        return False

    pieces = sorted(source["items"], reverse=True)
    destinations = [idx for idx in range(len(bins)) if idx != source_idx]
    nodes = 0

    def place(piece_idx):
        nonlocal nodes
        nodes += 1
        if nodes > node_limit:
            return False
        if piece_idx == len(pieces):
            return True

        piece = pieces[piece_idx]
        cost = _piece_cost(piece)
        choices, seen_states = [], set()
        for idx in destinations:
            target = bins[idx]
            if _remaining(target) < cost:
                continue
            state = (target["capacity"], target["used"], target["is_offcut"])
            if state in seen_states:
                continue
            seen_states.add(state)
            choices.append(idx)

        for idx in sorted(choices, key=lambda i: _remaining(bins[i]) - cost):
            target = bins[idx]
            target["items"].append(piece)
            target["used"] += cost
            if place(piece_idx + 1):
                return True
            target["items"].pop()
            target["used"] -= cost
        return False

    if not place(0):
        return False
    source["items"] = []
    source["used"] = 0
    return True


def _remove_empty_new_bins(bins):
    return [bin_data for bin_data in bins if bin_data["is_offcut"] or bin_data["items"]]


def _improve_by_moves_and_swaps(bins, threshold, max_steps):
    """Improve scrap and offcut usage without sacrificing a better objective."""
    moves_made, swaps_made = 0, 0
    current_objective = _objective(bins, threshold)

    for _ in range(max_steps):
        improved = False
        total_items = sum(len(bin_data["items"]) for bin_data in bins)
        source_order = sorted(
            range(len(bins)),
            key=lambda i: (0 if not bins[i]["is_offcut"] else 1, _remaining(bins[i])),
        )
        if total_items > 220:
            # Keep the GUI responsive for bulk customer-order imports. The
            # targeted sources are the least-filled new rolls, where a move is
            # most likely to eliminate a roll or a dead remainder.
            source_order = source_order[:80]
        for source_idx in source_order:
            source = bins[source_idx]
            for item in list(source["items"]):
                cost = _piece_cost(item)
                target_order = sorted(
                    (j for j in range(len(bins)) if j != source_idx and _remaining(bins[j]) >= cost),
                    key=lambda j: (_remaining(bins[j]) - cost, 0 if bins[j]["is_offcut"] else 1),
                )
                for target_idx in target_order:
                    target = bins[target_idx]
                    try:
                        item_idx = source["items"].index(item)
                    except ValueError:
                        break
                    source["items"].pop(item_idx)
                    source["used"] -= cost
                    target["items"].append(item)
                    target["used"] += cost
                    candidate_objective = _objective(bins, threshold)
                    if candidate_objective < current_objective:
                        current_objective = candidate_objective
                        moves_made += 1
                        improved = True
                        break
                    target["items"].pop()
                    target["used"] -= cost
                    source["items"].insert(item_idx, item)
                    source["used"] += cost
                if improved:
                    break
            if improved:
                break
        if improved:
            bins[:] = _remove_empty_new_bins(bins)
            continue

        # Large orders stay responsive; their roll count is still improved above.
        if total_items > 220:
            break
        for left_idx, left in enumerate(bins):
            if not left["items"]:
                continue
            for right_idx in range(left_idx + 1, len(bins)):
                right = bins[right_idx]
                if not right["items"]:
                    continue
                for li, left_item in enumerate(list(left["items"])):
                    left_cost = _piece_cost(left_item)
                    for ri, right_item in enumerate(list(right["items"])):
                        if left_item == right_item:
                            continue
                        right_cost = _piece_cost(right_item)
                        new_left_used = left["used"] - left_cost + right_cost
                        new_right_used = right["used"] - right_cost + left_cost
                        if new_left_used > left["capacity"] or new_right_used > right["capacity"]:
                            continue
                        left["items"][li], right["items"][ri] = right_item, left_item
                        old_left_used, old_right_used = left["used"], right["used"]
                        left["used"], right["used"] = new_left_used, new_right_used
                        candidate_objective = _objective(bins, threshold)
                        if candidate_objective < current_objective:
                            current_objective = candidate_objective
                            swaps_made += 1
                            improved = True
                            break
                        left["items"][li], right["items"][ri] = left_item, right_item
                        left["used"], right["used"] = old_left_used, old_right_used
                    if improved:
                        break
                if improved:
                    break
            if improved:
                break
        if not improved:
            break
    return moves_made, swaps_made


def deep_local_search_hybrid(initial_bins, threshold, max_steps=None):
    """Optimise a feasible plan with new roll count as the primary objective."""
    bins = [
        {
            "capacity": bin_data["capacity"],
            "items": list(bin_data["items"]),
            "is_offcut": bin_data["is_offcut"],
            "used": bin_data.get(
                "used", sum(_piece_cost(item) for item in bin_data["items"])
            ),
        }
        for bin_data in initial_bins
    ]
    roll_removals = 0
    while True:
        candidates = sorted(
            (idx for idx, bin_data in enumerate(bins)
             if not bin_data["is_offcut"] and bin_data["items"]),
            key=lambda idx: (bins[idx]["used"], len(bins[idx]["items"])),
        )
        removed = False
        for idx in candidates:
            if _try_empty_new_roll(bins, idx):
                bins = _remove_empty_new_bins(bins)
                roll_removals += 1
                removed = True
                break
        if not removed:
            break

    if max_steps is None:
        total_items = sum(len(bin_data["items"]) for bin_data in bins)
        max_steps = 160 if total_items <= 220 else 50
    moves_made, swaps_made = _improve_by_moves_and_swaps(bins, threshold, max_steps)
    return bins, moves_made + roll_removals, swaps_made


def solve_global_optimization(items, capacity, threshold, offcut_bins):
    """Plan orders against existing offcuts and standard new material rolls."""
    initial_bins = _build_best_fit_plan(items, capacity, offcut_bins)
    bins_opt, moves, swaps = deep_local_search_hybrid(initial_bins, threshold)

    used_offcuts, final_new_bins, final_new_rems = [], [], []
    for bin_data in bins_opt:
        remainder = _remaining(bin_data)
        if bin_data["is_offcut"]:
            used_offcuts.append({
                "cap": bin_data["capacity"],
                "items": sorted(bin_data["items"], reverse=True),
                "rem": remainder,
                "used": bin_data["used"],
            })
        elif bin_data["items"]:
            final_new_bins.append(sorted(bin_data["items"], reverse=True))
            final_new_rems.append(remainder)

    bfd_bins = _build_best_fit_plan(items, capacity, [])
    bfd_bins_raw = [sorted(bin_data["items"], reverse=True) for bin_data in bfd_bins if bin_data["items"]]
    bfd_rems_raw = [_remaining(bin_data) for bin_data in bfd_bins if bin_data["items"]]
    return used_offcuts, final_new_bins, final_new_rems, bfd_bins_raw, bfd_rems_raw, moves, swaps


# 2. EXCEL EXPORT HELPERS & FUNCTIONS
# ─────────────────────────────────────────

COLORS = {
    "header_bg": "1F3864", "header_fg": "FFFFFF", 
    "zero_bg": "E2EFDA", "usable_bg": "D9E1F2", "scrap_bg": "FCE4D6", 
    "alt_row": "F2F2F2", "white": "FFFFFF", "accent": "2E75B6", "border_col": "BFBFBF",
}

# 🌟 移至最頂層定義，確保全局不報 NameError 的核心排序權重函數
def _sort_key(rem, threshold):
    if rem == 0: return 0
    if rem >= threshold: return 1
    return 2

def _border(): return Border(left=Side(style="thin", color=COLORS["border_col"]), right=Side(style="thin", color=COLORS["border_col"]), top=Side(style="thin", color=COLORS["border_col"]), bottom=Side(style="thin", color=COLORS["border_col"]))
def _fill(hex_color): return PatternFill("solid", fgColor=hex_color)
def _font(bold=False, color="000000", size=10): return Font(bold=bold, color=color, name="Arial", size=size)
def _center(): return Alignment(horizontal="center", vertical="center", wrap_text=True)
def _left(): return Alignment(horizontal="left", vertical="center", wrap_text=True)

def write_summary_sheet(ws, bins_bfd, rem_bfd, bins_opt, rem_opt, data, items, capacity, threshold, used_offcuts):
    ws.title = "總覽"
    ws.merge_cells("A1:G1")
    ws["A1"] = f"📦 全局優化排卷報告 (容量: {capacity}, 可用餘料門檻: ≥{threshold})"
    ws["A1"].font, ws["A1"].fill, ws["A1"].alignment = Font(bold=True, size=14, color=COLORS["header_fg"]), _fill(COLORS["header_bg"]), _center()
    ws.row_dimensions[1].height = 32
    ws["A2"] = f"訂單總長：{sum(items):,}　|　訂單件數：{len(items):,}"
    ws["A2"].font = _font(color="666666", size=10)

    # ── 1. 數據大表 ──
    comp_headers = ["方法 / 項目", "動用新料卷數", "新料總浪費", "完美 (0浪費)", f"可回收餘料 (≥{threshold})", f"死亡碎料 (<{threshold})", "碎料總長度"]
    for col, h in enumerate(comp_headers, 1):
        c = ws.cell(row=3, column=col, value=h)
        c.font, c.fill, c.alignment, c.border = _font(bold=True, color=COLORS["header_fg"]), _fill(COLORS["header_bg"]), _center(), _border()

    # 純 BFD 對照組
    total_w_bfd = sum(rem_bfd)
    zero_bfd = sum(1 for r in rem_bfd if r == 0)
    usable_bfd = sum(1 for r in rem_bfd if r >= threshold)
    scrap_bfd = sum(1 for r in rem_bfd if 0 < r < threshold)
    scrap_w_bfd = sum(r for r in rem_bfd if 0 < r < threshold)
    
    vals_bfd = ["純 BFD 演算法 (無舊餘料對照組)", len(bins_bfd), total_w_bfd, zero_bfd, usable_bfd, scrap_bfd, scrap_w_bfd]
    for col, v in enumerate(vals_bfd, 1):
        c = ws.cell(row=4, column=col, value=v)
        c.font, c.fill, c.alignment, c.border = _font(), _fill(COLORS["white"]), _center() if col > 1 else _left(), _border()

    # 全局混合優化組 (新料部分)
    total_w_opt = sum(rem_opt)
    zero_opt = sum(1 for r in rem_opt if r == 0)
    usable_opt = sum(1 for r in rem_opt if r >= threshold)
    scrap_opt = sum(1 for r in rem_opt if 0 < r < threshold)
    scrap_w_opt = sum(r for r in rem_opt if 0 < r < threshold)
    
    vals_opt = ["工業全局混合優化結果 (新有料卷)", len(bins_opt), total_w_opt, zero_opt, usable_opt, scrap_opt, scrap_w_opt]
    for col, v in enumerate(vals_opt, 1):
        c = ws.cell(row=5, column=col, value=v)
        c.font, c.fill, c.alignment, c.border = _font(), _fill(COLORS["white"]), _center() if col > 1 else _left(), _border()
        if col == 6 and v > 0: c.fill = _fill(COLORS["scrap_bg"])

    # ── 2. 現有舊餘料消耗總結專區 ──
    if used_offcuts:
        ws.merge_cells("A7:G7")
        ws["A7"] = "♻️ 舊餘料庫存消耗統計摘要"
        ws["A7"].font = _font(bold=True, color=COLORS["accent"], size=11)
        
        offcut_headers = ["總投入舊餘料數", "完美完全消耗", "產生二次餘料(可回收)", "產生死亡碎料(<150)", "完全未動用數量", "舊餘料指派件數", "舊餘料剩餘總長"]
        for col, h in enumerate(offcut_headers, 1):
            c = ws.cell(row=8, column=col, value=h)
            c.font, c.fill, c.alignment, c.border = _font(bold=True, color=COLORS["header_fg"]), _fill(COLORS["accent"]), _center(), _border()
            
        total_offcuts = len(used_offcuts)
        perfect_off = sum(1 for o in used_offcuts if o["rem"] == 0 and len(o["items"]) > 0)
        usable_off = sum(1 for o in used_offcuts if o["rem"] >= threshold and len(o["items"]) > 0)
        scrap_off = sum(1 for o in used_offcuts if 0 < o["rem"] < threshold)
        unused_off = sum(1 for o in used_offcuts if len(o["items"]) == 0)
        total_packed_off = sum(len(o["items"]) for o in used_offcuts)
        total_rem_off = sum(o["rem"] for o in used_offcuts)
        
        vals_off = [total_offcuts, perfect_off, usable_off, scrap_off, unused_off, total_packed_off, total_rem_off]
        for col, v in enumerate(vals_off, 1):
            c = ws.cell(row=9, column=col, value=v)
            c.font, c.fill, c.alignment, c.border = _font(), _fill(COLORS["white"]), _center(), _border()
            if col == 4 and v > 0: c.fill = _fill(COLORS["scrap_bg"])

    for col_idx, width in enumerate([28, 14, 12, 12, 16, 16, 14], 1): 
        ws.column_dimensions[get_column_letter(col_idx)].width = width

def write_detail_sheet(ws, bins, remainders, label, threshold):
    ws.title = label
    ws.merge_cells("A1:E1")
    ws["A1"] = f"📋 {label} — 明細"
    ws["A1"].font, ws["A1"].fill, ws["A1"].alignment = Font(bold=True, size=13, color=COLORS["header_fg"]), _fill(COLORS["header_bg"]), _center()
    ws.row_dimensions[1].height = 28

    headers = ["卷號", "內容（各段長度）", "總長", "剩餘", "狀態"]
    col_widths = [8, 60, 10, 10, 14]
    for col, (h, w) in enumerate(zip(headers, col_widths), 1):
        c = ws.cell(row=2, column=col, value=h)
        c.font, c.fill, c.alignment, c.border = _font(bold=True, color=COLORS["header_fg"]), _fill(COLORS["accent"]), _center(), _border()
        ws.column_dimensions[get_column_letter(col)].width = w

    sorted_pairs = sorted(zip(bins, remainders), key=lambda x: (_sort_key(x[1], threshold), x[1]))

    for row_idx, (b, rem) in enumerate(sorted_pairs, 3):
        total, alt = sum(b), row_idx % 2 == 0
        if rem == 0:
            waste_fill, status = _fill(COLORS["zero_bg"]), "✨完美 (0)"
        elif rem >= threshold:
            waste_fill, status = _fill(COLORS["usable_bg"]), "♻️可回收"
        else:
            waste_fill, status = _fill(COLORS["scrap_bg"]), "❌死碎料"
            
        row_fill = _fill(COLORS["alt_row"] if alt else COLORS["white"])
        vals = [row_idx - 2, " + ".join(map(str, b)), total, rem, status]
        for col, v in enumerate(vals, 1):
            c = ws.cell(row=row_idx, column=col, value=v)
            c.font, c.alignment, c.border = _font(), _center() if col != 2 else _left(), _border()
            c.fill = waste_fill if col >= 4 else row_fill
        ws.row_dimensions[row_idx].height = 18

    legend_row = len(bins) + 5
    ws.cell(row=legend_row, column=1, value="圖例：").font = _font(bold=True)
    legends = [
        (COLORS["zero_bg"], "完美 (剩餘 = 0)"),
        (COLORS["usable_bg"],  f"可回收 (剩餘 ≥ {threshold})"),
        (COLORS["scrap_bg"], f"死亡碎料 (0 < 剩餘 < {threshold})"),
    ]
    for i, (color, text) in enumerate(legends):
        c = ws.cell(row=legend_row, column=2 + i, value=text)
        c.fill = _fill(color)
        c.font, c.alignment, c.border = _font(), _center(), _border()

def write_input_sheet(ws, data):
    ws.title = "輸入資料"
    ws.merge_cells("A1:C1")
    ws["A1"] = "📥 輸入資料"
    ws["A1"].font, ws["A1"].fill, ws["A1"].alignment = Font(bold=True, size=13, color=COLORS["header_fg"]), _fill(COLORS["header_bg"]), _center()

    for col, h in enumerate(["長度", "數量", "小計長度"], 1):
        c = ws.cell(row=2, column=col, value=h)
        c.font, c.fill, c.alignment, c.border = _font(bold=True, color=COLORS["header_fg"]), _fill(COLORS["accent"]), _center(), _border()

    for row_idx, (length, qty) in enumerate(data, 3):
        f = _fill(COLORS["alt_row"] if row_idx % 2 == 0 else COLORS["white"])
        for col, v in enumerate([length, qty, length * qty], 1):
            c = ws.cell(row=row_idx, column=col, value=v)
            c.font, c.fill, c.alignment, c.border = _font(), f, _center(), _border()

    for col_idx, w in enumerate([12, 10, 14], 1): ws.column_dimensions[get_column_letter(col_idx)].width = w

def write_offcut_sheet(ws, used_offcuts, threshold):
    ws.title = "舊餘料消耗明細"
    ws.merge_cells("A1:F1")
    ws["A1"] = "♻️ 舊餘料排料優化明細"
    ws["A1"].font = Font(bold=True, size=13, color=COLORS["header_fg"])
    ws["A1"].fill = _fill(COLORS["header_bg"])
    ws["A1"].alignment = _center()
    ws.row_dimensions[1].height = 28

    headers = ["餘料容量", "已指派排料項目", "已使用長度", "剩餘長度", "狀態"]
    col_widths = [14, 50, 14, 14, 16]
    for col, (h, w) in enumerate(zip(headers, col_widths), 1):
        c = ws.cell(row=2, column=col, value=h)
        c.font = _font(bold=True, color=COLORS["header_fg"])
        c.fill = _fill(COLORS["accent"])
        c.alignment = _center()
        c.border = _border()
        ws.column_dimensions[get_column_letter(col)].width = w

    sorted_offcuts = sorted(used_offcuts, key=lambda o: (_sort_key(o["rem"], threshold), o["rem"]))

    for row_idx, o in enumerate(sorted_offcuts, 3):
        cap, packed, rem = o["cap"], o["items"], o["rem"]
        used = cap - rem
        if rem == 0:
            status, waste_fill = "✨完美完全消耗", _fill(COLORS["zero_bg"])
        elif rem >= threshold:
            status, waste_fill = "♻️二次可回收", _fill(COLORS["usable_bg"])
        else:
            status, waste_fill = "❌死碎料", _fill(COLORS["scrap_bg"])

        row_fill = _fill(COLORS["alt_row"] if row_idx % 2 == 0 else COLORS["white"])
        vals = [cap, " + ".join(map(str, packed)) if packed else "（完全未動用）", used, rem, status]
        for col, v in enumerate(vals, 1):
            c = ws.cell(row=row_idx, column=col, value=v)
            c.font = _font()
            c.alignment = _left() if col == 2 else _center()
            c.border = _border()
            c.fill = waste_fill if col >= 4 else row_fill
        ws.row_dimensions[row_idx].height = 18

def write_diagram_sheet(ws, used_offcuts, bins_opt, rem_opt, capacity):
    ws.title = "裁切圖解 (Visual Layout)"
    
    unique_lengths = set()
    for o in used_offcuts: unique_lengths.update(o["items"])
    for b in bins_opt: unique_lengths.update(b)
    
    palette = [
        "FFB3BA", "FFDFBA", "FFFFBA", "B8E4B8", "BAE1FF", 
        "D8BFD8", "E6B8AF", "F4CCCC", "D9EAD3", "C9DAF8", 
        "CFE2F3", "D0E0E3", "FFF2CC", "FCE5CD", "EAD1DC",
        "FF9999", "99CCFF", "99FF99", "FFCC99", "CC99FF"
    ]
    color_map = {length: palette[i % len(palette)] for i, length in enumerate(sorted(unique_lengths, reverse=True))}

    headers = ["卷號/來源", "總產能", "剩餘", "裁切明細視覺化塊 (由左至右) 👉"]
    for col, h in enumerate(headers, 1):
        c = ws.cell(row=1, column=col, value=h)
        c.font, c.fill, c.alignment, c.border = _font(bold=True, color=COLORS["header_fg"]), _fill(COLORS["header_bg"]), _center(), _border()
        
    ws.column_dimensions['A'].width = 15
    ws.column_dimensions['B'].width = 10
    ws.column_dimensions['C'].width = 10

    row_idx = 2
    for i, o in enumerate(used_offcuts, 1):
        ws.cell(row=row_idx, column=1, value=f"♻️ 舊餘料原桶 {i}").font = _font(bold=True)
        ws.cell(row=row_idx, column=2, value=o["cap"]).font = _font()
        ws.cell(row=row_idx, column=3, value=o["rem"]).font = _font()
        for col_idx, item in enumerate(o["items"], 4):
            c = ws.cell(row=row_idx, column=col_idx, value=item)
            c.fill, c.font, c.alignment, c.border = _fill(color_map[item]), _font(), _center(), _border()
            ws.column_dimensions[get_column_letter(col_idx)].width = 12
        row_idx += 1

    if used_offcuts and bins_opt: row_idx += 1

    for i, (b, rem) in enumerate(zip(bins_opt, rem_opt), 1):
        ws.cell(row=row_idx, column=1, value=f"📦 全新料卷 {i}").font = _font(bold=True)
        ws.cell(row=row_idx, column=2, value=capacity).font = _font()
        ws.cell(row=row_idx, column=3, value=rem).font = _font()
        for col_idx, item in enumerate(b, 4):
            c = ws.cell(row=row_idx, column=col_idx, value=item)
            c.fill, c.font, c.alignment, c.border = _fill(color_map[item]), _font(), _center(), _border()
            ws.column_dimensions[get_column_letter(col_idx)].width = 12
        row_idx += 1

    row_idx += 2
    ws.cell(row=row_idx, column=1, value="🎨 色塊對照：").font = _font(bold=True)
    for i, (length, color) in enumerate(color_map.items()):
        c = ws.cell(row=row_idx, column=2+i, value=f"長度 {length}")
        c.fill, c.font, c.alignment, c.border = _fill(color), _font(), _center(), _border()
        ws.column_dimensions[get_column_letter(2+i)].width = 12

def export_excel(bins_bfd, rem_bfd, bins_opt, rem_opt, data, items, capacity, threshold, output_path, used_offcuts=None):
    wb = Workbook()
    write_summary_sheet(wb.active, bins_bfd, rem_bfd, bins_opt, rem_opt, data, items, capacity, threshold, used_offcuts)
    if used_offcuts:
        write_offcut_sheet(wb.create_sheet(), used_offcuts, threshold)
    if bins_opt:
        write_detail_sheet(wb.create_sheet(), bins_opt, rem_opt, "工業新料優化結果", threshold)
    if bins_bfd:
        write_detail_sheet(wb.create_sheet(), bins_bfd, rem_bfd, "BFD原始對照結果", threshold)
    if bins_opt or used_offcuts:
        write_diagram_sheet(wb.create_sheet(), used_offcuts, bins_opt, rem_opt, capacity)
    write_input_sheet(wb.create_sheet(), data)
    wb.save(output_path)

# ─────────────────────────────────────────
# 3. GUI APPLICATION
# ─────────────────────────────────────────

class CuttingStockApp:
    def __init__(self, root):
        self.root = root
        self.root.title("工業級全局餘料優化排版系統 (Ultimate Hybrid Edition)")
        self.root.geometry("1050x850")  
        
        style = ttk.Style()
        style.configure("TButton", font=("Arial", 10))
        style.configure("Header.TLabel", font=("Arial", 10, "bold"))
        
        self.input_data = []   
        self.offcut_data = []  

        # ── Top Frame: Settings ──
        frame_settings = ttk.LabelFrame(root, text=" 參數設定 (Settings) ", padding=10)
        frame_settings.pack(fill="x", padx=10, pady=5)
        
        ttk.Label(frame_settings, text="新料標準長度:").grid(row=0, column=0, padx=5)
        self.entry_capacity = ttk.Entry(frame_settings, width=10)
        self.entry_capacity.insert(0, "10000")
        self.entry_capacity.grid(row=0, column=1, padx=5)
        
        ttk.Label(frame_settings, text="死亡碎料閾值 (Threshold):").grid(row=0, column=2, padx=5, pady=5, sticky="e")
        self.entry_threshold = ttk.Entry(frame_settings, width=15)
        self.entry_threshold.insert(0, "150")
        self.entry_threshold.grid(row=0, column=3, padx=5, pady=5)

        ttk.Separator(frame_settings, orient="horizontal").grid(row=1, column=0, columnspan=7, sticky="ew", pady=4)

        ttk.Label(frame_settings, text="現有餘料長度 (Existing):").grid(row=2, column=0, padx=5, sticky="e")
        self.entry_offcut = ttk.Entry(frame_settings, width=10)
        self.entry_offcut.grid(row=2, column=1, padx=5)

        self.btn_add_offcut = ttk.Button(frame_settings, text="➕ 加入手輸", command=self.add_offcut)
        self.btn_add_offcut.grid(row=2, column=2, padx=5)

        self.btn_load_offcuts = ttk.Button(frame_settings, text="📂 載入餘料 .txt", command=self.browse_offcut_file)
        self.btn_load_offcuts.grid(row=2, column=3, padx=5)
        self.btn_load_offcuts.config(text="📂 匯入餘料 (.txt / .csv / .xlsx)")

        self.btn_clear_offcuts = ttk.Button(frame_settings, text="🗑️ 清空餘料", command=self.clear_offcuts)
        self.btn_clear_offcuts.grid(row=2, column=4, padx=5)

        self.offcut_label_var = tk.StringVar(value="（尚無餘料）")
        ttk.Label(frame_settings, textvariable=self.offcut_label_var, foreground="#2E75B6",
                  font=("Arial", 9, "italic"), wraplength=350, justify="left").grid(row=2, column=5, columnspan=2, padx=10, sticky="w")

        self.entry_offcut.bind("<Return>", lambda e: self.add_offcut())

        # ── Middle Frame: Input and Previews ──
        frame_main = ttk.Frame(root)
        frame_main.pack(fill="both", expand=True, padx=10, pady=5)

        frame_input = ttk.LabelFrame(frame_main, text=" 批量檔案與單筆輸入 ", padding=10)
        frame_input.pack(side="left", fill="y", padx=(0, 5))

        # 餘料拖放區
        ttk.Label(frame_input, text="1. 快速匯入現有餘料:", style="Header.TLabel").pack(anchor="w", pady=(2, 0))
        dnd_offcut_hint = "拖曳餘料 .txt 至此" if _DND_AVAILABLE else "（按上方按鈕載入）"
        self.dnd_offcut = tk.Label(
            frame_input, text=f"♻️  {dnd_offcut_hint}",
            relief="groove", bg="#F4F8F5", fg="#2E7D32",
            font=("Arial", 9, "italic"), padx=8, pady=12,
            cursor="hand2" if _DND_AVAILABLE else "arrow"
        )
        self.dnd_offcut.pack(fill="x", pady=4)

        if _DND_AVAILABLE:
            self.dnd_offcut.drop_target_register(DND_FILES)
            self.dnd_offcut.dnd_bind("<<Drop>>", self._drop_offcut_file)
            self.dnd_offcut.bind("<Enter>", lambda e: self.dnd_offcut.config(bg="#E8F5E9"))
            self.dnd_offcut.bind("<Leave>", lambda e: self.dnd_offcut.config(bg="#F4F8F5"))

        ttk.Separator(frame_input, orient="horizontal").pack(fill="x", pady=6)

        # 需求清單區
        ttk.Label(frame_input, text="2. 快速匯入需求清單:", style="Header.TLabel").pack(anchor="w")
        self.btn_load_cutlist = ttk.Button(frame_input, text="📂 選擇需求清單 .txt", command=self.browse_cutlist_file)
        self.btn_load_cutlist.pack(fill="x", pady=4, ipady=2)
        self.btn_load_cutlist.config(text="📂 匯入訂單 (.txt / .csv / .xlsx)")

        dnd_hint = "拖曳需求 .txt 至此" if _DND_AVAILABLE else "（按上方按鈕載入）"
        self.dnd_cutlist = tk.Label(
            frame_input, text=f"⬇  {dnd_hint}",
            relief="groove", bg="#EEF4FB", fg="#2E75B6",
            font=("Arial", 9, "italic"), padx=8, pady=12,
            cursor="hand2" if _DND_AVAILABLE else "arrow"
        )
        self.dnd_cutlist.pack(fill="x", pady=4)

        if _DND_AVAILABLE:
            self.dnd_cutlist.drop_target_register(DND_FILES)
            self.dnd_cutlist.dnd_bind("<<Drop>>", self._drop_cutlist_file)
            self.dnd_cutlist.bind("<Enter>", lambda e: self.dnd_cutlist.config(bg="#D6E8FA"))
            self.dnd_cutlist.bind("<Leave>", lambda e: self.dnd_cutlist.config(bg="#EEF4FB"))

        ttk.Separator(frame_input, orient="horizontal").pack(fill="x", pady=6)

        # 手動控制項
        ttk.Label(frame_input, text="3. 手動新增需求項目:", style="Header.TLabel").pack(anchor="w")
        ttk.Label(frame_input, text="長度 (Length):").pack(anchor="w", pady=(2,0))
        self.entry_len = ttk.Entry(frame_input, font=("Arial", 11), width=15)
        self.entry_len.pack(pady=2)

        ttk.Label(frame_input, text="數量 (Quantity):").pack(anchor="w", pady=(2,0))
        self.entry_qty = ttk.Entry(frame_input, font=("Arial", 11), width=15)
        self.entry_qty.pack(pady=2)

        self.btn_add = ttk.Button(frame_input, text="➕ 加入需求清單", command=self.add_item)
        self.btn_add.pack(fill="x", pady=10, ipady=3)
        
        self.btn_clear = ttk.Button(frame_input, text="🗑️ 清空右側所有需求", command=self.clear_items)
        self.btn_clear.pack(fill="x", pady=2)

        self.entry_len.bind("<Return>", lambda event: self.add_item())
        self.entry_qty.bind("<Return>", lambda event: self.add_item())

        # 表格預覽
        frame_table = ttk.LabelFrame(frame_main, text=" 需求清單預覽 (雙擊項目可刪除列) ", padding=10)
        frame_table.pack(side="right", fill="both", expand=True, padx=(5, 0))

        columns = ("length", "qty", "total")
        self.tree = ttk.Treeview(frame_table, columns=columns, show="headings", height=8)
        self.tree.heading("length", text="長度 (Length)")
        self.tree.heading("qty", text="數量 (Quantity)")
        self.tree.heading("total", text="小計長度")
        
        self.tree.column("length", anchor="center", width=100)
        self.tree.column("qty", anchor="center", width=100)
        self.tree.column("total", anchor="center", width=100)
        
        scrollbar = ttk.Scrollbar(frame_table, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscroll=scrollbar.set)
        self.tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        self.tree.bind("<Double-1>", self.delete_selected)

        # Log
        frame_output = ttk.LabelFrame(root, text=" 執行紀錄 (Log) ", padding=10)
        frame_output.pack(fill="both", expand=True, padx=10, pady=5)
        self.text_log = scrolledtext.ScrolledText(frame_output, height=6, font=("Consolas", 10), state="disabled", bg="#f4f4f4")
        self.text_log.pack(fill="both", expand=True)
        
        self.btn_run = ttk.Button(root, text="🚀 開始全局優化計算並匯出 Excel", command=self.run_solver_thread)
        self.btn_run.pack(pady=10, ipadx=20, ipady=10)
        
        self.log("💡 提示：此版本已全面重構為「全局混合優化引擎」，會主動調度新舊料零件以消滅死亡碎料。")

    # --- GUI Functions ---

    def add_item(self):
        len_str, qty_str = self.entry_len.get().strip(), self.entry_qty.get().strip()
        if not len_str or not qty_str: return
        try:
            length, qty = int(len_str), int(qty_str)
            if length <= 0 or qty <= 0: raise ValueError
        except ValueError:
            messagebox.showwarning("輸入錯誤", "長度和數量必須是大於 0 的整數！")
            return
        self.input_data.append((length, qty))
        self.update_treeview()
        self.entry_len.delete(0, tk.END)
        self.entry_qty.delete(0, tk.END)
        self.entry_len.focus()

    def update_treeview(self):
        for row in self.tree.get_children(): self.tree.delete(row)
        for i, (length, qty) in enumerate(self.input_data):
            self.tree.insert("", "end", iid=str(i), values=(length, qty, length * qty))

    def delete_selected(self, event):
        selected = self.tree.selection()
        if selected:
            del self.input_data[int(selected[0])]
            self.update_treeview()

    def clear_items(self):
        if messagebox.askyesno("確認", "確定要清空所有資料嗎？"):
            self.input_data = []
            self.update_treeview()

    def _append_log(self, message):
        self.text_log.config(state="normal")
        self.text_log.insert(tk.END, message + "\n")
        self.text_log.see(tk.END)
        self.text_log.config(state="disabled")

    def log(self, message):
        if threading.current_thread() is threading.main_thread():
            self._append_log(message)
        else:
            self.root.after(0, self._append_log, message)

    def set_running_state(self, is_running):
        state = "disabled" if is_running else "normal"
        self.btn_run.config(state=state)
        self.btn_add.config(state=state)

    def show_info(self, title, message):
        self.root.after(0, lambda: messagebox.showinfo(title, message))

    def show_error(self, title, message):
        self.root.after(0, lambda: messagebox.showerror(title, message))

    def add_offcut(self):
        val = self.entry_offcut.get().strip()
        if not val: return
        try:
            length = int(val)
            if length <= 0: raise ValueError
        except ValueError:
            messagebox.showwarning("輸入錯誤", "餘料長度必須是大於 0 的整數！")
            return
        self.offcut_data.append(length)
        self.entry_offcut.delete(0, tk.END)
        self.entry_offcut.focus()
        self.update_offcut_label()

    def clear_offcuts(self):
        self.offcut_data = []
        self.update_offcut_label()

    def update_offcut_label(self):
        if not self.offcut_data: self.offcut_label_var.set("（尚無餘料）")
        else:
            tags = "  ".join(f"[{v}]" for v in self.offcut_data)
            self.offcut_label_var.set(f"餘料: {tags}   共 {len(self.offcut_data)} 段")

    def load_offcuts_from_file(self, path):
        path = path.strip().strip("{}")
        if not path.lower().endswith(".txt"):
            messagebox.showwarning("格式錯誤", "只支援 .txt 檔案！")
            return
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                lines = [l.strip() for l in f if l.strip()]
        except Exception as e:
            messagebox.showerror("讀取失敗", f"無法讀取檔案：\n{e}")
            return

        numbers, skipped = [], []
        for line in lines:
            cleaned = line.replace(",", "")  
            if re.fullmatch(r'\d+', cleaned) and int(cleaned) > 0: numbers.append(int(cleaned))
            else: skipped.append(line)

        if not numbers:
            messagebox.showwarning("無資料", "檔案中找不到任何有效的正整數餘料！")
            return

        self.offcut_data.extend(numbers)
        self.update_offcut_label()
        self.dnd_offcut.config(bg="#E8F5E9")
        self.root.after(800, lambda: self.dnd_offcut.config(bg="#F4F8F5"))
        
        skip_msg = f"\n\n⚠️ 略過 {len(skipped)} 行無法識別的內容。" if skipped else ""
        messagebox.showinfo("載入成功", f"已從檔案批量匯入 {len(numbers)} 筆現有餘料長度。{skip_msg}")

    def load_cutlist_from_file(self, path):
        path = path.strip().strip("{}")
        if not path.lower().endswith(".txt"):
            messagebox.showwarning("格式錯誤", "只支援 .txt 檔案！")
            return
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                lines = [l.strip() for l in f if l.strip()]
        except Exception as e:
            messagebox.showerror("讀取失敗", f"無法讀取檔案：\n{e}")
            return

        numbers, skipped = [], []
        for line in lines:
            cleaned = line.replace(",", "")   
            if re.fullmatch(r'\d+', cleaned) and int(cleaned) > 0: numbers.append(int(cleaned))
            else: skipped.append(line)

        if not numbers:
            messagebox.showwarning("無資料", "檔案中找不到任何有效的正整數！")
            return

        from collections import Counter
        counts = Counter(numbers)
        existing = dict(self.input_data)
        for length, qty in counts.items():
            existing[length] = existing.get(length, 0) + qty
        self.input_data = sorted(existing.items(), key=lambda x: x[0], reverse=True)

        self.update_treeview()
        self.dnd_cutlist.config(bg="#D6FFD6")
        self.root.after(800, lambda: self.dnd_cutlist.config(bg="#EEF4FB"))

        skip_msg = f"\n\n⚠️ 略過 {len(skipped)} 行無法識別的內容。" if skipped else ""
        messagebox.showinfo("載入成功", f"已從檔案載入需求清單：\n  • {len(counts)} 種長度\n  • 共 {len(numbers)} 件{skip_msg}")

    def browse_cutlist_file(self):
        path = filedialog.askopenfilename(title="選擇裁切需求清單 .txt 檔案", filetypes=[("Text Files", "*.txt"), ("All Files", "*.*")])
        if path: self.load_cutlist_from_file(path)

    def _drop_cutlist_file(self, event): self.load_cutlist_from_file(event.data)

    def browse_offcut_file(self):
        path = filedialog.askopenfilename(title="選擇現有餘料清單 .txt 檔案", filetypes=[("Text Files", "*.txt"), ("All Files", "*.*")])
        if path: self.load_offcuts_from_file(path)

    def _drop_offcut_file(self, event): self.load_offcuts_from_file(event.data)

    def run_solver_thread(self):
        if not self.input_data:
            messagebox.showwarning("警告", "清單是空的，請先輸入裁切需求！")
            return

        try:
            capacity = int(self.entry_capacity.get())
            threshold = int(self.entry_threshold.get())
        except ValueError:
            messagebox.showwarning("輸入錯誤", "新料標準長度和死亡碎料閾值必須是整數！")
            return

        if capacity <= 0:
            messagebox.showwarning("輸入錯誤", "新料標準長度必須大於 0！")
            return
        if threshold < 0:
            messagebox.showwarning("輸入錯誤", "死亡碎料閾值不可小於 0！")
            return

        data = deepcopy(self.input_data)
        offcut_bins = list(self.offcut_data)
        max_stock_length = max([capacity] + offcut_bins)
        oversized = sorted({length for length, _ in data if length > max_stock_length}, reverse=True)
        if oversized:
            messagebox.showwarning(
                "無法排版",
                "以下裁切長度大於所有可用新料/餘料長度，無法排版：\n" + ", ".join(map(str, oversized))
            )
            return

        output_path = filedialog.asksaveasfilename(
            defaultextension=".xlsx",
            filetypes=[("Excel Files", "*.xlsx")],
            title="儲存優化報告",
            initialfile="cutting_stock_result_global_hybrid.xlsx"
        )
        if not output_path:
            self.log("⚠️ 使用者取消儲存。")
            return

        self.set_running_state(True)
        self.text_log.config(state="normal")
        self.text_log.delete(1.0, tk.END)
        self.text_log.config(state="disabled")
        threading.Thread(
            target=self.solve_and_export,
            args=(data, offcut_bins, capacity, threshold, output_path),
            daemon=True
        ).start()

    def solve_and_export(self, data, offcut_bins, capacity, threshold, output_path):
        try:
            self.log("⚙️ 啟動工業級全局混合優化引擎...")
            items = expand_data(data)
            self.log(f"   總追蹤裁切件數: {len(items)}, 總長度: {sum(items)}")

            self.log("⚙️ 深度運算中 (正在打破隔閡互相調度物件)...")
            used_offcuts, bins_opt, rem_opt, bins_bfd, rem_bfd, moves, swaps = solve_global_optimization(
                items, capacity, threshold, offcut_bins
            )

            self.log(f"✅ 全局優化完畢！系統執行了 {moves} 次跨料搬移與 {swaps} 次精準適應度互換。")
            self.log(f"   新有料卷動用: {len(bins_opt)} 卷")

            self.log("\n💾 正在生成並匯出 Excel 視覺化報告...")
            export_excel(bins_bfd, rem_bfd, bins_opt, rem_opt, data, items, capacity, threshold, output_path, used_offcuts=used_offcuts)
            self.log(f"✅ 成功！報告已儲存至:\n   {output_path}")
            self.show_info("完成", f"全局混合優化完成！\nExcel 已匯出至：\n{output_path}")

        except Exception as e:
            self.log(f"❌ 發生錯誤: {str(e)}")
            self.show_error("錯誤", f"發生未預期錯誤:\n{str(e)}")
        finally:
            self.root.after(0, self.set_running_state, False)

    # --- Improved order import, validation and execution flow ---

    def _integer_from_value(self, value):
        if isinstance(value, bool) or value is None:
            return None
        if isinstance(value, (int, float)):
            integer = int(value)
            return integer if integer == value and integer > 0 else None
        text_value = str(value).strip()
        if re.fullmatch(r"\d{1,3}(?:,\d{3})+", text_value):
            return int(text_value.replace(",", ""))
        if re.fullmatch(r"\d+", text_value):
            return int(text_value)
        return None

    def _numbers_from_text(self, value):
        direct = self._integer_from_value(value)
        if direct is not None:
            return [direct]
        return [int(match.replace(",", "")) for match in re.findall(r"\d+(?:,\d{3})*", str(value))]

    def _read_source_rows(self, path):
        source = Path(path.strip().strip("{}"))
        suffix = source.suffix.lower()
        if suffix == ".xlsx":
            workbook = load_workbook(source, read_only=True, data_only=True)
            try:
                return [list(row) for row in workbook.active.iter_rows(values_only=True)]
            finally:
                workbook.close()
        if suffix == ".csv":
            with source.open("r", encoding="utf-8-sig", newline="") as file_handle:
                return list(csv.reader(file_handle))
        if suffix == ".txt":
            with source.open("r", encoding="utf-8-sig") as file_handle:
                return [[line.strip()] for line in file_handle if line.strip()]
        raise ValueError("只支援 .txt、.csv 或 .xlsx 檔案。")

    def _parse_order_rows(self, rows):
        parsed, skipped = [], 0
        for row in rows:
            cells = [cell for cell in row if cell not in (None, "")]
            if not cells:
                continue
            length = quantity = None
            if len(cells) >= 2:
                length = self._integer_from_value(cells[0])
                quantity = self._integer_from_value(cells[1])
            else:
                text_value = str(cells[0]).strip()
                multiplied = re.fullmatch(r"(.+?)\s*(?:x|X|×|\*)\s*(.+)", text_value)
                if multiplied:
                    length = self._integer_from_value(multiplied.group(1))
                    quantity = self._integer_from_value(multiplied.group(2))
                else:
                    numbers = self._numbers_from_text(text_value)
                    if len(numbers) == 1:
                        length, quantity = numbers[0], 1
                    elif len(numbers) >= 2:
                        length, quantity = numbers[0], numbers[1]
            if length and quantity:
                parsed.append((length, quantity))
            else:
                skipped += 1
        return parsed, skipped

    def _parse_offcut_rows(self, rows):
        parsed, skipped = [], 0
        for row in rows:
            cells = [cell for cell in row if cell not in (None, "")]
            if not cells:
                continue
            values = self._numbers_from_text(cells[0]) if len(cells) == 1 else [self._integer_from_value(cells[0])]
            values = [value for value in values if value]
            if values:
                parsed.extend(values)
            else:
                skipped += 1
        return parsed, skipped

    def _merge_orders(self, additions):
        quantities = Counter()
        for length, quantity in self.input_data + additions:
            quantities[length] += quantity
        self.input_data = sorted(quantities.items(), key=lambda item: item[0], reverse=True)
        self.update_treeview()

    def add_item(self):
        try:
            length = int(self.entry_len.get().strip())
            quantity = int(self.entry_qty.get().strip())
            if length <= 0 or quantity <= 0:
                raise ValueError
        except ValueError:
            messagebox.showwarning("輸入錯誤", "長度和數量必須是大於 0 的整數。")
            return
        self._merge_orders([(length, quantity)])
        self.entry_len.delete(0, tk.END)
        self.entry_qty.delete(0, tk.END)
        self.entry_len.focus()

    def update_offcut_label(self):
        if not self.offcut_data:
            self.offcut_label_var.set("（尚無餘料）")
            return
        counts = Counter(self.offcut_data)
        preview = "、".join(f"{length} × {quantity}" for length, quantity in sorted(counts.items(), reverse=True)[:6])
        overflow = " …" if len(counts) > 6 else ""
        self.offcut_label_var.set(
            f"庫存 {len(self.offcut_data)} 段／總長 {sum(self.offcut_data):,}：{preview}{overflow}"
        )

    def load_cutlist_from_file(self, path):
        try:
            entries, skipped = self._parse_order_rows(self._read_source_rows(path))
        except Exception as error:
            messagebox.showerror("讀取失敗", f"無法讀取訂單檔案：\n{error}")
            return
        if not entries:
            messagebox.showwarning("沒有可用資料", "找不到有效的長度／數量資料。")
            return
        self._merge_orders(entries)
        self.dnd_cutlist.config(bg="#D6FFD6")
        self.root.after(800, lambda: self.dnd_cutlist.config(bg="#EEF4FB"))
        summary = Counter()
        for length, quantity in entries:
            summary[length] += quantity
        skip_message = f"\n略過 {skipped} 行無法辨識的資料。" if skipped else ""
        messagebox.showinfo(
            "匯入成功",
            f"已匯入 {len(summary)} 種長度、共 {sum(summary.values()):,} 件訂單。{skip_message}",
        )

    def load_offcuts_from_file(self, path):
        try:
            entries, skipped = self._parse_offcut_rows(self._read_source_rows(path))
        except Exception as error:
            messagebox.showerror("讀取失敗", f"無法讀取餘料檔案：\n{error}")
            return
        if not entries:
            messagebox.showwarning("沒有可用資料", "找不到有效的餘料長度。")
            return
        self.offcut_data.extend(entries)
        self.update_offcut_label()
        self.dnd_offcut.config(bg="#E8F5E9")
        self.root.after(800, lambda: self.dnd_offcut.config(bg="#F4F8F5"))
        skip_message = f"\n略過 {skipped} 行無法辨識的資料。" if skipped else ""
        messagebox.showinfo("匯入成功", f"已匯入 {len(entries):,} 段餘料。{skip_message}")

    def browse_cutlist_file(self):
        path = filedialog.askopenfilename(
            title="選擇訂單檔案",
            filetypes=[("Order files", "*.txt *.csv *.xlsx"), ("All Files", "*.*")],
        )
        if path:
            self.load_cutlist_from_file(path)

    def browse_offcut_file(self):
        path = filedialog.askopenfilename(
            title="選擇餘料檔案",
            filetypes=[("Inventory files", "*.txt *.csv *.xlsx"), ("All Files", "*.*")],
        )
        if path:
            self.load_offcuts_from_file(path)

    def run_solver_thread(self):
        if not self.input_data:
            messagebox.showwarning("訂單清單是空的", "請先輸入或匯入客戶訂單。")
            return
        try:
            capacity = int(self.entry_capacity.get())
            threshold = int(self.entry_threshold.get())
            if capacity <= 0 or threshold < 0:
                raise ValueError
        except ValueError:
            messagebox.showwarning("輸入錯誤", "新卷長度須大於 0；可回收門檻不可小於 0。")
            return

        data = deepcopy(self.input_data)
        offcut_bins = list(self.offcut_data)
        max_stock_length = max([capacity] + offcut_bins)
        oversized = sorted(
            {length for length, _ in data if _piece_cost(length) > max_stock_length},
            reverse=True,
        )
        if oversized:
            messagebox.showwarning(
                "無法排料",
                "以下長度超過所有可用原料／餘料長度：\n"
                + ", ".join(map(str, oversized)),
            )
            return

        output_path = filedialog.asksaveasfilename(
            defaultextension=".xlsx",
            filetypes=[("Excel Files", "*.xlsx")],
            title="儲存優化報告",
            initialfile="cutting_stock_result_optimized.xlsx",
        )
        if not output_path:
            self.log("⚠️ 使用者取消儲存。")
            return
        self.set_running_state(True)
        self.text_log.config(state="normal")
        self.text_log.delete(1.0, tk.END)
        self.text_log.config(state="disabled")
        threading.Thread(
            target=self.solve_and_export,
            args=(data, offcut_bins, capacity, threshold, output_path),
            daemon=True,
        ).start()

    def solve_and_export(self, data, offcut_bins, capacity, threshold, output_path):
        try:
            items = expand_data(data)
            self.log("⚙️ 開始以「最少新卷 → 最少碎料 → 優先用餘料」排料…")
            self.log(f"   訂單：{len(items):,} 件／總長 {sum(items):,}")
            used_offcuts, bins_opt, rem_opt, bins_bfd, rem_bfd, moves, swaps = solve_global_optimization(
                items, capacity, threshold, offcut_bins
            )
            active_offcuts = [offcut for offcut in used_offcuts if offcut["items"]]
            dead_scrap = sum(
                remainder for remainder in rem_opt if 0 < remainder < threshold
            ) + sum(
                offcut["rem"] for offcut in active_offcuts if 0 < offcut["rem"] < threshold
            )
            self.log(f"✅ 最佳化完成：需開新卷 {len(bins_opt)} 卷；使用既有餘料 {len(active_offcuts)} 段。")
            self.log(f"   不可回收碎料：{dead_scrap:,}；改善步驟：移動／減卷 {moves} 次、交換 {swaps} 次。")
            self.log("💾 正在產生含摘要、裁切明細與視覺圖解的 Excel 報告…")
            export_excel(
                bins_bfd, rem_bfd, bins_opt, rem_opt, data, items, capacity,
                threshold, output_path, used_offcuts=used_offcuts,
            )
            self.log(f"✅ 報告已儲存：{output_path}")
            self.show_info(
                "完成",
                f"排料完成。\n需開新卷：{len(bins_opt)} 卷\n不可回收碎料：{dead_scrap:,}\n\n報告：\n{output_path}",
            )
        except Exception as error:
            self.log(f"❌ 發生錯誤：{error}")
            self.show_error("錯誤", f"排料或匯出失敗：\n{error}")
        finally:
            self.root.after(0, self.set_running_state, False)


def export_excel(bins_bfd, rem_bfd, bins_opt, rem_opt, data, items, capacity, threshold, output_path, used_offcuts=None):
    """Export the plan with summary, cutting details and visual layouts."""
    workbook = Workbook()
    write_summary_sheet(
        workbook.active, bins_bfd, rem_bfd, bins_opt, rem_opt, data, items,
        capacity, threshold, used_offcuts,
    )
    if used_offcuts:
        write_offcut_sheet(workbook.create_sheet(), used_offcuts, threshold)
    if bins_opt:
        write_detail_sheet(workbook.create_sheet(), bins_opt, rem_opt, "最佳化新卷排料", threshold)
    if bins_bfd:
        write_detail_sheet(workbook.create_sheet(), bins_bfd, rem_bfd, "不使用餘料的對照", threshold)
    if bins_opt or used_offcuts:
        write_diagram_sheet(workbook.create_sheet(), used_offcuts, bins_opt, rem_opt, capacity)
    write_input_sheet(workbook.create_sheet(), data)
    workbook.save(output_path)


if __name__ == "__main__":
    root = TkinterDnD.Tk() if _DND_AVAILABLE else tk.Tk()
    app = CuttingStockApp(root)
    root.mainloop()
