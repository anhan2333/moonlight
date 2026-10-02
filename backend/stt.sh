#!/usr/bin/env bash
# 本地 faster-whisper ASR（端口 3021）。输入任意音频文件路径，输出转写文本到 stdout。
set -e
F="$1"
curl -s -m 120 -X POST -F "file=@$F" http://127.0.0.1:3021/asr \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('text',''))"
