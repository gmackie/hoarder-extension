import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class AudioExtractionError(RuntimeError):
    pass


@dataclass(frozen=True)
class AudioProbe:
    size: int
    duration_ms: int
    codec: str
    sample_rate: int | None
    channels: int | None
    tool_version: str


class AudioExtractor:
    def __init__(self, root: Path) -> None:
        self.root = root

    def initialize(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    def extract(
        self,
        *,
        source: Path,
        relative_path: str,
        recipe: dict[str, Any],
        metadata: dict[str, str],
    ) -> AudioProbe:
        output = self._resolve(relative_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(f"{output.suffix}.part")
        temporary.unlink(missing_ok=True)
        command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
        start_ms = int(recipe.get("start_ms", 0))
        end_ms = recipe.get("end_ms")
        if start_ms:
            command.extend(["-ss", f"{start_ms / 1000:.3f}"])
        command.extend(["-i", str(source), "-vn"])
        if end_ms is not None:
            command.extend(["-t", f"{(int(end_ms) - start_ms) / 1000:.3f}"])
        output_format = str(recipe["format"])
        bitrate = int(recipe["bitrate_kbps"])
        if output_format == "m4a":
            command.extend(["-c:a", "aac", "-b:a", f"{bitrate}k", "-f", "ipod"])
        elif output_format == "opus":
            command.extend(["-c:a", "libopus", "-b:a", f"{bitrate}k", "-f", "ogg"])
        elif output_format == "flac":
            command.extend(["-c:a", "flac", "-f", "flac"])
        else:
            raise AudioExtractionError("Unsupported output format")
        for key, value in metadata.items():
            if value:
                command.extend(["-metadata", f"{key}={value}"])
        command.append(str(temporary))
        try:
            subprocess.run(command, check=True, capture_output=True, text=True)
            probe = self._probe(temporary)
            if probe.duration_ms <= 0 or probe.size <= 0:
                raise AudioExtractionError("Extracted audio did not pass validation")
            os.replace(temporary, output)
            return probe
        except (OSError, subprocess.CalledProcessError, ValueError) as error:
            raise AudioExtractionError("FFmpeg could not extract this source") from error
        finally:
            temporary.unlink(missing_ok=True)

    def resolve(self, relative_path: str) -> Path | None:
        candidate = self._resolve(relative_path)
        return candidate if candidate.is_file() else None

    def delete(self, relative_path: str) -> bool:
        candidate = self._resolve(relative_path)
        if not candidate.exists():
            return False
        candidate.unlink()
        return True

    def _resolve(self, relative_path: str) -> Path:
        root = self.root.resolve()
        candidate = (root / relative_path).resolve()
        if not candidate.is_relative_to(root):
            raise AudioExtractionError("Invalid derivative path")
        return candidate

    @staticmethod
    def _probe(path: Path) -> AudioProbe:
        response = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_name,sample_rate,channels,codec_type",
                "-of",
                "json",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(response.stdout)
        audio_stream = next(
            stream
            for stream in payload.get("streams", [])
            if stream.get("codec_type") == "audio"
        )
        duration = float(payload.get("format", {}).get("duration", 0))
        version = subprocess.run(
            ["ffmpeg", "-version"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()[0]
        return AudioProbe(
            size=path.stat().st_size,
            duration_ms=round(duration * 1000),
            codec=str(audio_stream.get("codec_name", "unknown")),
            sample_rate=(
                int(audio_stream["sample_rate"])
                if audio_stream.get("sample_rate")
                else None
            ),
            channels=(
                int(audio_stream["channels"])
                if audio_stream.get("channels") is not None
                else None
            ),
            tool_version=version[:255],
        )
