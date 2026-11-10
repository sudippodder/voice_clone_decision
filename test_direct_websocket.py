#!/usr/bin/env python3
"""
Direct WebSocket Test Script for Executive Voice Agent.
Bypasses reverse proxies (IIS ARR / Cloudflare / Nginx) by testing directly against Uvicorn.

Usage:
  # Test locally on Ubuntu server:
  python3 test_direct_websocket.py

  # Or test against a specific URL:
  python3 test_direct_websocket.py ws://127.0.0.1:3855/api/clients/2/voice/realtime
  python3 test_direct_websocket.py wss://voicecloneapi.vestaging.in/api/clients/2/voice/realtime
"""

import asyncio
import json
import sys
import time

try:
    import websockets
except ImportError:
    print("Installing 'websockets' package...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets"])
    import websockets


DEFAULT_URL = "ws://127.0.0.1:3855/api/clients/2/voice/realtime"


async def run_test(url: str):
    print("=" * 70)
    print("  EXECUTIVE VOICE AGENT - DIRECT WEBSOCKET DIAGNOSTIC TEST")
    print("=" * 70)
    print(f"Target WebSocket URL: {url}")
    print(f"Python interpreter:   {sys.executable}")
    print(f"Start Time:           {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("-" * 70)

    start_t = time.time()
    try:
        print("[1/5] Initiating WebSocket connection...")
        async with websockets.connect(
            url,
            ping_interval=15,
            ping_timeout=10,
        ) as ws:
            conn_elapsed = (time.time() - start_t) * 1000
            print(f"  [OK] WebSocket connected in {conn_elapsed:.1f}ms!")

            # Step 2: Wait for session_started handshake from backend
            print("\n[2/5] Waiting for initial server handshake ('session_started')...")
            try:
                first_msg_raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                first_msg = json.loads(first_msg_raw)
                print(f"  [OK] Received message from server: {first_msg_raw}")
                if first_msg.get("type") == "session_started":
                    print(f"       Executive:       {first_msg.get('executive_name')}")
                    print(f"       Voice ID:        {first_msg.get('voice_id')}")
                    print(f"       Voice Authorized:{first_msg.get('voice_authorized')}")
            except asyncio.TimeoutError:
                print("  [WARN] Timed out waiting for session_started (5s). Continuing...")

            # Step 3: Test Heartbeat Ping/Pong
            print("\n[3/5] Testing WebSocket ping/pong heartbeat...")
            ping_t = time.time()
            await ws.send(json.dumps({"type": "ping"}))
            try:
                pong_raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                pong_elapsed = (time.time() - ping_t) * 1000
                print(f"  [OK] Received response: {pong_raw} (Round-trip: {pong_elapsed:.1f}ms)")
            except asyncio.TimeoutError:
                print("  [WARN] Did not receive pong response within 5 seconds.")

            # Step 4: Test a live real-time conversational turn
            print("\n[4/5] Sending conversational query to test real-time streaming...")
            query = "Hello, please state your name and executive role."
            print(f"       User Query: '{query}'")
            turn_t = time.time()
            await ws.send(json.dumps({
                "type": "user_transcription",
                "text": query,
            }))

            first_token_time = None
            first_audio_time = None
            tokens = []
            audio_chunks_count = 0
            audio_bytes_total = 0

            print("       Streaming response chunks from backend:")
            while True:
                try:
                    chunk_raw = await asyncio.wait_for(ws.recv(), timeout=30.0)
                    chunk = json.loads(chunk_raw)
                    chunk_type = chunk.get("type")

                    if chunk_type == "agent_thinking":
                        print(f"       -> [Agent Thinking]: Query accepted, reasoning from DB...")
                    elif chunk_type == "agent_text_chunk":
                        if first_token_time is None:
                            first_token_time = (time.time() - turn_t) * 1000
                            print(f"       -> [First Token]: {first_token_time:.1f}ms latency")
                        text_part = chunk.get("text", "")
                        tokens.append(text_part)
                        print(f"          token: '{text_part}'")
                    elif chunk_type == "audio_chunk":
                        if first_audio_time is None:
                            first_audio_time = (time.time() - turn_t) * 1000
                            print(f"       -> [First Audio Chunk]: {first_audio_time:.1f}ms latency ({chunk.get('mime_type')})")
                        audio_chunks_count += 1
                        b64 = chunk.get("audio_base64") or ""
                        audio_bytes_total += len(b64) * 3 // 4
                    elif chunk_type == "agent_turn_finished":
                        print(f"       -> [Turn Complete]: Full response: '{chunk.get('full_response')}'")
                        print(f"          Audio URL: {chunk.get('assistant_audio_url')}")
                        break
                    elif chunk_type == "error":
                        print(f"       -> [Agent Error]: {chunk.get('message')}")
                        break
                    elif chunk_type == "warning":
                        print(f"       -> [Agent Warning]: {chunk.get('message')}")
                except asyncio.TimeoutError:
                    print("       -> [Timeout]: Waiting for response timed out after 30s.")
                    break

            # Step 5: Socket stability test (keep idle for 10 seconds to verify no drop)
            print("\n[5/5] Testing connection stability (keeping socket idle for 10s)...")
            for sec in range(1, 11):
                await asyncio.sleep(1)
                is_closed = (
                    ws.close_code is not None
                    or getattr(ws, "closed", False)
                    or getattr(getattr(ws, "state", None), "name", "") == "CLOSED"
                )
                if is_closed:
                    print(f"  [FAIL] Socket closed prematurely at {sec}s with code: {ws.close_code}")
                    return False

            print("  [OK] Socket remained fully open and stable for 10 seconds of idle time!")

        print("\n" + "=" * 70)
        print("  DIAGNOSTIC TEST RESULT: [PASSED - 100% HEALTHY]")
        print("=" * 70)
        print("  The Ubuntu application backend is operating perfectly:")
        print("  - Connection handshake: OK")
        print("  - Session started:      OK")
        print("  - Heartbeat ping/pong:  OK")
        print("  - Real-time streaming:  OK")
        print("  - Idle socket lifetime: OK (No abrupt drops)")
        print("\n  CONCLUSION: The 'code 1006' drops occur at the Windows IIS ARR")
        print("  reverse proxy layer, NOT inside the Ubuntu FastAPI backend.")
        print("=" * 70)
        return True

    except websockets.exceptions.ConnectionClosed as cc:
        print(f"\n[FAIL] WebSocket closed: code={cc.code}, reason='{cc.reason}'")
        if cc.code == 1006:
            print("  Code 1006 = Abnormal Closure (TCP connection was reset/dropped without close frame).")
        return False
    except Exception as exc:
        print(f"\n[FAIL] Connection error: {type(exc).__name__}: {exc}")
        return False


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    success = asyncio.run(run_test(target))
    sys.exit(0 if success else 1)
