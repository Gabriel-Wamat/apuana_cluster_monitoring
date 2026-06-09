import json
from pathlib import Path


RESEARCH_TEMPLATE_ROOT = Path(__file__).resolve().parents[3] / "research_templates"


class ResearchTemplateError(RuntimeError):
    pass


def _load_template_file(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    template_id = str(data.get("id") or path.parent.name).strip()
    if not template_id:
        raise ResearchTemplateError(f"Template sem id: {path}")
    data["id"] = template_id
    data["template_file"] = str(data.get("template_file") or "run.sbatch.tpl")
    data["_root"] = str(path.parent)
    return data


def list_research_templates() -> list[dict]:
    if not RESEARCH_TEMPLATE_ROOT.exists():
        return []
    templates = []
    for path in sorted(RESEARCH_TEMPLATE_ROOT.glob("*/template.json")):
        try:
            data = _load_template_file(path)
            public = {k: v for k, v in data.items() if not k.startswith("_")}
            templates.append(public)
        except Exception:
            continue
    return templates


def get_research_template(template_id: str) -> dict:
    wanted = str(template_id or "").strip()
    if not wanted:
        raise ResearchTemplateError("Template obrigatório.")
    path = (RESEARCH_TEMPLATE_ROOT / wanted / "template.json").resolve()
    try:
        path.relative_to(RESEARCH_TEMPLATE_ROOT.resolve())
    except ValueError as exc:
        raise ResearchTemplateError("Template inválido.") from exc
    if not path.is_file():
        raise ResearchTemplateError("Template não encontrado.")
    return _load_template_file(path)


def research_templates_payload() -> dict:
    templates = list_research_templates()
    return {"ok": True, "templates": templates}
