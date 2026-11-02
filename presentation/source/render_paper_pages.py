"""Page images of the paper draft for the project-review deck (read-only).

Renders page 1 of research_paper/manuscript/manuscript.pdf (cropped to the title and abstract) and the page
carrying the largest figure.
Run with any Python that has PyMuPDF:  python presentation/source/render_paper_pages.py
"""
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[2]
doc = fitz.open(ROOT / "research_paper" / "manuscript" / "manuscript.pdf")
OUT = ROOT / "presentation" / "assets"


def biggest_image_area(page):
    return max((r.width * r.height for img in page.get_images() for r in page.get_image_rects(img[0])), default=0)


fig_page = max(range(1, len(doc)), key=lambda i: biggest_image_area(doc[i]))
for name, i in (("paper_page1", 0), ("paper_figure_page", fig_page)):
    doc[i].get_pixmap(dpi=110).save(OUT / f"{name}.png")
    print("saved", name, "page", i + 1)

# page 1 from the title down (the draft-status note above it is covered on the slide itself)
from PIL import Image
Image.open(OUT / "paper_page1.png").crop((40, 290, 900, 1150)).save(OUT / "paper_page1.png")
