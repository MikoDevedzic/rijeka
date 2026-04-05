import re, sys

path = r"C:\Users\mikod\OneDrive\Desktop\Rijeka\frontend\src\index.css"

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

OLD_ROOT = """:root {
  /* Backgrounds */
  --bg:           #060a0e;
  --bg-deep:      #03060a;
  --panel:        #0b1219;
  --panel-2:      #0f1820;
  --panel-3:      #141f28;

  /* Borders */
  --border:       #192433;
  --border-hi:    #213040;
  --border-glow:  #1a4060;

  /* Text */
  --text:         #7da8c0;
  --text-hi:      #b8d8e8;
  --text-dim:     #344e62;
  --text-mute:    #1a2e3e;

  /* Accent — green */
  --accent:       #0ec9a0;
  --accent-dim:   #097a61;
  --accent-glow:  rgba(14, 201, 160, 0.10);

  /* Amber */
  --amber:        #e8a020;
  --amber-dim:    #8a5010;
  --amber-glow:   rgba(232, 160, 32, 0.08);

  /* Blue */
  --blue:         #3d8bc8;
  --blue-dim:     #1a3a60;
  --blue-glow:    rgba(61, 139, 200, 0.08);

  /* Other palette */
  --green:        #1dc87a;
  --purple:       #9060cc;
  --purple-dim:   #3a2060;
  --purple-glow:  rgba(144, 96, 204, 0.08);
  --red:          #d95040;
  --cyan:         #20c0c8;

  /* Typography */
  --mono: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Courier New', monospace;

  /* Layout heights */
  --appbar-h:  48px;
  --cfgnav-h:  38px;
  --mdnav-h:   36px;
  --sidebar-w: 260px;
}"""

NEW_ROOT = """:root {
  /* ── OPTION A: REFINED DARK NAVY ── adopted April 2026 ──────── */

  /* Backgrounds */
  --bg:           #0a0f14;
  --bg-deep:      #070b0f;
  --panel:        #0f1823;
  --panel-2:      #152030;
  --panel-3:      #1c2a3a;

  /* Borders */
  --border:       #1e3045;
  --border-hi:    #243850;
  --border-glow:  #1a4060;

  /* Text */
  --text:         #e8f0f8;
  --text-hi:      #e8f0f8;
  --text-dim:     #526878;
  --text-mute:    #526878;

  /* Accent — teal */
  --accent:       #0dd4a8;
  --accent-dim:   #097a61;
  --accent-glow:  rgba(13, 212, 168, 0.10);

  /* Amber */
  --amber:        #f0a020;
  --amber-dim:    #8a5010;
  --amber-glow:   rgba(240, 160, 32, 0.08);

  /* Blue */
  --blue:         #4a9ad4;
  --blue-dim:     #1a3a60;
  --blue-glow:    rgba(74, 154, 212, 0.08);

  /* Other palette */
  --green:        #1dc87a;
  --purple:       #9060cc;
  --purple-dim:   #3a2060;
  --purple-glow:  rgba(144, 96, 204, 0.08);
  --red:          #e05040;
  --cyan:         #20c0c8;
  --chain:        #f07820;
  --crit:         #ffffff;

  /* Typography */
  --mono: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Courier New', monospace;

  /* Layout heights */
  --appbar-h:  44px;
  --cfgnav-h:  38px;
  --mdnav-h:   36px;
  --sidebar-w: 260px;
}"""

if OLD_ROOT not in content:
    print("ERROR: could not find :root block — check for whitespace differences")
    sys.exit(1)

content = content.replace(OLD_ROOT, NEW_ROOT, 1)

# Also fix .app-bar height mismatch (40px → 44px)
content = content.replace(
    '.app-bar {\n  height: 40px;',
    '.app-bar {\n  height: 44px;'
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("OK: index.css updated to Option A palette")
