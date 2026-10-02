# -*- coding: utf-8 -*-
"""视觉模型三兜底：DeepSeek-VL → Qwen-VL → 本地 Qwen3-Omni。

顾川 PaiVoice 策略：单家 12s 超时、整轮 25s 超时就丢这一帧，永远不卡下一帧。
任何 OpenAI 兼容接口都能接。
"""
import os
import json
import base64
import asyncio
import time
from typing import Optional

# 三家视觉模型配置（按优先级）
VISION_CHAIN = [
    # 第一棒：千问 qwen-vl-plus（实测 0.8s，最快最稳，用现有 DASHSCOPE key）
    {
        "name": "qwen-vl",
        "base": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "key_env": "DASHSCOPE_API_KEY",
        "model": "qwen-vl-plus",
        "timeout": 12.0,
    },
    # 第二棒：DeepSeek（官方 2026 只有 deepseek-flash/deepseek-v4-pro/deepseek-chat 三个名字，
    # 实测只有 deepseek-chat 收图；flash/v4-pro 返回空内容）
    {
        "name": "deepseek-vl",
        "base": "https://api.deepseek.com/v1",
        "key_env": "DEEPSEEK_API_KEY",
        "model": "deepseek-chat",
        "timeout": 12.0,
    },
    {
        "name": "local-qwen",
        "base": "http://127.0.0.1:11434/v1",  # 本地 Ollama / vLLM，没跑就跳过
        "key_env": None,                       # 本地不需要 key
        "model": "qwen2-vl",
        "timeout": 8.0,
    },
]

TOTAL_TIMEOUT = 25.0   # 整轮超时

PV_VISION_PROMPT = (
    "这是视频通话时从对方摄像头里抽的一帧。用中文、两句话以内描述你看到的："
    "对方在哪、在做什么、表情和状态、有没有值得一提的细节。"
    "只描述，不评价，不打招呼，不加前缀。"
)


class VisionChain:
    """按顺序尝试三家，任何一家出结果就返回；都失败返回 None。"""

    def __init__(self):
        env = dict(os.environ)
        # systemd 环境（EnvironmentFile）没带进来的场景：手动从 relay.env 补
        if "DASHSCOPE_API_KEY" not in env:
            try:
                for line in open("/home/weiwei/services/moonlight/backend/relay.env", encoding="utf-8"):
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env.setdefault(k, v)
            except Exception:
                pass
        self.backends = []
        for cfg in VISION_CHAIN:
            key = env.get(cfg["key_env"]) if cfg["key_env"] else ""
            if cfg["name"].startswith("local"):
                # 本地模型只在端口能连通时启用
                if self._probe_local(cfg["base"]):
                    self.backends.append({**cfg, "key": "ollama"})
            elif key:
                self.backends.append({**cfg, "key": key})

    @staticmethod
    def _probe_local(base: str) -> bool:
        try:
            import urllib.request
            urllib.request.urlopen(base.rstrip("/") + "/models", timeout=1)
            return True
        except Exception:
            return False

    async def _try_one(self, backend: dict, jpeg_b64: str, prompt: str) -> Optional[str]:
        import httpx
        body = {
            "model": backend["model"],
            "max_tokens": 200,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{jpeg_b64}"}},
                ],
            }],
        }
        headers = {"Authorization": f"Bearer {backend['key']}"}
        try:
            async with httpx.AsyncClient(timeout=backend["timeout"]) as cli:
                r = await cli.post(backend["base"].rstrip("/") + "/chat/completions",
                                   json=body, headers=headers)
                r.raise_for_status()
                return (r.json().get("choices") or [{}])[0].get("message", {}).get("content") or None
        except Exception:
            return None

    async def describe(self, jpeg: bytes, prompt: Optional[str] = None) -> Optional[str]:
        if not self.backends:
            return None
        b64 = base64.b64encode(jpeg).decode("ascii")
        prompt = prompt or PV_VISION_PROMPT
        deadline = time.monotonic() + TOTAL_TIMEOUT
        for backend in self.backends:
            remain = deadline - time.monotonic()
            if remain <= 0:
                break
            try:
                result = await asyncio.wait_for(
                    self._try_one(backend, b64, prompt),
                    timeout=min(backend["timeout"], remain),
                )
                if result:
                    return result
            except asyncio.TimeoutError:
                continue
        return None


# 单例
_chain: Optional[VisionChain] = None

def get_vision_chain() -> VisionChain:
    global _chain
    if _chain is None:
        _chain = VisionChain()
    return _chain
