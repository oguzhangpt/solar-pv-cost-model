"""Build a single self-contained HTML file of the application.

Inlines the stylesheet, the Plotly bundle, the extracted workbook data and all
application scripts into Uygulamayi_Ac.html (repository root), so the app can be
opened by double-clicking one file (also straight from inside a ZIP or an
e-mail attachment) without the app/ folder next to it.

Usage:  python3 tools/build_single_file.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
OUT = ROOT / "Uygulamayi_Ac.html"


def main():
    html = (APP / "index.html").read_text(encoding="utf8")

    def css(m):
        return "<style>\n" + (APP / m.group(1)).read_text(encoding="utf8") + "\n</style>"

    def js(m):
        src = (APP / m.group(1)).read_text(encoding="utf8")
        return "<script>\n" + src.replace("</script", "<\\/script") + "\n</script>"

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', js, html)
    OUT.write_text(html, encoding="utf8")
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
