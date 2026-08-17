#!/usr/bin/env python3
"""Dev-only TCP relay: exposes the host's loopback-bound Ollama on the Docker
bridge so the container can reach it.

Not needed on a real server — there you just run Ollama with
OLLAMA_HOST=0.0.0.0 and point OLLAMA_URL at host.docker.internal.

    python3 dev-ollama-relay.py &
"""
import socket, threading, sys

BIND = ("172.17.0.1", 11435)
TARGET = ("127.0.0.1", 11434)

def pipe(a, b):
    try:
        while True:
            data = a.recv(65536)
            if not data:
                break
            b.sendall(data)
    except OSError:
        pass
    finally:
        for s in (a, b):
            try: s.shutdown(socket.SHUT_RDWR)
            except OSError: pass

def handle(client):
    try:
        upstream = socket.create_connection(TARGET, timeout=10)
        # create_connection leaves the timeout on the socket, so a slow model
        # load (>10s with no bytes yet) would look like a read timeout and tear
        # the connection down mid-request. Relayed sockets must block instead.
        upstream.settimeout(None)
        client.settimeout(None)
    except OSError as e:
        client.close()
        print("upstream connect failed:", e, file=sys.stderr)
        return
    threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
    threading.Thread(target=pipe, args=(upstream, client), daemon=True).start()

srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(BIND)
srv.listen(64)
print(f"relay {BIND[0]}:{BIND[1]} -> {TARGET[0]}:{TARGET[1]}", flush=True)
while True:
    conn, _ = srv.accept()
    threading.Thread(target=handle, args=(conn,), daemon=True).start()
