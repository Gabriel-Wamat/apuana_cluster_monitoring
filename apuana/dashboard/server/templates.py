import re
from pathlib import Path
from typing import Optional

from .config import HTML, PARTIAL_ROOT

INCLUDE_RE = re.compile(r"<!--\s*@include\s+([A-Za-z0-9_./-]+)\s*-->")


def _render_html_file(path: Path, seen: Optional[set[Path]] = None) -> str:
    seen = seen or set()
    resolved = path.resolve()
    if resolved in seen:
        raise RuntimeError(f"Circular HTML include detected: {path}")
    seen.add(resolved)

    text = path.read_text(encoding="utf-8")

    def include(match: re.Match) -> str:
        rel = match.group(1)
        target = (PARTIAL_ROOT / rel).resolve()
        target.relative_to(PARTIAL_ROOT.resolve())
        return _render_html_file(target, seen)

    return INCLUDE_RE.sub(include, text)


def _index_html_bytes() -> bytes:
    return _render_html_file(HTML).encode("utf-8")
