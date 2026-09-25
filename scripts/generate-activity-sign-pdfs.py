"""Render the approved activity-sign content as individual letter-size PDFs.

The HTML sign sheet remains the single source for activity copy and QR targets.
Run with the Codex PDF runtime after installing fonttools, brotli, and svglib.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from fontTools.ttLib import TTFont as FontToolsFont
from reportlab.graphics import renderPDF
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from svglib.svglib import svg2rlg


ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "artifacts/activity-signs/activity-signs.html"
QR_DIR = HTML.parent
FONT_ROOT = ROOT / "node_modules/@fontsource"
TEMP = ROOT / "tmp/pdfs"
OUTPUT = ROOT / "output/pdf"
WIDTH, HEIGHT = letter

INK = HexColor("#172019")
PAPER = HexColor("#fbfbf6")
LIME = HexColor("#cce84e")
BRIGHT_LIME = HexColor("#d8f35c")
MUTED_GREEN = HexColor("#476026")
SCORE_BG = HexColor("#f0f3e5")
SCORE_BORDER = HexColor("#aebba0")


def read_activities() -> tuple[str, list[dict]]:
    javascript = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(process.argv[1], 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('Activity data script not found');
const context = { document: { querySelector: () => ({ innerHTML: '' }) } };
vm.createContext(context);
vm.runInContext(script + '\nglobalThis.signData = { website, activities };', context);
process.stdout.write(JSON.stringify(context.signData));
"""
    result = subprocess.run(
        ["node", "-e", javascript, str(HTML)],
        check=True,
        capture_output=True,
        text=True,
    )
    data = json.loads(result.stdout)
    if not data["activities"] or len({item["id"] for item in data["activities"]}) != len(data["activities"]):
        raise ValueError("Expected a nonempty list of activities with unique IDs")
    return data["website"], data["activities"]


def register_fonts() -> None:
    fonts = {
        "Barlow400": FONT_ROOT / "barlow/files/barlow-latin-400-normal.woff2",
        "Barlow600": FONT_ROOT / "barlow/files/barlow-latin-600-normal.woff2",
        "Barlow700": FONT_ROOT / "barlow/files/barlow-latin-700-normal.woff2",
        "BarlowCondensed900": FONT_ROOT / "barlow-condensed/files/barlow-condensed-latin-900-normal.woff2",
    }
    TEMP.mkdir(parents=True, exist_ok=True)
    for name, source in fonts.items():
        destination = TEMP / f"{name}.ttf"
        font = FontToolsFont(source)
        font.flavor = None
        font.save(destination)
        pdfmetrics.registerFont(TTFont(name, str(destination)))


def wrapped(text: str, font: str, size: float, max_width: float) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        trial = f"{current} {word}" if current else word
        if current and pdfmetrics.stringWidth(trial, font, size) > max_width:
            lines.append(current)
            current = word
        else:
            current = trial
    if current:
        lines.append(current)
    if any(pdfmetrics.stringWidth(line, font, size) > max_width for line in lines):
        raise ValueError(f"Text contains a word too wide for its box: {text}")
    return lines


def draw_lines(
    pdf: canvas.Canvas,
    lines: list[str],
    x: float,
    baseline: float,
    font: str,
    size: float,
    leading: float,
    color=INK,
) -> float:
    pdf.setFillColor(color)
    pdf.setFont(font, size)
    for line in lines:
        pdf.drawString(x, baseline, line)
        baseline -= leading
    return baseline + leading


def draw_header(pdf: canvas.Canvas) -> None:
    top_height = 86.4
    pdf.setFillColor(INK)
    pdf.rect(0, HEIGHT - top_height, WIDTH, top_height, fill=1, stroke=0)

    # A very quiet crop of the website's camouflage texture.
    camo = svg2rlg(str(ROOT / "public/brand/camo.svg"))
    if camo is not None:
        pdf.saveState()
        path = pdf.beginPath()
        path.rect(320, HEIGHT - top_height, 292, top_height)
        pdf.clipPath(path, stroke=0, fill=0)
        pdf.translate(335, HEIGHT - 135)
        pdf.scale(0.46, 0.46)
        renderPDF.draw(camo, pdf, 0, 0)
        pdf.restoreState()
        pdf.saveState()
        pdf.setFillColor(INK)
        pdf.setFillAlpha(0.86)
        pdf.rect(320, HEIGHT - top_height, 292, top_height, fill=1, stroke=0)
        pdf.restoreState()

    pdf.setFont("BarlowCondensed900", 31)
    pdf.setFillColor(PAPER)
    pdf.drawString(40, HEIGHT - 51, "UNCOMMON")
    brand_end = 40 + pdfmetrics.stringWidth("UNCOMMON", "BarlowCondensed900", 31)
    pdf.setFillColor(LIME)
    pdf.drawString(brand_end + 6, HEIGHT - 51, "MEN")
    pdf.rect(40, HEIGHT - 68, 151, 4, fill=1, stroke=0)

    pdf.setFillColor(HexColor("#e7ecd9"))
    pdf.setFont("Barlow600", 9.5)
    pdf.drawRightString(570, HEIGHT - 48, "EVENT GUIDE")


def draw_qr(pdf: canvas.Canvas, event_id: str, activity_url: str) -> None:
    x, y, size = 433.2, 70.6, 118.8
    pdf.setFillColor(HexColor("#ffffff"))
    pdf.setStrokeColor(BRIGHT_LIME)
    pdf.setLineWidth(1)
    pdf.rect(x, y, size, size, fill=1, stroke=1)
    qr = svg2rlg(str(QR_DIR / f"qr-{event_id}.svg"))
    if qr is None:
        raise ValueError(f"QR code unavailable for {event_id}")
    inner = size - 14.4
    scale = min(inner / qr.width, inner / qr.height)
    pdf.saveState()
    pdf.translate(x + (size - qr.width * scale) / 2, y + (size - qr.height * scale) / 2)
    pdf.scale(scale, scale)
    renderPDF.draw(qr, pdf, 0, 0)
    pdf.restoreState()
    pdf.linkURL(activity_url, (x, y, x + size, y + size), relative=0, thickness=0)


def render_one(activity: dict, index: int, total: int, website: str) -> Path:
    destination = OUTPUT / f"uncommon-men-{activity['id']}.pdf"
    pdf = canvas.Canvas(str(destination), pagesize=letter, pageCompression=1)
    pdf.setTitle(f"Uncommon Men - {activity['name']}")
    pdf.setAuthor("Uncommon Men")
    pdf.setSubject("Event guide and scoring link")
    pdf.setFillColor(PAPER)
    pdf.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)
    draw_header(pdf)

    left, body_width = 42, 528
    y = HEIGHT - 86.4 - 36
    title_lines = wrapped(activity["name"].upper(), "BarlowCondensed900", 42, body_width)
    pdf.setFillColor(INK)
    pdf.setFont("BarlowCondensed900", 42)
    for title_line in title_lines:
        y -= 38
        pdf.drawString(left, y, title_line)
        y -= 2
    title_rule = y - 13
    pdf.setStrokeColor(HexColor("#ccd5bd"))
    pdf.setLineWidth(2)
    pdf.line(left, title_rule, left + body_width, title_rule)

    label_y = title_rule - 28
    pdf.setFillColor(MUTED_GREEN)
    pdf.setFont("Barlow700", 12)
    pdf.drawString(left, label_y, "HOW TO PLAY")
    description_lines = wrapped(activity["description"], "Barlow600", 19, body_width)
    last_desc_baseline = draw_lines(
        pdf, description_lines, left, label_y - 31, "Barlow600", 19, 23.6
    )

    score_top = last_desc_baseline - 30
    record_lines = wrapped(activity["record"], "Barlow700", 22, body_width - 40)
    score_height = 18 + 14 + 8 + 26 * len(record_lines) + 17
    score_bottom = score_top - score_height
    pdf.setFillColor(SCORE_BG)
    pdf.setStrokeColor(SCORE_BORDER)
    pdf.setLineWidth(1)
    pdf.rect(left, score_bottom, body_width, score_height, fill=1, stroke=1)
    pdf.setFillColor(HexColor("#b9d734"))
    pdf.rect(left, score_top - 3, body_width, 3, fill=1, stroke=0)
    pdf.setFillColor(INK)
    pdf.setFont("Barlow700", 12)
    pdf.drawString(left + 20, score_top - 26, "WHAT WE RECORD")
    draw_lines(
        pdf, record_lines, left + 20, score_top - 56, "Barlow700", 22, 26
    )

    format_y = score_bottom - 29
    pdf.setFillColor(INK)
    pdf.setFont("Barlow700", 15)
    pdf.drawString(left, format_y, "Format:")
    format_x = left + pdfmetrics.stringWidth("Format:", "Barlow700", 15) + 5
    pdf.setFont("Barlow400", 15)
    pdf.drawString(format_x, format_y, activity["format"])
    info_bottom = format_y
    if activity.get("timed"):
        timing = "No stopwatch or timer? Use the built-in stopwatch on this event's app page."
        timing_lines = wrapped(timing, "Barlow600", 14, body_width)
        info_bottom = draw_lines(
            pdf,
            timing_lines,
            left,
            format_y - 27,
            "Barlow600",
            14,
            17.5,
            HexColor("#355020"),
        )
    if info_bottom < 223:
        raise ValueError(f"Activity copy overlaps the QR panel: {activity['id']} ({info_bottom:.1f})")

    cta_y, cta_height = 52, 156
    pdf.setFillColor(INK)
    pdf.rect(left, cta_y, body_width, cta_height, fill=1, stroke=0)
    pdf.setFillColor(HexColor("#b9d734"))
    pdf.rect(left, cta_y + cta_height - 3, body_width, 3, fill=1, stroke=0)
    pdf.setFillColor(BRIGHT_LIME)
    pdf.setFont("BarlowCondensed900", 25)
    pdf.drawString(left + 18, cta_y + 112, "OPEN THIS EVENT")
    cta_description = "The QR opens this event directly. Or type the URL and choose it from the list."
    draw_lines(
        pdf,
        wrapped(cta_description, "Barlow400", 13, 350),
        left + 18,
        cta_y + 88,
        "Barlow400",
        13,
        16,
        HexColor("#ffffff"),
    )
    url_y = cta_y + 35
    pdf.setFillColor(HexColor("#ffffff"))
    pdf.setFont("Barlow700", 15)
    pdf.drawString(left + 18, url_y, website)
    url_width = pdfmetrics.stringWidth(website, "Barlow700", 15)
    pdf.setStrokeColor(HexColor("#ffffff"))
    pdf.setLineWidth(0.75)
    pdf.line(left + 18, url_y - 3, left + 18 + url_width, url_y - 3)
    pdf.linkURL(website, (left + 18, url_y - 5, left + 18 + url_width, url_y + 16), relative=0, thickness=0)
    draw_qr(pdf, activity["id"], website + "events/" + activity["id"])

    pdf.setFillColor(INK)
    pdf.setFont("Barlow700", 10.5)
    pdf.drawRightString(570, 28, f"{index:02d} / {total}")
    pdf.showPage()
    pdf.save()
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", help="Render only the event with this ID")
    args = parser.parse_args()
    website, activities = read_activities()
    if args.event and not any(activity["id"] == args.event for activity in activities):
        parser.error("Unknown event ID: " + args.event)
    register_fonts()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for index, activity in enumerate(activities, start=1):
        if args.event and activity["id"] != args.event:
            continue
        path = render_one(activity, index, len(activities), website)
        print(path)


if __name__ == "__main__":
    main()
