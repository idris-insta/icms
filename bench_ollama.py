#!/usr/bin/env python3
"""Measure real generation speed for the models installed in Ollama.

Reports tokens/sec from Ollama's own counters, so the numbers are comparable
across models regardless of how long the answer happens to be.

    python3 bench_ollama.py                  # all installed models
    python3 bench_ollama.py llama3.2:3b      # specific model(s)
"""
import json, sys, time
import urllib.request as U, urllib.error

HOST = "http://localhost:11434"
# Mirrors what /api/agent/ask does: a short factual answer over small context.
PROMPT = "You are a logistics assistant. Answer in one short sentence: there are 4 import orders in the system. How many import orders are there?"

def post(path, payload, timeout=900):
    req = U.Request(HOST + path, data=json.dumps(payload).encode(),
                    headers={"Content-Type": "application/json"}, method="POST")
    return json.load(U.urlopen(req, timeout=timeout))

def models():
    return [m["name"] for m in json.load(U.urlopen(HOST + "/api/tags", timeout=30))["models"]]

def bench(name, think=None):
    payload = {"model": name, "stream": False,
               "messages": [{"role": "user", "content": PROMPT}]}
    if think is not None:
        payload["think"] = think          # qwen3 and other reasoning models
    t0 = time.time()
    try:
        d = post("/api/chat", payload)
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.read().decode()[:120]}"}
    except Exception as e:
        return {"error": str(e)[:160]}
    wall = time.time() - t0

    eval_count = d.get("eval_count") or 0
    eval_ns = d.get("eval_duration") or 0
    load_ns = d.get("load_duration") or 0
    prompt_n = d.get("prompt_eval_count") or 0
    tps = (eval_count / (eval_ns / 1e9)) if eval_ns else 0
    content = (d.get("message") or {}).get("content", "")
    thinking = (d.get("message") or {}).get("thinking") or ""
    return {
        "wall_s": round(wall, 1),
        "load_s": round(load_ns / 1e9, 1),
        "prompt_tokens": prompt_n,
        "gen_tokens": eval_count,
        "tok_per_s": round(tps, 1),
        "thinking_chars": len(thinking),
        "answer": content.strip().replace("\n", " ")[:110],
    }

if "--big" in sys.argv:
    sys.argv.remove("--big")
    # Approximates what /api/agent/ask really sends: a system prompt plus a
    # summary of suppliers, orders and balances. Prompt processing is not free on
    # CPU, so short-prompt benchmarks flatter the model.
    ctx = "\n".join(
        f"PO ISLB {i:05d} | supplier BONDTAPE | 40HC | status Draft | "
        f"value USD {39776 + i} | eta 2026-0{(i % 9) + 1}-15 | freight 3200 | duty 12%"
        for i in range(60))
    PROMPT = ("You are a logistics assistant for an import business. Using only the "
              "data below, answer in one short sentence.\n\nDATA:\n" + ctx +
              "\n\nQUESTION: How many orders are in Draft status?")

targets = sys.argv[1:] or models()
print(f"host: {HOST}")
print(f"prompt: {len(PROMPT)} chars\n")

rows = []
for name in targets:
    variants = [(name, None)]
    if "qwen3" in name:
        # qwen3 reasons by default, which multiplies generated tokens.
        variants = [(f"{name} (thinking on)", True), (f"{name} (thinking off)", False)]
    for label, think in variants:
        print(f"benchmarking {label} …", flush=True)
        r = bench(name, think)
        if "error" in r:
            print(f"   ERROR: {r['error']}\n")
            rows.append((label, r))
            continue
        print(f"   {r['wall_s']}s wall ({r['load_s']}s model load), "
              f"{r['gen_tokens']} tokens generated at {r['tok_per_s']} tok/s")
        if r["thinking_chars"]:
            print(f"   hidden reasoning: {r['thinking_chars']} chars")
        print(f"   answer: {r['answer']!r}\n")
        rows.append((label, r))

print("=" * 78)
print(f"{'model':<28} {'wall':>7} {'gen tok':>8} {'tok/s':>7}  answer ok")
print("-" * 78)
for label, r in rows:
    if "error" in r:
        print(f"{label:<28} {'—':>7} {'—':>8} {'—':>7}  ERROR")
    else:
        ok = "yes" if "4" in r["answer"] else "?"
        print(f"{label:<28} {r['wall_s']:>6.1f}s {r['gen_tokens']:>8} {r['tok_per_s']:>7.1f}  {ok}")
print("=" * 78)
print("\nUsable interactively: wall under ~15s. Tolerable: under ~40s.")
