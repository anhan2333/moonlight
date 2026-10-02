# -*- coding: utf-8 -*-
"""
schedule_system.py — 月光日程/闹铃 + 位置上下文 + chat_status（AionsHome 同款，轻量版）

  1. schedules 表：到点触发 → 组一条「系统触发文本」走现有大脑链路
     （loop/operit/desktop 任一），让安念带着记忆自然开口提醒，回复照常落聊天。
  2. AI 命令：安念回复里 [SCHEDULE:2026-09-14 08:00|提醒她吃药] 即创建日程，
     标签从气泡文本里剥掉（与 [TOY:x] 同款信号设计）。
  3. 位置：前端推浏览器定位 → 高德逆地理 → 最近一次位置+家距离注入 prompt。
  4. chat_status：即时哨兵判断出的「她当前状态」存 kv，随消息注入。
"""
from __future__ import annotations

import json
import math
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

SCHEDULE_SCAN_SEC = 30
SCHEDULE_CMD_RE = re.compile(r"\[\s*SCHEDULE\s*:\s*(?P<t1>[^\|\]]{4,32})\s*\|\s*(?P<c1>[^\]]{1,200})\s*\]|<\s*SCHEDULE\s*:\s*(?P<t2>[^>\|\n]{4,32})\s*\|\s*(?P<c2>[^>]{1,200})\s*>", re.I)
LOC_MAX_AGE_MIN = 90          # 位置超过 90 分钟视为过期不注入


# ── 表 ─────────────────────────────────────────────────────
def sched_init(db) -> None:
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time TEXT NOT NULL, content TEXT NOT NULL,
            enabled INTEGER DEFAULT 1, fired INTEGER DEFAULT 0,
            repeat TEXT DEFAULT 'once',
            created_at TEXT, fired_at TEXT DEFAULT '')""")
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(schedules)").fetchall()}
        if "repeat" not in cols:
            conn.execute("ALTER TABLE schedules ADD COLUMN repeat TEXT DEFAULT 'once'")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sched_due ON schedules(enabled,fired,time)")
        conn.commit()


def _sched_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def add_schedule(db, time_str: str, content: str, repeat: str = "once") -> dict:
    content = (content or "").strip()
    if not content:
        raise ValueError("内容不能为空")
    # 接受 "YYYY-MM-DD HH:MM" / ISO；统一存本地 naive 字符串便于扫描比对
    t = (time_str or "").strip().replace("T", " ")[:16]
    try:
        datetime.strptime(t, "%Y-%m-%d %H:%M")
    except ValueError:
        raise ValueError("时间格式应为 2026-09-14 08:00")
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO schedules(time,content,enabled,fired,repeat,created_at) VALUES(?,?,1,0,?,?)",
            (t, content, repeat if repeat in ("once", "daily", "weekly") else "once", _sched_now_iso()))
        conn.commit()
        sid = cur.lastrowid
    return {"id": sid, "time": t, "content": content, "repeat": repeat}


def list_schedules(db) -> list[dict]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM schedules ORDER BY fired ASC, time ASC LIMIT 200").fetchall()
    return [dict(r) for r in rows]


def toggle_schedule(db, sid: int, enabled: bool) -> bool:
    with db() as conn:
        cur = conn.execute("UPDATE schedules SET enabled=? WHERE id=?", (1 if enabled else 0, sid))
        conn.commit()
    return cur.rowcount > 0


def delete_schedule(db, sid: int) -> bool:
    with db() as conn:
        cur = conn.execute("DELETE FROM schedules WHERE id=?", (sid,))
        conn.commit()
    return cur.rowcount > 0


def due_schedules(db) -> list[dict]:
    """到期未触发（本地时间）。once 触发后标记；daily/weekly 滚动顺延。"""
    now_local = datetime.now().strftime("%Y-%m-%d %H:%M")
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM schedules WHERE enabled=1 AND fired=0 AND time<=? ORDER BY time ASC LIMIT 5",
            (now_local,)).fetchall()
    return [dict(r) for r in rows]


def mark_fired(db, item: dict) -> None:
    rep = item.get("repeat") or "once"
    with db() as conn:
        if rep == "once":
            conn.execute("UPDATE schedules SET fired=1, fired_at=? WHERE id=?", (_sched_now_iso(), item["id"]))
        else:
            # 顺延：daily +1天 / weekly +7天（从原定时间起算，错过太多则从当前起）
            try:
                base = datetime.strptime(item["time"], "%Y-%m-%d %H:%M")
                now = datetime.now()
                step = 1 if rep == "daily" else 7
                nxt = base
                while nxt <= now:
                    from datetime import timedelta
                    nxt = nxt + timedelta(days=step)
                conn.execute("UPDATE schedules SET time=?, fired=0, fired_at=? WHERE id=?",
                             (nxt.strftime("%Y-%m-%d %H:%M"), _sched_now_iso(), item["id"]))
            except Exception:
                conn.execute("UPDATE schedules SET fired=1 WHERE id=?", (item["id"],))
        conn.commit()


def build_trigger_text(item: dict, ai_name: str, human_name: str) -> str:
    return (
        f"（系统闹铃 · 非{human_name}发言）现在是约定的提醒时间。日程内容：{item['content']}"
        f"。请自然地开口提醒/关心{human_name}，一两句话，带上你记得的相关背景，不要提到本系统提示。"
    )


def parse_schedule_cmds(text: str) -> list[dict]:
    """从 AI 回复提取 [SCHEDULE:time|content]。"""
    out = []
    for m in SCHEDULE_CMD_RE.finditer(text or ""):
        t = (m.group("t1") or m.group("t2") or "").strip()
        ct = (m.group("c1") or m.group("c2") or "").strip()
        out.append({"time": t, "content": ct})
    return out


def strip_schedule_tags(text: str) -> str:
    return SCHEDULE_CMD_RE.sub("", text or "").strip()


# ── 位置（高德逆地理）─────────────────────────────────────
def _kv_get(conn, key, default=""):
    try:
        r = conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        return (r["value"] if r else None) or default
    except Exception:
        return default


def _kv_set(conn, key, value):
    conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                 (key, str(value)))


def amap_regeo(lng: float, lat: float, key: str) -> dict:
    """高德逆地理（GCJ-02 坐标）。失败返回 {}。"""
    if not key:
        return {}
    try:
        url = ("https://restapi.amap.com/v3/geocode/regeo?key=" + urllib.parse.quote(key)
               + "&location=%.6f,%.6f" % (lng, lat) + "&extensions=base")
        req = urllib.request.Request(url, headers={"User-Agent": "moonlight"})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode("utf-8", "ignore"))
        if str(data.get("status")) != "1":
            return {}
        regeo = data.get("regeocode") or {}
        comp = regeo.get("addressComponent") or {}
        return {
            "city": comp.get("city") or "",
            "district": comp.get("district") or "",
            "township": comp.get("township") or "" if isinstance(comp.get("township"), str) else "",
            "address": (regeo.get("formatted_address") or "").strip(),
            "adcode": comp.get("adcode") or "",
        }
    except Exception:
        return {}


def haversine_m(lng1, lat1, lng2, lat2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def save_location(db, lng: float, lat: float, accuracy: float = 0) -> dict:
    with db() as conn:
        key = _kv_get(conn, "loc_amap_key", "")
    place = amap_regeo(lng, lat, key) if key else {}
    with db() as conn:
        home_raw = _kv_get(conn, "loc_home", "")
        _kv_set(conn, "loc_last", json.dumps({
            "lng": lng, "lat": lat, "accuracy": accuracy, "place": place,
            "ts": time.time(), "iso": _sched_now_iso()}, ensure_ascii=False))
        conn.commit()
    dist = None
    if home_raw:
        try:
            h = json.loads(home_raw)
            dist = round(haversine_m(lng, lat, float(h["lng"]), float(h["lat"])), 0)
        except Exception:
            dist = None
    return {"place": place, "distance_home_m": dist}


def set_home(db) -> dict:
    with db() as conn:
        last = _kv_get(conn, "loc_last", "")
    if not last:
        raise ValueError("还没有定位数据，先让浏览器定位一次")
    d = json.loads(last)
    with db() as conn:
        _kv_set(conn, "loc_home", json.dumps({"lng": d["lng"], "lat": d["lat"], "place": d.get("place") or {}}))
        conn.commit()
    return {"ok": True}


def location_prompt_block(db) -> str:
    """给 AI 注入的【位置】块；过期/无数据返回空。"""
    with db() as conn:
        raw = _kv_get(conn, "loc_last", "")
        home = _kv_get(conn, "loc_home", "")
        enabled = _kv_get(conn, "loc_share", "0")
    if enabled != "1" or not raw:
        return ""
    try:
        d = json.loads(raw)
    except Exception:
        return ""
    if time.time() - float(d.get("ts") or 0) > LOC_MAX_AGE_MIN * 60:
        return ""
    place = d.get("place") or {}
    where = " ".join(x for x in (place.get("city"), place.get("district"), place.get("township")) if x) or "（未解析出地址）"
    lines = [f"她当前大致位置：{where}"]
    if home:
        try:
            h = json.loads(home)
            dist = haversine_m(float(d["lng"]), float(d["lat"]), float(h["lng"]), float(h["lat"]))
            lines.append("离家约 " + ("%.1f 公里" % (dist / 1000) if dist >= 1000 else "%d 米" % dist)
                         + ("（在家附近）" if dist <= 500 else "（在外面）"))
        except Exception:
            pass
    return "【位置】" + "；".join(lines)


def chat_status_block(db) -> str:
    with db() as conn:
        raw = _kv_get(conn, "mem_chat_status", "")
    if not raw:
        return ""
    try:
        d = json.loads(raw)
    except Exception:
        return ""
    if time.time() - float(d.get("ts") or 0) > 60 * 60:   # 1 小时内的状态才算数
        return ""
    s = str(d.get("status") or "").strip()
    return ("【她最近的状态】" + s) if s else ""


def save_chat_status(db, status: str) -> None:
    if not status:
        return
    with db() as conn:
        _kv_set(conn, "mem_chat_status", json.dumps({"status": status[:120], "ts": time.time()}, ensure_ascii=False))
        conn.commit()
