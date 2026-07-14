from pathlib import Path
import json

src = Path("source-json")
out = Path("output/recipes.json")
recipes = []

for p in sorted(src.glob("*.json")):
    with p.open(encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        recipes.extend(data)
    else:
        recipes.append(data)

with out.open("w", encoding="utf-8") as f:
    json.dump(recipes, f, ensure_ascii=False, indent=2)

print(f"Kész: {len(recipes)} recept")