"""Мягкий перезвон для уведомлений на телефоне: те же ноты До и Ми, что и в src/chime.ts.

Пересобрать звук: python scripts/chime.py
Результат — src-tauri/plugins/lessons/android/src/main/res/raw/tc_chime.wav
"""

import math
import struct
import wave
from pathlib import Path

RATE = 22050
LENGTH = 1.3
OUT = Path(__file__).resolve().parent.parent / (
    "src-tauri/plugins/lessons/android/src/main/res/raw/tc_chime.wav"
)

# (частота, начало, громкость, затухание): C5, затем E5 чуть громче — как в приложении.
NOTES = [(523.25, 0.0, 0.32, 3.2), (659.25, 0.16, 0.38, 2.6)]


def sample(t: float) -> float:
    value = 0.0
    for freq, start, volume, decay in NOTES:
        local = t - start
        if local < 0:
            continue
        attack = min(1.0, local / 0.02)  # без щелчка в начале
        envelope = volume * attack * math.exp(-decay * local)
        # Немного второй гармоники — звучит как колокольчик, а не как писк.
        tone = math.sin(2 * math.pi * freq * local) + 0.18 * math.sin(4 * math.pi * freq * local)
        value += envelope * tone
    fade = min(1.0, (LENGTH - t) / 0.15)  # мягкий конец без обрыва
    return value * max(0.0, fade)


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames = b"".join(
        struct.pack("<h", int(max(-1.0, min(1.0, sample(i / RATE))) * 32767))
        for i in range(int(RATE * LENGTH))
    )
    with wave.open(str(OUT), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(frames)
    print(f"{OUT} — {OUT.stat().st_size // 1024} КБ")


if __name__ == "__main__":
    main()
