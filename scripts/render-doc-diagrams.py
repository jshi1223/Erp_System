#!/usr/bin/env python3
from __future__ import annotations

import math
import textwrap
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "screenshots"
W, H = 1600, 900


def rgb(value: str) -> tuple[int, int, int]:
    return ImageColor.getrgb(value)


def font(size: int, *, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates: list[Path] = []
    if mono:
        candidates += [
            Path("C:/Windows/Fonts/consola.ttf"),
            Path("C:/Windows/Fonts/consolab.ttf"),
        ]
    else:
        candidates += [
            Path("C:/Windows/Fonts/segoeui.ttf"),
            Path("C:/Windows/Fonts/segoeuib.ttf") if bold else Path("C:/Windows/Fonts/segoeui.ttf"),
        ]
        if bold:
            candidates += [
                Path("C:/Windows/Fonts/arialbd.ttf"),
            ]
    candidates += [
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/consola.ttf"),
    ]
    for path in candidates:
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size=size)
            except Exception:
                continue
    return ImageFont.load_default()


def text_box(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont) -> tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=fnt)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def wrap_text(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = str(text or "").split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        trial = current + " " + word
        if text_box(draw, trial, fnt)[0] <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def draw_multiline(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    fnt: ImageFont.ImageFont,
    fill: tuple[int, int, int],
    max_width: int,
    line_gap: int = 6,
) -> int:
    x, y = xy
    lines = wrap_text(draw, text, fnt, max_width)
    _, line_h = text_box(draw, "Ag", fnt)
    for line in lines:
        draw.text((x, y), line, font=fnt, fill=fill)
        y += line_h + line_gap
    return y


def rounded_panel(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    fill: tuple[int, int, int],
    outline: tuple[int, int, int] | None = None,
    radius: int = 24,
    width: int = 2,
) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def chip(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, fill: tuple[int, int, int], outline: tuple[int, int, int], text_fill: tuple[int, int, int]) -> None:
    draw.rounded_rectangle(box, radius=14, fill=fill, outline=outline, width=2)
    fnt = font(18, bold=True, mono=True)
    tw, th = text_box(draw, text, fnt)
    x0, y0, x1, y1 = box
    draw.text(((x0 + x1 - tw) / 2, (y0 + y1 - th) / 2 - 1), text, font=fnt, fill=text_fill)


def arrowhead(draw: ImageDraw.ImageDraw, tip: tuple[float, float], direction: tuple[float, float], color: tuple[int, int, int], size: int = 12) -> None:
    dx, dy = direction
    length = math.hypot(dx, dy) or 1.0
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    bx = tip[0] - ux * size
    by = tip[1] - uy * size
    p1 = (tip[0], tip[1])
    p2 = (bx + px * (size * 0.45), by + py * (size * 0.45))
    p3 = (bx - px * (size * 0.45), by - py * (size * 0.45))
    draw.polygon([p1, p2, p3], fill=color)


def route(draw: ImageDraw.ImageDraw, points: list[tuple[int, int]], color: tuple[int, int, int], width: int = 6, label: str | None = None, label_pos: tuple[int, int] | None = None, label_fill: tuple[int, int, int] = (17, 24, 39), label_bg: tuple[int, int, int] | None = None) -> None:
    if len(points) < 2:
        return
    draw.line(points, fill=color, width=width, joint="curve")
    a = points[-2]
    b = points[-1]
    arrowhead(draw, b, (b[0] - a[0], b[1] - a[1]), color, size=12)
    if label and label_pos:
        fnt = font(18, bold=True)
        tw, th = text_box(draw, label, fnt)
        px, py = label_pos
        pad_x, pad_y = 12, 7
        bg = label_bg or (255, 255, 255)
        draw.rounded_rectangle((px, py, px + tw + pad_x * 2, py + th + pad_y * 2), radius=14, fill=bg, outline=color, width=2)
        draw.text((px + pad_x, py + pad_y - 1), label, font=fnt, fill=label_fill)


def table_card(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    title: str,
    rows: list[tuple[str, str]],
    accent: tuple[int, int, int],
    title_fill: tuple[int, int, int] = (245, 247, 251),
    body_fill: tuple[int, int, int] = (226, 232, 240),
) -> dict[str, tuple[int, int]]:
    x0, y0, x1, y1 = box
    rounded_panel(draw, box, fill=(35, 39, 49), outline=(97, 108, 127), radius=20, width=2)
    header_h = 54
    draw.rounded_rectangle((x0, y0, x1, y0 + header_h), radius=20, fill=(45, 49, 59))
    draw.rectangle((x0, y0 + header_h - 16, x1, y0 + header_h), fill=(45, 49, 59))
    title_font = font(28, bold=True, mono=True)
    draw.text((x0 + 24, y0 + 15), title, font=title_font, fill=title_fill)
    accent_chip_w = min(180, max(120, len(title) * 11))
    draw.rounded_rectangle((x1 - accent_chip_w - 16, y0 + 14, x1 - 16, y0 + 42), radius=14, fill=(accent[0], accent[1], accent[2],) if isinstance(accent, tuple) else accent, outline=accent, width=2)
    draw.text((x1 - accent_chip_w - 3, y0 + 17), "TABLE", font=font(16, bold=True, mono=True), fill=accent)

    left_w = int((x1 - x0) * 0.63)
    split_x = x0 + left_w
    draw.line((split_x, y0 + header_h, split_x, y1), fill=(104, 112, 128), width=2)
    row_y = y0 + header_h
    row_area_h = y1 - row_y
    row_h = row_area_h / max(len(rows), 1)
    centers: dict[str, tuple[int, int]] = {}
    name_font = font(18, bold=False, mono=True)
    type_font = font(17, bold=False)
    for i, (field, typ) in enumerate(rows):
        top = int(row_y + i * row_h)
        bottom = int(row_y + (i + 1) * row_h)
        if i > 0:
            draw.line((x0 + 12, top, x1 - 12, top), fill=(79, 88, 102), width=1)
        draw.text((x0 + 24, top + 16), field, font=name_font, fill=body_fill)
        draw.text((split_x + 20, top + 16), typ, font=type_font, fill=(205, 212, 224))
        centers[field] = ((x0 + x1) // 2, (top + bottom) // 2)
    return centers


def setup_bg(size: tuple[int, int], base: tuple[int, int, int], grid: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGB", size, base)
    d = ImageDraw.Draw(img)
    for x in range(0, size[0], 80):
        d.line((x, 0, x, size[1]), fill=grid, width=1)
    for y in range(0, size[1], 80):
        d.line((0, y, size[0], y), fill=grid, width=1)
    return img


def title_banner(draw: ImageDraw.ImageDraw, title: str, subtitle: str, right_label: str, fill: tuple[int, int, int], outline: tuple[int, int, int], title_color: tuple[int, int, int], subtitle_color: tuple[int, int, int]) -> None:
    box = (34, 28, 1566, 118)
    rounded_panel(draw, box, fill=fill, outline=outline, radius=36, width=2)
    draw.text((58, 45), title, font=font(30, bold=True, mono=True), fill=title_color)
    draw.text((58, 82), subtitle, font=font(15), fill=subtitle_color)
    if right_label:
        tw, th = text_box(draw, right_label, font(16, bold=True, mono=True))
        draw.text((1530 - tw, 46), right_label, font=font(16, bold=True, mono=True), fill=title_color)


def generate_schema_image(path: Path) -> None:
    img = Image.new("RGB", (W, H), (240, 236, 222))
    d = ImageDraw.Draw(img)

    def gradient_header(box: tuple[int, int, int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> None:
        x0, y0, x1, y1 = box
        height = max(1, y1 - y0)
        for i in range(height):
            t = i / max(1, height - 1)
            color = tuple(int(round(top[j] + (bottom[j] - top[j]) * t)) for j in range(3))
            d.line((x0, y0 + i, x1, y0 + i), fill=color)

    def erd_box(title: str, box: tuple[int, int, int, int], fields: list[tuple[str, str]]) -> dict[str, tuple[int, int]]:
        x0, y0, x1, y1 = box
        header_h = 32
        border = (112, 131, 195)
        body = (255, 255, 255)
        d.rounded_rectangle(box, radius=8, outline=border, width=2, fill=body)
        gradient_header((x0 + 1, y0 + 1, x1 - 1, y0 + header_h), (170, 191, 246), (103, 131, 214))
        d.rectangle((x0 + 1, y0 + header_h - 2, x1 - 1, y0 + header_h + 1), fill=(103, 131, 214))
        d.rounded_rectangle((x0, y0, x1, y0 + header_h), radius=8, outline=border, width=2)
        d.text((x0 + 12, y0 + 6), title, font=font(15, bold=True), fill=(255, 255, 255))
        split_x = x0 + int((x1 - x0) * 0.68)
        d.line((split_x, y0 + header_h, split_x, y1), fill=(186, 193, 206), width=1)

        row_top = y0 + header_h + 2
        row_h = (y1 - row_top) / max(1, len(fields))
        name_font = font(12, mono=True)
        type_font = font(12)
        anchors: dict[str, tuple[int, int]] = {}
        for i, (field, typ) in enumerate(fields):
            top = int(row_top + i * row_h)
            bottom = int(row_top + (i + 1) * row_h)
            if i > 0:
                d.line((x0 + 1, top, x1 - 1, top), fill=(214, 218, 227), width=1)
            d.text((x0 + 12, top + 8), field, font=name_font, fill=(22, 24, 30))
            d.text((split_x + 12, top + 8), typ, font=type_font, fill=(58, 63, 72))
            anchors[field] = ((x0 + x1) // 2, (top + bottom) // 2)
        return anchors

    def connector(
        points: list[tuple[int, int]],
        color: tuple[int, int, int] = (54, 60, 75),
        width: int = 4,
        label: str | None = None,
        label_pos: tuple[int, int] | None = None,
    ) -> None:
        route(d, points, color, width=width, label=label, label_pos=label_pos, label_fill=(37, 67, 135), label_bg=(255, 255, 255))

    cards = {
        "Company Registry": ((40, 160, 350, 400), [
            ("company_id", "Int"),
            ("company_name", "String"),
            ("branch_code", "String"),
            ("tin", "String"),
            ("phone", "String"),
        ]),
        "Projects": ((400, 160, 760, 400), [
            ("project_id", "Int"),
            ("company_id", "Int"),
            ("project_no", "String"),
            ("project_title", "String"),
            ("status", "String"),
        ]),
        "Users": ((790, 160, 1040, 300), [
            ("user_id", "Int"),
            ("username", "String"),
            ("email", "String"),
            ("role_id", "Int"),
            ("status", "String"),
        ]),
        "Roles": ((1080, 160, 1520, 300), [
            ("role_id", "Int"),
            ("role_name", "String"),
            ("permissions", "String"),
            ("status", "String"),
        ]),
        "Vendors": ((1080, 330, 1520, 490), [
            ("vendor_id", "Int"),
            ("vendor_name", "String"),
            ("tin", "String"),
            ("phone", "String"),
            ("email", "String"),
        ]),
        "Service Orders": ((180, 455, 620, 705), [
            ("so_id", "Int"),
            ("project_id", "Int"),
            ("vendor_id", "Int"),
            ("service_type", "String"),
            ("amount", "Money"),
        ]),
        "Transactions": ((660, 455, 1040, 705), [
            ("transaction_id", "Int"),
            ("project_id", "Int"),
            ("service_order_id", "Int"),
            ("company_id", "Int"),
            ("amount", "Money"),
        ]),
        "Procurement": ((1080, 525, 1520, 705), [
            ("purchase_requisitions", "Table"),
            ("purchase_orders", "Table"),
            ("goods_receipts", "Table"),
            ("vendor_id", "Int"),
        ]),
        "Accounts Payable": ((40, 735, 430, 885), [
            ("bill_id", "Int"),
            ("vendor_id", "Int"),
            ("po_id", "Int"),
            ("due_date", "Date"),
            ("balance", "Money"),
        ]),
        "Payments / Audit": ((520, 735, 980, 885), [
            ("payment_id", "Int"),
            ("bill_id", "Int"),
            ("invoice_id", "Int"),
            ("user_id", "Int"),
            ("posted_at", "Date"),
        ]),
        "Accounts Receivable": ((1040, 735, 1520, 885), [
            ("invoice_id", "Int"),
            ("company_id", "Int"),
            ("transaction_id", "Int"),
            ("due_date", "Date"),
            ("balance", "Money"),
        ]),
    }

    anchors: dict[str, dict[str, tuple[int, int]]] = {}
    for title, (box, fields) in cards.items():
        anchors[title] = erd_box(title, box, fields)

    def edge(title: str, side: str) -> tuple[int, int]:
        x0, y0, x1, y1 = cards[title][0]
        if side == "left":
            return (x0, (y0 + y1) // 2)
        if side == "right":
            return (x1, (y0 + y1) // 2)
        if side == "top":
            return ((x0 + x1) // 2, y0)
        return ((x0 + x1) // 2, y1)

    # business relationships
    connector([edge("Company Registry", "right"), (400, 280), edge("Projects", "left")], label="company_id", label_pos=(330, 250))
    connector([(580, 400), (580, 455)], label="project_id", label_pos=(540, 420))
    connector([(730, 400), (730, 455)], label="project_id", label_pos=(690, 420))
    connector([edge("Users", "right"), (1080, 230), edge("Roles", "left")], label="role_id", label_pos=(950, 194))
    connector([(1300, 490), (1300, 525)], label="vendor_id", label_pos=(1310, 500))
    connector([(1300, 330), (1300, 320), (620, 320), (620, 455)], label="vendor_id", label_pos=(820, 292))
    connector([edge("Service Orders", "right"), (620, 575), (660, 575)], label="service_order_id", label_pos=(596, 548))
    connector([(850, 705), (850, 715), (1280, 715), (1280, 735)], label="transaction_id", label_pos=(980, 688))
    connector([(1300, 705), (1300, 715), (235, 715), (235, 735)], label="po_id", label_pos=(760, 694))
    connector([edge("Accounts Payable", "right"), (430, 810), edge("Payments / Audit", "left")], label="bill_id", label_pos=(444, 784))
    connector([edge("Accounts Receivable", "left"), (1040, 810), edge("Payments / Audit", "right")], label="invoice_id", label_pos=(1010, 784))

    img.save(path)


def draw_label(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, fill: tuple[int, int, int], outline: tuple[int, int, int], text_fill: tuple[int, int, int], *, mono: bool = False) -> tuple[int, int, int, int]:
    fnt = font(18, bold=True, mono=mono)
    tw, th = text_box(draw, text, fnt)
    box = (x, y, x + tw + 28, y + th + 18)
    draw.rounded_rectangle(box, radius=16, fill=fill, outline=outline, width=2)
    draw.text((x + 14, y + 8), text, font=fnt, fill=text_fill)
    return box


def draw_node(draw: ImageDraw.ImageDraw, kind: str, box: tuple[int, int, int, int], text: str, fill: tuple[int, int, int], outline: tuple[int, int, int], text_fill: tuple[int, int, int] = (24, 32, 47), font_size: int = 20) -> None:
    x0, y0, x1, y1 = box
    if kind == "ellipse":
        draw.ellipse(box, fill=fill, outline=outline, width=3)
    elif kind == "diamond":
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        pts = [(cx, y0), (x1, cy), (cx, y1), (x0, cy)]
        draw.polygon(pts, fill=fill, outline=outline)
        draw.line(pts + [pts[0]], fill=outline, width=3)
    elif kind == "parallelogram":
        slant = min(26, (x1 - x0) // 5)
        pts = [(x0 + slant, y0), (x1, y0), (x1 - slant, y1), (x0, y1)]
        draw.polygon(pts, fill=fill, outline=outline)
        draw.line(pts + [pts[0]], fill=outline, width=3)
    else:
        draw.rounded_rectangle(box, radius=16, fill=fill, outline=outline, width=3)

    fnt = font(font_size, bold=False)
    max_width = int((x1 - x0) * 0.8)
    lines = wrap_text(draw, text, fnt, max_width)
    line_h = text_box(draw, "Ag", fnt)[1]
    total_h = len(lines) * line_h + (len(lines) - 1) * 4
    y = y0 + (y1 - y0 - total_h) / 2
    for line in lines:
        tw, th = text_box(draw, line, fnt)
        draw.text((x0 + (x1 - x0 - tw) / 2, y), line, font=fnt, fill=text_fill)
        y += th + 4


def generate_flowchart_image(path: Path) -> None:
    img = setup_bg((W, H), (236, 242, 250), (220, 228, 240))
    d = ImageDraw.Draw(img)
    d.ellipse((-120, 620, 420, 1180), fill=(223, 235, 248))
    d.ellipse((1080, 110, 1720, 720), fill=(220, 232, 248))
    title_banner(
        d,
        "SYSTEM FLOWCHART",
        "How the ERP moves from login, validation, and source documents to posted records",
        "ERP WORKFLOW",
        (250, 252, 255),
        (203, 217, 238),
        (37, 67, 135),
        (85, 105, 145),
    )

    # Intake lane
    draw_node(d, "ellipse", (56, 184, 174, 246), "Start", rgb("#F6C0C4"), (67, 74, 90), font_size=20)
    draw_node(d, "parallelogram", (56, 286, 174, 370), "Login", rgb("#C8D8F4"), (67, 74, 90), font_size=19)
    draw_node(d, "rounded", (54, 404, 176, 486), "Dashboard", rgb("#F8D89C"), (67, 74, 90), font_size=19)
    draw_node(d, "rounded", (54, 528, 176, 610), "Open Module", rgb("#FFD7A1"), (67, 74, 90), font_size=18)
    draw_node(d, "parallelogram", (54, 650, 176, 734), "Fill Form", rgb("#CFE9D6"), (67, 74, 90), font_size=19)

    route(d, [(115, 246), (115, 286)], (40, 44, 54), width=5)
    route(d, [(115, 370), (115, 404)], (40, 44, 54), width=5)
    route(d, [(115, 486), (115, 528)], (40, 44, 54), width=5)
    route(d, [(115, 610), (115, 650)], (40, 44, 54), width=5)

    # Validation and branching
    draw_node(d, "diamond", (294, 300, 450, 416), "Required Fields OK?", rgb("#F9D39E"), (67, 74, 90), font_size=19)
    draw_node(d, "rounded", (308, 500, 452, 588), "Highlight\nMissing Fields", rgb("#F8CACA"), (67, 74, 90), font_size=18)
    draw_node(d, "rounded", (494, 304, 654, 390), "Save Record", rgb("#FFD983"), (67, 74, 90), font_size=20)
    draw_node(d, "diamond", (718, 300, 878, 416), "Service Order?", rgb("#F6D19B"), (67, 74, 90), font_size=19)
    draw_node(d, "rounded", (936, 320, 1110, 390), "Service Order", rgb("#CFE0FF"), (67, 74, 90), font_size=18)
    draw_node(d, "rounded", (936, 522, 1110, 592), "Add Transaction", rgb("#DCE6F6"), (67, 74, 90), font_size=17)
    draw_node(d, "diamond", (1142, 300, 1302, 416), "Billable?", rgb("#F6C8A8"), (67, 74, 90), font_size=20)
    draw_node(d, "rounded", (1360, 320, 1522, 390), "Linked Transaction", rgb("#C8DCF7"), (67, 74, 90), font_size=16)
    draw_node(d, "rounded", (1360, 522, 1522, 592), "Keep as Source", rgb("#DCE6F6"), (67, 74, 90), font_size=17)
    draw_node(d, "rounded", (1360, 664, 1522, 734), "Post to AR / AP", rgb("#FFDEA7"), (67, 74, 90), font_size=18)
    draw_node(d, "ellipse", (1388, 782, 1494, 842), "End", rgb("#F6C0C4"), (67, 74, 90), font_size=20)

    # Main flow lines
    route(d, [(174, 445), (252, 445), (252, 358), (294, 358)], (73, 92, 132), width=5)
    route(d, [(450, 358), (494, 358)], (73, 92, 132), width=5, label="Yes", label_pos=(458, 322), label_fill=(73, 92, 132), label_bg=(255, 255, 255))
    route(d, [(450, 394), (390, 394), (390, 500)], (73, 92, 132), width=5, label="No", label_pos=(414, 404), label_fill=(73, 92, 132), label_bg=(255, 255, 255))
    route(d, [(654, 352), (718, 352)], (73, 92, 132), width=5)
    route(d, [(878, 352), (936, 352)], (73, 92, 132), width=5, label="Yes", label_pos=(892, 318), label_fill=(73, 92, 132), label_bg=(255, 255, 255))
    route(d, [(878, 388), (842, 388), (842, 556), (936, 556)], (73, 92, 132), width=5, label="No", label_pos=(850, 404), label_fill=(73, 92, 132), label_bg=(255, 255, 255))
    route(d, [(1110, 355), (1142, 355)], (73, 92, 132), width=5, label="Yes", label_pos=(1118, 322), label_fill=(73, 92, 132), label_bg=(255, 255, 255))
    route(d, [(1110, 556), (1230, 556), (1230, 698), (1360, 698)], (73, 92, 132), width=5)
    route(d, [(1302, 355), (1360, 355)], (73, 92, 132), width=5)
    route(d, [(1302, 555), (1360, 555)], (73, 92, 132), width=5)
    route(d, [(1441, 390), (1441, 664)], (73, 92, 132), width=5)
    route(d, [(1441, 734), (1441, 782)], (73, 92, 132), width=5)
    route(d, [(1522, 555), (1542, 555), (1542, 812), (1494, 812)], (73, 92, 132), width=5)
    route(d, [(174, 686), (234, 686), (234, 358), (294, 358)], (73, 92, 132), width=5)
    route(d, [(380, 588), (380, 726), (174, 726)], (73, 92, 132), width=5)

    # procurement lane
    draw_node(d, "rounded", (88, 790, 236, 842), "Requisition", rgb("#F8D89C"), (67, 74, 90), font_size=18)
    draw_node(d, "rounded", (290, 790, 436, 842), "Purchase Order", rgb("#FFD7A1"), (67, 74, 90), font_size=17)
    draw_node(d, "rounded", (492, 790, 648, 842), "Goods Receipt", rgb("#CFE9D6"), (67, 74, 90), font_size=18)
    draw_node(d, "rounded", (698, 790, 842, 842), "Vendor Bill", rgb("#C8D8F4"), (67, 74, 90), font_size=18)
    draw_node(d, "rounded", (900, 790, 1046, 842), "Payment", rgb("#F6D19B"), (67, 74, 90), font_size=18)
    draw_node(d, "rounded", (1102, 790, 1278, 842), "Accounting Update", rgb("#DCE6F6"), (67, 74, 90), font_size=16)

    route(d, [(236, 816), (290, 816)], (45, 160, 120), width=5)
    route(d, [(436, 816), (492, 816)], (45, 160, 120), width=5)
    route(d, [(648, 816), (698, 816)], (45, 160, 120), width=5)
    route(d, [(842, 816), (900, 816)], (45, 160, 120), width=5)
    route(d, [(1046, 816), (1102, 816)], (45, 160, 120), width=5)

    # small footer note
    note_box = (40, 856, 1540, 888)
    d.rounded_rectangle(note_box, radius=10, outline=(160, 170, 190), fill=(247, 244, 235), width=2)
    note = "Yellow diamonds are decision points, blue boxes are source or posting actions, and the green lane shows procurement flow."
    draw_multiline(d, (58, 861), note, font(12), (54, 60, 75), 1450, line_gap=1)

    img.save(path)


def generate_module_relationship_image(path: Path) -> None:
    img = Image.new("RGB", (W, H), (242, 239, 227))
    d = ImageDraw.Draw(img)

    def gradient_header(box: tuple[int, int, int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> None:
        x0, y0, x1, y1 = box
        height = max(1, y1 - y0)
        for i in range(height):
            t = i / max(1, height - 1)
            color = tuple(int(round(top[j] + (bottom[j] - top[j]) * t)) for j in range(3))
            d.line((x0, y0 + i, x1, y0 + i), fill=color)

    title_banner(
        d,
        "ERP MODULE RELATIONSHIPS",
        "How each module reads from and writes to the database",
        "MODULE MAP",
        (249, 251, 255),
        (203, 217, 238),
        (37, 67, 135),
        (85, 105, 145),
    )

    table = (42, 156, 1546, 824)
    d.rounded_rectangle(table, radius=18, outline=(121, 145, 191), fill=(255, 255, 255), width=2)
    header_h = 48
    header = (42, 156, 1546, 204)
    gradient_header(header, (142, 167, 229), (93, 124, 208))
    d.rounded_rectangle((42, 156, 1546, 204), radius=18, outline=(121, 145, 191), width=2)
    d.rectangle((42, 186, 1546, 204), fill=(93, 124, 208))

    headers = ["MODULE", "MAIN TABLES", "RELATIONSHIP SUMMARY"]
    col_widths = [250, 340, 914]
    col_x = [42, 42 + col_widths[0], 42 + col_widths[0] + col_widths[1], 1546]
    header_font = font(18, bold=True, mono=True)
    for idx, title in enumerate(headers):
        x = col_x[idx]
        d.text((x + 16, 168), title, font=header_font, fill=(255, 255, 255))
        if idx > 0:
            d.line((x, 204, x, 824), fill=(191, 198, 212), width=2)
    d.line((42, 204, 1546, 204), fill=(191, 198, 212), width=2)

    rows = [
        ("Dashboard", "projects, service_orders, transactions", "Read-only summary layer that aggregates live ERP data."),
        ("Company Registry", "company_registry", "Master table for company details reused by projects and finance."),
        ("Projects", "projects, costs, resources, tasks", "Parent record linking company, service orders, and postings."),
        ("Service Orders", "service_orders", "Operational source document tied to project and vendor."),
        ("Transactions", "transactions", "Financial posting linked to a project or service order."),
        ("Procurement", "requisitions, purchase_orders, goods_receipts", "Request-to-receipt flow for purchasing."),
        ("Accounts Payable", "accounts_payable, payments", "Vendor bills, due dates, balances, and payment settlement."),
        ("Accounts Receivable", "accounts_receivable, payments", "Invoices, collections, and customer balance tracking."),
        ("Reports", "no standalone table", "Read-only analytics and filters built from live tables."),
        ("User Management", "users, roles, system_logs", "Authentication, roles, and audit trail for the ERP."),
    ]

    row_top = 204
    row_h = (824 - row_top) / len(rows)
    module_font = font(13, bold=True, mono=True)
    tables_font = font(11, mono=True)
    summary_font = font(11)
    for i, (module, tables, summary) in enumerate(rows):
        top = int(row_top + i * row_h)
        bottom = int(row_top + (i + 1) * row_h)
        fill = (251, 248, 241) if i % 2 == 0 else (255, 255, 255)
        d.rectangle((42, top, 1546, bottom), fill=fill)
        if i > 0:
            d.line((42, top, 1546, top), fill=(214, 219, 230), width=1)
        module_fill = (223, 231, 250)
        d.rounded_rectangle((54, top + 8, 54 + 110, top + 30), radius=10, fill=module_fill, outline=(145, 168, 228), width=1)
        d.text((62, top + 12), module, font=module_font, fill=(37, 67, 135))
        draw_multiline(d, (col_x[1] + 16, top + 10), tables, tables_font, (35, 39, 47), 310, line_gap=2)
        draw_multiline(d, (col_x[2] + 16, top + 10), summary, summary_font, (55, 61, 74), 870, line_gap=2)

    footer = (42, 838, 1546, 884)
    d.rounded_rectangle(footer, radius=10, outline=(160, 170, 190), fill=(247, 244, 235), width=2)
    note = "The project table is the central anchor of the ERP; finance, procurement, reporting, and access control all refer back to the same core records."
    draw_multiline(d, (60, 844), note, font(12), (54, 60, 75), 1440, line_gap=1)

    img.save(path)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    generate_schema_image(OUT_DIR / "11-database-schema.png")
    generate_flowchart_image(OUT_DIR / "12-flowchart.png")
    generate_module_relationship_image(OUT_DIR / "13-module-relationships.png")
    print("Generated updated diagram assets:")
    print(f" - {OUT_DIR / '11-database-schema.png'}")
    print(f" - {OUT_DIR / '12-flowchart.png'}")
    print(f" - {OUT_DIR / '13-module-relationships.png'}")


if __name__ == "__main__":
    main()
