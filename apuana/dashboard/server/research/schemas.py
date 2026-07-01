import re
from typing import Any, Optional


class ResearchValidationError(ValueError):
    pass


PARTITION_QOS = {
    "short-simple": "simple",
    "short-complex": "complex",
    "long-simple": "simple",
    "long-complex": "complex",
}

DEFAULT_RESOURCES = {
    "partition": "short-simple",
    "cpus": 4,
    "mem": "16G",
    "gpus": 0,
    "time": "02:00:00",
    "node": "",
    "job_name": "research",
}

_SAFE_ID_RE = re.compile(r"[^A-Za-z0-9_.-]+")
_MEM_RE = re.compile(r"^\d+(?:[KMGTP]?)$", re.IGNORECASE)
_TIME_RE = re.compile(r"^(?:(\d+)-)?(\d{1,2}):(\d{2}):(\d{2})$")
_NODE_RE = re.compile(r"^cluster-node(?:[1-9]|10)$")


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def safe_slug(value: str, default: str = "research") -> str:
    slug = _SAFE_ID_RE.sub("-", str(value or "").strip().lower()).strip(".-")
    return (slug or default)[:64]


def env_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", str(value or "").upper()).strip("_")
    return cleaned or "VALUE"


def normalize_resources(raw: Optional[dict]) -> dict:
    raw = raw or {}
    partition = str(raw.get("partition") or DEFAULT_RESOURCES["partition"]).strip()
    if partition not in PARTITION_QOS:
        raise ResearchValidationError("Partição inválida para job batch.")

    cpus = max(1, min(_as_int(raw.get("cpus"), DEFAULT_RESOURCES["cpus"]), 48))
    gpus = max(0, min(_as_int(raw.get("gpus"), DEFAULT_RESOURCES["gpus"]), 4))

    mem = str(raw.get("mem") or DEFAULT_RESOURCES["mem"]).strip().upper()
    if not _MEM_RE.match(mem):
        raise ResearchValidationError("Memória inválida. Use valores como 16G, 64000M ou 500G.")

    time_limit = str(raw.get("time") or DEFAULT_RESOURCES["time"]).strip()
    time_match = _TIME_RE.match(time_limit)
    if not time_match:
        raise ResearchValidationError("Tempo inválido. Use HH:MM:SS ou D-HH:MM:SS.")
    days = int(time_match.group(1) or 0)
    hours = int(time_match.group(2))
    minutes = int(time_match.group(3))
    seconds = int(time_match.group(4))
    if hours > 23 or minutes > 59 or seconds > 59:
        raise ResearchValidationError("Tempo inválido. Horas, minutos ou segundos fora do intervalo.")
    if days > 7 or (days == 7 and (hours or minutes or seconds)):
        raise ResearchValidationError("Tempo acima do limite máximo de 7 dias.")

    node = str(raw.get("node") or "").strip()
    if node and not _NODE_RE.match(node):
        raise ResearchValidationError("Nó inválido. Use nomes como cluster-node5 ou cluster-node10.")

    job_name = safe_slug(raw.get("job_name") or raw.get("jobName") or DEFAULT_RESOURCES["job_name"])
    return {
        "partition": partition,
        "qos": PARTITION_QOS[partition],
        "cpus": cpus,
        "mem": mem,
        "gpus": gpus,
        "time": time_limit,
        "node": node,
        "job_name": job_name,
    }


def normalize_params(template: dict, raw: Optional[dict], run_id: str) -> dict:
    raw = raw or {}
    result = {}
    for field in template.get("fields", []):
        name = str(field.get("name") or "").strip()
        if not name:
            continue
        default = field.get("default", "")
        value = raw.get(name, default)
        if value is None:
            value = ""
        value = str(value).replace("${run_id}", run_id)
        if field.get("required") and not value.strip():
            raise ResearchValidationError(f"Parâmetro obrigatório ausente: {name}.")
        options = field.get("options") or []
        if options and value not in [str(option) for option in options]:
            raise ResearchValidationError(f"Valor inválido para {name}.")
        max_len = int(field.get("maxLength") or 8192)
        if len(value) > max_len:
            raise ResearchValidationError(f"Parâmetro muito longo: {name}.")
        result[name] = value
    for key, value in raw.items():
        if key not in result:
            continue
        result[key] = str(value).replace("${run_id}", run_id)
    return result
