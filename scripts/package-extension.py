"""Package only the extension's explicit public files. Never include app secrets."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
source = root / "extension"
names = ["manifest.json", "background.js", "content.js", "popup.html", "popup.css", "popup.js", "README.md"]
manifest = json.loads((source / "manifest.json").read_text())
assert manifest["manifest_version"] == 3
target = root / "artifacts" / "nobori-clip-extension.zip"
target.parent.mkdir(exist_ok=True)
with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    for name in names:
        archive.write(source / name, "nobori-clip/" + name)
print(f"Chrome拡張のZIPを作成しました: {target}")
