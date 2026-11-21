"""Read-only checks for feature folders, relocated imports and focused workspaces."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]

def check():
    errors = []
    manifest = json.loads((ROOT / "docs/SOURCE_FILE_MOVES.json").read_text(encoding="utf-8"))
    for old, new in manifest["moves"].items():
        if not (ROOT / new).is_file():
            errors.append(f"Missing relocated source: {new}")
        if (ROOT / old).is_file():
            errors.append(f"Duplicate old flat source: {old}")
    src = ROOT / "page_design/frontend/src"
    for source in src.rglob("*"):
        if source.suffix not in (".ts", ".tsx", ".mjs", ".js", ".css"):
            continue
        text = source.read_text(encoding="utf-8")
        imports = re.findall(r"(?:from\s*|import\s*(?:\(\s*)?)[\"'](\.[^\"']+)[\"']", text)
        for specifier in imports:
            path = source.parent / specifier
            candidates = [path, *[Path(str(path) + suffix) for suffix in (".ts", ".tsx", ".mjs", ".js", ".css")], path / "index.ts", path / "index.tsx"]
            if not any(item.is_file() for item in candidates):
                errors.append(f"Unresolved import in {source.relative_to(ROOT)}: {specifier}")
    workspaces = list((ROOT / "workspaces").glob("*.code-workspace"))
    for workspace in workspaces:
        config = json.loads(workspace.read_text(encoding="utf-8"))
        for folder in config["folders"]:
            if not (workspace.parent / folder["path"]).is_dir():
                errors.append(f"Missing workspace folder in {workspace.name}: {folder['path']}")
    flat = [item.name for item in src.iterdir() if item.is_file() and item.name not in ("main.tsx", "agentAssetTypes.d.ts")]
    errors.extend(f"Unexpected flat source; choose a feature folder: {name}" for name in flat)
    result = {"ok": not errors, "moved_files": len(manifest["moves"]), "workspaces": len(workspaces), "errors": errors}
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0 if not errors else 1

if __name__ == "__main__":
    raise SystemExit(check())
