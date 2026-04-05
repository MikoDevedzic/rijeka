path = r"C:\Users\mikod\OneDrive\Desktop\Rijeka\frontend\src\components\CommandCenter.css"

with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

OLD = "  color: var(--text-dim);\n  font-family: var(--mono); font-size: 0.62rem;"
NEW = "  color: #8ab0c8;\n  font-family: var(--mono); font-size: 0.62rem;"

if OLD not in c:
    print("ERROR: target string not found — check CSS file")
else:
    c = c.replace(OLD, NEW, 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(c)
    print("OK: nav button color fixed")
