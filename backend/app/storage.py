import io
import os
import struct
from pathlib import Path
from typing import Optional
from sqlalchemy.orm import Session
from .models import Conversation, Message

RECORDINGS_DIR = (Path(__file__).resolve().parent.parent / "recordings").resolve()
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)


def pcm_to_wav_bytes(pcm_bytes: bytes, sample_rate: int = 24000, num_channels: int = 1, bits_per_sample: int = 16) -> bytes:
    """Prepend a standard 44-byte RIFF/WAVE header to raw linear PCM audio bytes."""
    byte_rate = sample_rate * num_channels * (bits_per_sample // 8)
    block_align = num_channels * (bits_per_sample // 8)
    data_length = len(pcm_bytes)

    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_length,
        b"WAVE",
        b"fmt ",
        16,               # Subchunk1Size for PCM
        1,                # AudioFormat 1 = PCM
        num_channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        data_length,
    )
    return header + pcm_bytes


def save_audio_file(
    client_id: int,
    conv_id: int,
    msg_id: int,
    role: str,
    audio_bytes: bytes,
    extension: str = "wav",
    duration_seconds: Optional[float] = None,
) -> tuple[str, float]:
    """Persists an audio file on disk under recordings/client_{id}/conv_{id}/ and returns (url, duration)."""
    folder = RECORDINGS_DIR / f"client_{client_id}" / f"conv_{conv_id}"
    folder.mkdir(parents=True, exist_ok=True)

    filename = f"msg_{msg_id}_{role}.{extension}"
    file_path = folder / filename

    with open(file_path, "wb") as f:
        f.write(audio_bytes)

    rel_url = f"/recordings/client_{client_id}/conv_{conv_id}/{filename}"

    if duration_seconds is None or duration_seconds <= 0:
        if extension.lower() == "wav" and len(audio_bytes) > 44:
            # Estimate from standard 24kHz 16-bit mono WAV
            duration_seconds = round((len(audio_bytes) - 44) / (24000 * 2), 2)
        elif extension.lower() == "mp3":
            # Estimate from 128kbps MP3
            duration_seconds = round(len(audio_bytes) / 16000, 2)
        else:
            duration_seconds = round(max(1.0, len(audio_bytes) / 16000), 2)

    return rel_url, round(duration_seconds, 2)


def save_pcm_as_wav(
    client_id: int,
    conv_id: int,
    msg_id: int,
    role: str,
    pcm_bytes: bytes,
    sample_rate: int = 24000,
) -> tuple[str, float]:
    """Wraps raw 16-bit PCM bytes into standard WAV and writes to disk."""
    wav_bytes = pcm_to_wav_bytes(pcm_bytes, sample_rate=sample_rate)
    duration = len(pcm_bytes) / (sample_rate * 2)
    return save_audio_file(
        client_id=client_id,
        conv_id=conv_id,
        msg_id=msg_id,
        role=role,
        audio_bytes=wav_bytes,
        extension="wav",
        duration_seconds=duration,
    )


def update_conversation_metadata(
    conv_id: int,
    db: Session,
    user_query: Optional[str] = None,
    channel: str = "voice_realtime",
):
    """Automatically generates an intent-based title and updates duration and timestamps."""
    conv = db.get(Conversation, conv_id)
    if not conv:
        return

    # 1. Update channel
    if channel:
        conv.channel = channel

    # 2. Update title if it's default
    if user_query and (not conv.title or conv.title == "Voice Conversation"):
        clean_q = user_query.strip().strip(".,!?;:\"'")
        # Generate a clean, executive-ready 4-8 word title
        if len(clean_q) > 60:
            title = clean_q[:57].rsplit(" ", 1)[0] + "…"
        else:
            title = clean_q
        conv.title = title

    # 3. Calculate total conversation duration from messages
    messages = db.query(Message).filter(Message.conversation_id == conv_id).all()
    total_sec = sum(m.audio_duration or 0.0 for m in messages)
    conv.duration_seconds = int(total_sec)

    # 4. Generate or update summary if multiple messages exist
    if len(messages) >= 2:
        user_msgs = [m.text for m in messages if m.role == "user"]
        ai_msgs = [m.text for m in messages if m.role == "assistant"]
        if user_msgs and ai_msgs:
            first_user = user_msgs[0]
            first_ai = ai_msgs[0]
            conv.summary = f"Inquiry: {first_user[:120]}. Decision rendered: {first_ai[:240]}."

    db.commit()


def get_concatenated_call_audio(client_id: int, conv_id: int, db: Session) -> tuple[bytes, str]:
    """Combines all WAV audio segments of a conversation into a single continuous WAV file."""
    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conv_id)
        .order_by(Message.id.asc())
        .all()
    )

    combined_pcm = io.BytesIO()
    silence_half_sec = b"\x00\x00" * 12000 # 0.5s pause between speaker turns at 24kHz

    has_audio = False

    for m in messages:
        if not m.audio_url:
            continue
        rel = m.audio_url.replace("/recordings/", "").lstrip("/")
        local_path = RECORDINGS_DIR / rel
        if not local_path.exists():
            local_path = Path("backend") / m.audio_url.lstrip("/")
        if not local_path.exists():
            local_path = Path(m.audio_url.lstrip("/"))
        if local_path.exists():
            with open(local_path, "rb") as af:
                file_bytes = af.read()
                # If WAV, strip the 44-byte header to get raw PCM
                if local_path.suffix.lower() == ".wav" and len(file_bytes) > 44:
                    raw_pcm = file_bytes[44:]
                    combined_pcm.write(raw_pcm)
                    combined_pcm.write(silence_half_sec)
                    has_audio = True

    if not has_audio or combined_pcm.tell() == 0:
        # Generate 1s empty audio
        empty_wav = pcm_to_wav_bytes(b"\x00\x00" * 24000, sample_rate=24000)
        return empty_wav, f"conversation_{conv_id}_full.wav"

    full_wav = pcm_to_wav_bytes(combined_pcm.getvalue(), sample_rate=24000)
    return full_wav, f"conversation_{conv_id}_call_recording.wav"
