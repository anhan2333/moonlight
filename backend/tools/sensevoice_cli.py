#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SenseVoice 本地转写 CLI(旁边装,离线跑,不吃 API 额度)。
用法: python3 sensevoice_cli.py <audio_path> [mime]
stdout = 转写文本。兼容 relay 的 RELAY_VOICE_TRANSCRIBE_CMD 约定(<path> <mime>)。
"""
import sys, os, wave, subprocess, tempfile, time

AUDIO = sys.argv[1] if len(sys.argv) > 1 else ""
if not AUDIO or not os.path.exists(AUDIO):
    print("", end="")
    sys.exit(0)

# 1) 任意格式(webm/opus/mp3/m4a) → 16k 单声道 wav
tmp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
tmp_wav.close()
try:
    r = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", AUDIO, "-ac", "1", "-ar", "16000", tmp_wav.name],
        capture_output=True, timeout=30)
    if r.returncode != 0 or os.path.getsize(tmp_wav.name) < 100:
        print("", end="")
        sys.exit(0)
except Exception:
    print("", end="")
    sys.exit(0)

# 2) sherpa-onnx SenseVoice 推理(传 int8 模型文件即 int8;1.13.x 无 use_int8 参数)
try:
    import sherpa_onnx
    import numpy as np
except Exception as e:
    print(f"[sensevoice_cli] import failed: {e}", file=sys.stderr)
    os.unlink(tmp_wav.name)
    print("", end="")
    sys.exit(0)

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models",
                    "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
try:
    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=os.path.join(BASE, "model.int8.onnx"),
        tokens=os.path.join(BASE, "tokens.txt"),
    )
except Exception as e:
    print(f"[sensevoice_cli] load failed: {e}", file=sys.stderr)
    os.unlink(tmp_wav.name)
    print("", end="")
    sys.exit(0)

with wave.open(tmp_wav.name, "rb") as w:
    assert w.getnchannels() == 1 and w.getsampwidth() == 2
    samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
os.unlink(tmp_wav.name)

try:
    stream = recognizer.create_stream()
    stream.accept_waveform(16000, samples)
    recognizer.decode_stream(stream)
    print(stream.result.text.strip(), end="")
except Exception as e:
    print(f"[sensevoice_cli] decode failed: {e}", file=sys.stderr)
    print("", end="")
