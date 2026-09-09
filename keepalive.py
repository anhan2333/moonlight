#!/usr/bin/env python3
# ═══ 月光保活守护（keepalive.py）═══
# 作用：每60秒自检 backend(3011) + api_loop(3020)，
#       死了自动拉起。防止proot休眠杀进程导致"连接不上"。
# 用法：nohup python3 keepalive.py > /tmp/moonlight/keepalive.log 2>&1 &
import subprocess, time, os, sys

MOON = "/tmp/moonlight"
LOG = "/tmp/moonlight/keepalive.log"

def log(msg):
    from datetime import datetime
    line = "[%s] %s" % (datetime.now().strftime("%m-%d %H:%M:%S"), msg)
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def alive(port):
    r = subprocess.run(
        ["curl", "-s", "--max-time", "4", "-o", "/dev/null", "-w", "%{http_code}",
         "http://127.0.0.1:%d/" % port],
        capture_output=True, text=True, timeout=8)
    code = r.stdout.strip()
    # 200/404/30x都算"进程活着"（404只是路由不存在）
    return code not in ("000", "")

def kill_backend():
    for p in subprocess.run(["ls", "/proc"], capture_output=True, text=True).stdout.split():
        if not p.isdigit():
            continue
        try:
            with open("/proc/%s/cmdline" % p, "rb") as f:
                cmd = f.read().decode("utf-8", "ignore")
            if "backend/app.py" in cmd and "keepalive" not in cmd:
                os.kill(int(p), 15)
                log("killed stale backend pid=%s" % p)
        except Exception:
            pass

def start_backend():
    kill_backend()
    env = dict(os.environ)
    with open(MOON + "/backend/relay.env") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k] = v
    subprocess.Popen(
        ["python3", MOON + "/backend/app.py"],
        env=env, cwd=MOON,
        stdout=open("/tmp/moonlight_backend.log", "ab"),
        stderr=subprocess.STDOUT)
    log("backend started")

def start_loop():
    env = dict(os.environ)
    with open(MOON + "/backend/relay.env") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k] = v
    subprocess.Popen(
        ["python3", MOON + "/examples/api_loop.py"],
        env=env, cwd=MOON + "/examples",
        stdout=open("/tmp/moonlight/api_loop.log", "ab"),
        stderr=subprocess.STDOUT)
    log("api_loop started")

def main():
    log("keepalive daemon started (60s interval)")
    while True:
        try:
            if not alive(3011):
                log("backend DOWN -> restarting")
                start_backend()
                time.sleep(6)
            if not alive(3020):
                log("api_loop DOWN -> restarting")
                start_loop()
                time.sleep(6)
        except Exception as e:
            log("keepalive error: %s" % e)
        time.sleep(60)

if __name__ == "__main__":
    main()