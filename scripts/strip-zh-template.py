from pathlib import Path

p = Path(__file__).resolve().parents[1] / "packages/templates/vite-shadcn-template.ts"
text = p.read_text(encoding="utf-8")
for key in ["BUILDER_ZH.md", "READEME_ZH.md"]:
    marker = f'  "{key}": {{'
    start = text.find(marker)
    if start < 0:
        print("not found", key)
        continue
    i = text.find("{", start)
    depth = 0
    end = i
    while end < len(text):
        ch = text[end]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end += 1
                break
        end += 1
    while end < len(text) and text[end] in " \t":
        end += 1
    if end < len(text) and text[end] == ",":
        end += 1
    if end < len(text) and text[end] == "\n":
        end += 1
    text = text[:start] + text[end:]
    print("removed", key)
p.write_text(text, encoding="utf-8")
print("done")
