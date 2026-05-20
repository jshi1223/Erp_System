#!/usr/bin/env python3
from __future__ import annotations

import copy
import datetime as _dt
import re
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape


EMU_PER_INCH = 914400
DOC_IMAGE_WIDTH_IN = 6.45
DOC_IMAGE_HEIGHT_IN = 3.63
PPT_SLIDE_CX = 12192000
PPT_SLIDE_CY = 6858000


def emu(value_in_inches: float) -> int:
    return int(round(value_in_inches * EMU_PER_INCH))


def xml_text(value: str | None) -> str:
    return escape(value or "")


def paragraph(
    text: str = "",
    *,
    size_pt: int = 12,
    color: str = "2E3A4A",
    bold: bool = False,
    italic: bool = False,
    align: str = "left",
    before: int = 0,
    after: int = 120,
    left: int | None = None,
    hanging: int | None = None,
    page_break: bool = False,
) -> str:
    if page_break:
        return "<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>"

    ppr_parts: list[str] = [f'<w:jc w:val="{align}"/>']
    if before >= 0 or after >= 0:
        ppr_parts.append(f'<w:spacing w:before="{before}" w:after="{after}"/>')
    if left is not None:
        if hanging is not None:
            ppr_parts.append(f'<w:ind w:left="{left}" w:hanging="{hanging}"/>')
        else:
            ppr_parts.append(f'<w:ind w:left="{left}"/>')
    ppr = f'<w:pPr>{"".join(ppr_parts)}</w:pPr>'

    half_points = size_pt * 2
    rpr = (
        "<w:rPr>"
        '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>'
        f'<w:sz w:val="{half_points}"/>'
        f'<w:szCs w:val="{half_points}"/>'
        f'<w:color w:val="{color}"/>'
        + ("<w:b/>" if bold else "")
        + ("<w:i/>" if italic else "")
        + "</w:rPr>"
    )
    return f'<w:p>{ppr}<w:r>{rpr}<w:t xml:space="preserve">{xml_text(text)}</w:t></w:r></w:p>'


def bullet(text: str) -> str:
    return paragraph(f"- {text}", size_pt=12, left=720, hanging=360, after=55)


def image_paragraph(rel_id: str, title: str, index: int) -> str:
    cx = emu(DOC_IMAGE_WIDTH_IN)
    cy = emu(DOC_IMAGE_HEIGHT_IN)
    docpr = index + 1
    return f"""
<w:p>
  <w:pPr><w:jc w:val="center"/><w:spacing w:after="80"/></w:pPr>
  <w:r>
    <w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="{cx}" cy="{cy}"/>
        <wp:effectExtent l="0" t="0" r="0" b="0"/>
        <wp:docPr id="{docpr}" name="{xml_text(title)}"/>
        <wp:cNvGraphicFramePr>
          <a:graphicFrameLocks noChangeAspect="1"/>
        </wp:cNvGraphicFramePr>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic>
              <pic:nvPicPr>
                <pic:cNvPr id="{docpr}" name="{xml_text(title)}"/>
                <pic:cNvPicPr/>
                <pic:nvPr/>
              </pic:nvPicPr>
              <pic:blipFill>
                <a:blip r:embed="{rel_id}"/>
                <a:stretch><a:fillRect/></a:stretch>
              </pic:blipFill>
              <pic:spPr>
                <a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              </pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>
""".strip()


def build_docx_document_xml(base_xml: str, screenshots: list[dict], rel_ids: list[str]) -> str:
    if "UI Screenshots" in base_xml:
        base_xml = re.sub(
            r'<w:p>.*?<w:t xml:space="preserve">UI Screenshots</w:t>.*?(?=<w:sectPr>)',
            '',
            base_xml,
            count=1,
            flags=re.S,
        )

    appendix: list[str] = [
        paragraph("UI Screenshots", size_pt=17, color="1F4E79", bold=True, before=180, after=60),
        paragraph(
            "The following figures show the current application screens and module layouts used in the system documentation.",
            size_pt=12,
            color="4F5D73",
            after=100,
        ),
    ]
    for i, (spec, rel_id) in enumerate(zip(screenshots, rel_ids), start=1):
        if i > 1:
            appendix.append(paragraph(page_break=True))
        appendix.append(paragraph(f"Figure {i}: {spec['title']}", size_pt=12, color="1F4E79", bold=True, after=50))
        appendix.append(image_paragraph(rel_id, spec["title"], i))
        appendix.append(paragraph(f"What it does: {spec['description']}", size_pt=12, color="4F5D73", after=35))
        appendix.append(paragraph(f"How to use it: {spec['usage']}", size_pt=12, color="4F5D73", after=35))
        appendix.append(paragraph(f"Why it matters: {spec['importance']}", size_pt=12, color="4F5D73", after=35))
        if spec.get("bullets"):
            appendix.append(paragraph("Key points:", size_pt=12, color="1F4E79", bold=True, after=25))
            for line in spec["bullets"]:
                appendix.append(paragraph(f"- {line}", size_pt=12, color="2E3A4A", left=720, hanging=360, after=45))
        appendix.append(paragraph(spec["filename"], size_pt=10, color="6B7D95", align="center", after=120))

    appendix.append(paragraph(page_break=True))
    appendix.append(paragraph("Database Schema Notes", size_pt=17, color="1F4E79", bold=True, before=180, after=60))
    appendix.append(paragraph(
        "The schema is grouped so the ERP stays easy to maintain and the main business records stay connected without mixing every module together.",
        size_pt=12,
        color="4F5D73",
        after=80,
    ))
    for line in [
        "Core records revolve around projects, companies, service orders, and transactions.",
        "Procurement and finance tables keep vendor, bill, payment, and receipt data organized.",
        "Support tables preserve accounting, product lookup, and audit history for later review.",
    ]:
        appendix.append(paragraph(f"- {line}", size_pt=12, color="2E3A4A", left=720, hanging=360, after=55))

    appendix.append(paragraph(page_break=True))
    appendix.append(paragraph("ERD Relationship Legend", size_pt=17, color="1F4E79", bold=True, before=180, after=60))
    appendix.append(paragraph(
        "The arrows in the ERD point from the parent table or lookup table to the child table. The label on each line is the foreign key used in that relationship, so the reader can follow the exact column name instead of guessing from the box name alone.",
        size_pt=12,
        color="4F5D73",
        after=85,
    ))
    for line in [
        "company_registry.company_id -> projects.company_id.",
        "projects.project_id -> service_orders.project_id and transactions.project_id.",
        "service_orders.service_order_id -> transactions.service_order_id when a service order is posted into finance.",
        "vendors.vendor_id -> service_orders.vendor_id and procurement.vendor_id.",
        "accounts_payable.bill_id -> payments.bill_id, accounts_receivable.invoice_id -> payments.invoice_id, and transactions.transaction_id -> accounts_receivable.transaction_id.",
        "users.role_id -> roles.role_id, and payment audit records can also keep the user_id of the person who posted the entry.",
    ]:
        appendix.append(paragraph(f"- {line}", size_pt=12, color="2E3A4A", left=720, hanging=360, after=55))

    appendix.append(paragraph(page_break=True))
    appendix.append(paragraph("ERP Database Relationships by Module", size_pt=17, color="1F4E79", bold=True, before=180, after=60))
    appendix.append(paragraph(
        "The ERP is built around a project-centered database. Some modules write source documents, some post financial records, and some only read and summarize data. The notes below explain what each module stores and how it connects to the rest of the database.",
        size_pt=12,
        color="4F5D73",
        after=85,
    ))

    module_relationships = [
        (
            "Dashboard",
            "This is a read-only summary layer rather than a storage table.",
            [
                "It reads counts and totals from projects, service_orders, transactions, accounts_payable, accounts_receivable, and procurement tables.",
                "It does not own business records; it only presents the current status of the ERP in one screen.",
                "It is the entry point for navigating to project, finance, and procurement work."
            ],
        ),
        (
            "Company Registry",
            "This module stores the company master record used across the system.",
            [
                "The company_registry table holds the official company name, branch code, TIN, and contact information.",
                "Its company_id is reused by projects, transactions, receivables, and reporting filters.",
                "One company can have many projects and many linked financial records."
            ],
        ),
        (
            "Projects",
            "This module is the parent record for project-centered ERP work.",
            [
                "The projects table references company_registry through company_id so every project belongs to a company.",
                "Projects are the parent of service orders and can also be linked to transactions, costs, resources, and tasks.",
                "A single company can have many projects, but each project points back to one company master record."
            ],
        ),
        (
            "Service Orders",
            "This module stores the operational document that starts billable work.",
            [
                "The service_orders table links the project_id and vendor_id so the job is tied to both the project and the supplier.",
                "It keeps service_type, amount, and status so the system knows what kind of work was issued and whether it is ready to post.",
                "When billable, it can create or link a separate transaction without losing the original service order record."
            ],
        ),
        (
            "Transactions",
            "This module stores the financial posting after the source document is ready.",
            [
                "The transactions table can reference project_id, service_order_id, and company_id at the same time.",
                "It can be linked to a service order when the work is billable, or it can stay standalone for manual entries.",
                "These records feed Accounts Receivable and project-based reporting."
            ],
        ),
        (
            "Procurement",
            "This module controls request-to-receipt purchasing flow.",
            [
                "The requisitions, purchase_orders, and goods_receipts tables keep the purchase lifecycle organized.",
                "Vendor links keep the supplier on every procurement document, while project references can be added when a purchase belongs to a job.",
                "This module feeds Accounts Payable because received items and purchase orders become the basis for bills."
            ],
        ),
        (
            "Accounts Payable",
            "This module tracks vendor bills and outgoing payments.",
            [
                "The accounts_payable table stores the bill, due date, balance, and payment status for supplier obligations.",
                "It connects to vendors and may also reference purchase orders or goods receipts when the bill comes from procurement.",
                "Payments reduce the open balance and preserve the payment history for auditing."
            ],
        ),
        (
            "Accounts Receivable",
            "This module tracks customer invoices and collections.",
            [
                "The accounts_receivable table stores the invoice, due date, balance, and status for each customer record.",
                "It links back to transactions and company/project references so collections remain traceable to the source work.",
                "Payments reduce the balance and the remaining amount is what appears in overdue or outstanding summaries."
            ],
        ),
        (
            "Reports",
            "This module is a reporting layer, not a separate business table.",
            [
                "It reads data from projects, service_orders, transactions, accounts_payable, accounts_receivable, and procurement tables.",
                "Charts and filters are built from aggregated values so management can compare companies, invoices, and payments quickly.",
                "Because it is read-only, the Reports page does not create or modify source records."
            ],
        ),
        (
            "User Management",
            "This module protects the database rather than creating business transactions.",
            [
                "The users, roles, and system_logs tables control authentication, authorization, and audit history.",
                "Role-based access determines who can view, add, edit, or archive records in the ERP.",
                "This layer is important because it keeps the rest of the database safe and traceable."
            ],
        ),
    ]

    for module_name, summary, bullets in module_relationships:
        appendix.append(paragraph(module_name, size_pt=14, color="1F4E79", bold=True, before=110, after=30))
        appendix.append(paragraph(summary, size_pt=12, color="4F5D73", after=35))
        for bullet_line in bullets:
            appendix.append(paragraph(f"- {bullet_line}", size_pt=12, color="2E3A4A", left=720, hanging=360, after=45))

    appendix.append(paragraph(page_break=True))
    appendix.append(paragraph("System Flow and Usage", size_pt=17, color="1F4E79", bold=True, before=180, after=60))
    appendix.append(paragraph(
        "The flow chart explains the normal order of work so users know what to open first and where each module posts its records.",
        size_pt=12,
        color="4F5D73",
        after=80,
    ))
    for line in [
        "Start from the Dashboard after logging in, then open the module that matches the task.",
        "Use Project as the anchor record, then create Service Orders and Transactions when the work is ready to post.",
        "Procurement, Accounts Payable, and Accounts Receivable each follow their own register but remain linked by company and project references.",
    ]:
        appendix.append(paragraph(f"- {line}", size_pt=12, color="2E3A4A", left=720, hanging=360, after=55))

    insertion = "\n" + "\n".join(appendix) + "\n"
    if "<w:sectPr>" not in base_xml:
        raise RuntimeError("Could not locate document section properties in template docx.")
    prefix, suffix = base_xml.split("<w:sectPr>", 1)
    suffix = "<w:sectPr>" + suffix
    return prefix + insertion + suffix


def build_document_rels(base_rels: str, rel_ids: list[str]) -> str:
    rels = base_rels
    insertion = "".join(
        f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image{i}.png"/>'
        for i, rid in enumerate(rel_ids, start=1)
    )
    if rels.strip().endswith("/>"):
        return re.sub(
            r'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"\s*/>',
            f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{insertion}</Relationships>',
            rels,
            count=1,
        )
    rels = re.sub(
        r'<Relationship Id="[^"]+" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image\d+\.png"/>',
        '',
        rels,
    )
    return rels.replace("</Relationships>", insertion + "</Relationships>", 1)


def ensure_png_default(content_types_xml: str) -> str:
    if 'Extension="png"' in content_types_xml:
        return content_types_xml
    return content_types_xml.replace(
        '<Default Extension="xml" ContentType="application/xml" />',
        '<Default Extension="xml" ContentType="application/xml" />\n  <Default Extension="png" ContentType="image/png" />',
        1,
    )


def build_ppt_slide_xml(rel_id: str) -> str:
    cx = PPT_SLIDE_CX
    cy = PPT_SLIDE_CY
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" y="0"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:pic>
        <p:nvPicPr>
          <p:cNvPr id="2" name="Screenshot"/>
          <p:cNvPicPr/>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="{rel_id}"/>
          <a:stretch><a:fillRect/></a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm>
            <a:off x="0" y="0"/>
            <a:ext cx="{cx}" cy="{cy}"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:pic>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>
"""


def build_slide_rels(layout_target: str, image_rel_id: str, image_name: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="{layout_target}"/>
  <Relationship Id="{image_rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/{image_name}"/>
</Relationships>
"""


def update_presentation_xml(base_xml: str, existing_slide_count: int, new_total: int) -> str:
    return base_xml


def update_presentation_rels(base_rels: str, existing_slide_count: int, new_total: int) -> str:
    return base_rels


def update_content_types_for_ppt(content_types_xml: str, total_slides: int) -> str:
    if 'Extension="png"' not in content_types_xml:
        content_types_xml = content_types_xml.replace(
            '<Default Extension="xml" ContentType="application/xml" />',
            '<Default Extension="xml" ContentType="application/xml" />\n  <Default Extension="png" ContentType="image/png" />',
            1,
        )
    for i in range(9, total_slides + 1):
        part = f'/ppt/slides/slide{i}.xml'
        if part not in content_types_xml:
            insertion = (
                f'  <Override PartName="{part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml" />\n'
            )
            content_types_xml = content_types_xml.replace(
                '</Types>',
                insertion + '</Types>',
                1,
            )
    return content_types_xml


def trim_ppt_template(ppt_entries: dict[str, bytes], keep_count: int = 8) -> tuple[dict[str, bytes], int]:
    slide_names = sorted(
        [name for name in ppt_entries if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)],
        key=lambda n: int(re.search(r"slide(\d+)\.xml", n).group(1)),
    )
    existing_count = len(slide_names)
    if existing_count <= keep_count:
        return ppt_entries, existing_count

    for slide_num in range(keep_count + 1, existing_count + 1):
        ppt_entries.pop(f"ppt/slides/slide{slide_num}.xml", None)
        ppt_entries.pop(f"ppt/slides/_rels/slide{slide_num}.xml.rels", None)

    pres_xml = ppt_entries["ppt/presentation.xml"].decode("utf-8")
    sld_id_matches = list(re.finditer(r'<p:sldId id="\d+" r:id="rId\d+"/>', pres_xml))
    if sld_id_matches:
        kept = [m.group(0) for m in sld_id_matches[:keep_count]]
        new_sld_id_lst = "<p:sldIdLst>" + "".join(kept) + "</p:sldIdLst>"
        pres_xml = re.sub(r"<p:sldIdLst>.*?</p:sldIdLst>", new_sld_id_lst, pres_xml, count=1)
        ppt_entries["ppt/presentation.xml"] = pres_xml.encode("utf-8")

    pres_rels = ppt_entries["ppt/_rels/presentation.xml.rels"].decode("utf-8")
    pres_rels = re.sub(
        r'<Relationship Id="rId\d+" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide(\d+)\.xml"/>',
        lambda m: "" if int(m.group(1)) > keep_count else m.group(0),
        pres_rels,
    )
    ppt_entries["ppt/_rels/presentation.xml.rels"] = pres_rels.encode("utf-8")
    return ppt_entries, keep_count


def latest_valid_file(folder: Path, suffix: str) -> Path:
    candidates = [
        p for p in folder.glob(f"*{suffix}")
        if not p.name.startswith("~$")
    ]
    if not candidates:
        raise FileNotFoundError(f"No {suffix} files found in {folder}")
    return max(candidates, key=lambda p: p.stat().st_mtime)


def read_zip_text(zf: zipfile.ZipFile, name: str) -> str:
    return zf.read(name).decode("utf-8")


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    docs_dir = repo_root / "docs"
    screenshot_dir = docs_dir / "screenshots"
    screenshots = [
        {
            "filename": "01-dashboard.png",
            "title": "Dashboard",
            "description": "This is the main home screen where the key totals and shortcuts for the ERP modules are shown.",
            "usage": "Open this page first after login to see the overall system summary, quick module access, and the most important counters.",
            "importance": "It gives users a quick picture of system activity and acts as the entry point for every major workflow."
        },
        {
            "filename": "02-projects.png",
            "title": "Projects",
            "description": "This module is used to create and manage project records, search projects, and start project actions.",
            "usage": "Use the search bar to find a project, then add a new project or open the available actions from the table.",
            "importance": "Projects are the parent records that connect service orders, transactions, and related operational work."
        },
        {
            "filename": "03-ongoing-projects.png",
            "title": "Ongoing Projects",
            "description": "This view lists active projects and lets users monitor status, progress, dates, and related work.",
            "usage": "Check this tab when you want to review the current project status, progress percentage, and target dates.",
            "importance": "It helps management see which jobs are active and which projects still need attention."
        },
        {
            "filename": "04-project-transactions.png",
            "title": "Project Transactions",
            "description": "This section records financial transactions linked to projects and helps track paid, partial, and unpaid entries.",
            "usage": "Search by client or document number, then review the posted records, payment status, and transaction totals.",
            "importance": "It keeps the project financial trail organized so billing, collections, and balances can be audited later."
        },
        {
            "filename": "05-service-orders.png",
            "title": "Service Orders",
            "description": "This module stores service order details, links them to projects, and posts related transactions when needed.",
            "usage": "Create a service order when a job is issued, then review the linked project, service type, and status from the table.",
            "importance": "It bridges operational work and financial posting so the ERP stays project-centered and traceable."
        },
        {
            "filename": "06-procurement.png",
            "title": "Procurement Management",
            "description": "This workspace handles requisitions, purchase orders, and goods receipts for procurement tracking.",
            "usage": "Open the tab you need, then create requisitions, issue purchase orders, or record goods receipts as supplies arrive.",
            "importance": "It keeps purchasing activity structured from request to delivery so procurement is easy to follow."
        },
        {
            "filename": "07-accounts-payable.png",
            "title": "Accounts Payable Management",
            "description": "This page is used to manage vendor bills, due balances, and outgoing payments.",
            "usage": "Use the Bills tab for vendor invoices and the Payments tab to record money going out to suppliers.",
            "importance": "It helps the finance team know what is still unpaid, what has been settled, and what is overdue."
        },
        {
            "filename": "08-accounts-receivable.png",
            "title": "Accounts Receivable Management",
            "description": "This page tracks customer invoices, collections, balances, and payment status.",
            "usage": "Use the Receivables tab to see customer invoices and the Payments tab to register collections that come in.",
            "importance": "It gives a clear view of cash expected from clients and shows which accounts still need collection."
        },
        {
            "filename": "09-reports.png",
            "title": "Reports",
            "description": "This section shows financial summaries, collections charts, invoice status, and reporting filters.",
            "usage": "Type a company name in the search bar and review the charts and status summaries for that company.",
            "importance": "It gives management a quick view of performance, collections, and invoice health across the ERP."
        },
        {
            "filename": "10-sidebar-open.png",
            "title": "Sidebar Menu",
            "description": "This is the main navigation panel used to move between modules and section groups in the ERP.",
            "usage": "Click a module name to jump to that area, or expand a grouped menu to reach related pages quickly.",
            "importance": "It keeps navigation consistent so users can move around the ERP without getting lost."
        },
        {
            "filename": "11-database-schema.png",
            "title": "Database Schema",
            "description": "This graphic groups the ERP tables into business layers and labels the connector lines with the foreign key used in each relationship, so the audience can see how company, project, service order, procurement, finance, and audit data stay organized instead of being mixed into one large table set.",
            "usage": "Use this figure when explaining how the database keeps operational records separate from financial records while still linking them through shared keys such as company_id, project_id, vendor_id, service_order_id, bill_id, invoice_id, and transaction_id.",
            "importance": "It makes the data model easier to understand because each table family shows its own purpose, the arrow labels show the foreign key used, and the connector lines explain how the ERP moves from source records to posted transactions.",
            "bullets": [
                "company_registry.company_id points to projects.company_id and makes Company Registry the parent of each project record.",
                "projects.project_id is reused by service_orders.project_id and transactions.project_id so the source work stays connected to the same project.",
                "service_orders.service_order_id, vendors.vendor_id, bill_id, invoice_id, and transaction_id are the main labels used to trace the operational and financial links in the ERD."
            ]
        },
        {
            "filename": "12-flowchart.png",
            "title": "System Flowchart",
            "description": "This graphic shows the end-to-end ERP flow from login and dashboard access, through form validation and project posting, and down to the separate procurement and finance paths that follow after a record is saved.",
            "usage": "Use this figure to explain the order of work inside the ERP, including when a user fills a form, when the system checks required fields, and when a linked transaction is created automatically.",
            "importance": "It is useful for training because it shows both the normal path and the error path, so users can see what happens when fields are missing, when a record is standalone, and when it is ready to post.",
            "bullets": [
                "Validation happens before saving so missing fields are highlighted immediately.",
                "Project-linked records can create a separate financial transaction when the entry is billable.",
                "Procurement and finance continue in their own lanes while still feeding the ERP summaries."
            ]
        },
        {
            "filename": "13-module-relationships.png",
            "title": "ERP Module Relationships",
            "description": "This figure maps each ERP module to the tables it reads from or writes to, so the documentation shows which records are masters, which ones are source documents, and which ones are summary or audit views.",
            "usage": "Use this figure when explaining how the database is organized by module and why the project table remains the main anchor for transactions, service orders, procurement, and reporting.",
            "importance": "It gives readers a quick relationship map before they read the detailed module explanations, making the database structure much easier to understand.",
            "bullets": [
                "Dashboard and Reports are read-only summary layers that aggregate data from the live tables.",
                "Projects, Service Orders, and Transactions form the project-centered core of the ERP.",
                "Procurement, Payables, Receivables, and User Management each add their own linked records and audit trail."
            ]
        },
    ]
    screenshot_paths = [screenshot_dir / spec["filename"] for spec in screenshots]
    missing = [p.name for p in screenshot_paths if not p.exists()]
    if missing:
        raise FileNotFoundError(f"Missing screenshots: {', '.join(missing)}")

    generated = _dt.datetime.now()
    stamp = generated.strftime("%Y%m%d-%H%M%S")
    docx_out = docs_dir / f"KVSK-ERP-System-Documentation-{stamp}.docx"
    pptx_out = docs_dir / f"KVSK-ERP-System-Presentation-{stamp}.pptx"
    generated_long = generated.strftime("%B %d, %Y").replace(" 0", " ")

    template_docx = min(
        [p for p in docs_dir.glob("*.docx") if not p.name.startswith("~$")],
        key=lambda p: (p.stat().st_size, p.stat().st_mtime),
    )
    template_pptx = min(
        [p for p in docs_dir.glob("*.pptx") if not p.name.startswith("~$")],
        key=lambda p: (p.stat().st_size, p.stat().st_mtime),
    )

    # --- DOCX ---
    with zipfile.ZipFile(template_docx, "r") as zin:
        docx_entries = {name: zin.read(name) for name in zin.namelist()}

    base_doc_xml = docx_entries["word/document.xml"].decode("utf-8")
    base_doc_rels = docx_entries["word/_rels/document.xml.rels"].decode("utf-8")
    content_types = docx_entries["[Content_Types].xml"].decode("utf-8")

    doc_rel_ids = [f"rId{i}" for i in range(1, len(screenshots) + 1)]
    docx_entries["word/document.xml"] = build_docx_document_xml(base_doc_xml, screenshots, doc_rel_ids).encode("utf-8")
    docx_entries["word/_rels/document.xml.rels"] = build_document_rels(base_doc_rels, doc_rel_ids).encode("utf-8")
    docx_entries["[Content_Types].xml"] = ensure_png_default(content_types).encode("utf-8")
    for i, path in enumerate(screenshot_paths, start=1):
        docx_entries[f"word/media/image{i}.png"] = path.read_bytes()

    with zipfile.ZipFile(docx_out, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in docx_entries.items():
            zout.writestr(name, data)

    # --- PPTX ---
    with zipfile.ZipFile(template_pptx, "r") as zin:
        ppt_entries = {name: zin.read(name) for name in zin.namelist()}

    slide_names = sorted(
        [name for name in ppt_entries if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)],
        key=lambda n: int(re.search(r"slide(\d+)\.xml", n).group(1)),
    )
    existing_slide_count = len(slide_names)
    if existing_slide_count == 0:
        raise RuntimeError("Template PPTX does not contain any slides.")
    ppt_entries, existing_slide_count = trim_ppt_template(ppt_entries, keep_count=8)

    layout_rels_name = f"ppt/slides/_rels/slide{existing_slide_count}.xml.rels"
    layout_rels_xml = ppt_entries[layout_rels_name].decode("utf-8")
    layout_match = re.search(r'Target="(\.\./slideLayouts/[^"]+)"', layout_rels_xml)
    if not layout_match:
        raise RuntimeError("Unable to determine slide layout target from template PPTX.")
    layout_target = layout_match.group(1)

    total_slides = existing_slide_count + len(screenshots)

    pres_xml = ppt_entries["ppt/presentation.xml"].decode("utf-8")
    pres_rels = ppt_entries["ppt/_rels/presentation.xml.rels"].decode("utf-8")
    ppt_entries["ppt/presentation.xml"] = update_presentation_xml(pres_xml, existing_slide_count, total_slides).encode("utf-8")
    ppt_entries["ppt/_rels/presentation.xml.rels"] = update_presentation_rels(pres_rels, existing_slide_count, total_slides).encode("utf-8")
    ppt_entries["[Content_Types].xml"] = update_content_types_for_ppt(ppt_entries["[Content_Types].xml"].decode("utf-8"), total_slides).encode("utf-8")

    next_rel_id = 14
    next_slide_num = existing_slide_count + 1
    for i, spec in enumerate(screenshots, start=1):
        name = spec["filename"]
        slide_num = next_slide_num + i - 1
        image_rel_id = "rId2"
        ppt_entries[f"ppt/slides/slide{slide_num}.xml"] = build_ppt_slide_xml(image_rel_id).encode("utf-8")
        ppt_entries[f"ppt/slides/_rels/slide{slide_num}.xml.rels"] = build_slide_rels(layout_target, image_rel_id, name).encode("utf-8")
        ppt_entries[f"ppt/media/image{i}.png"] = (screenshot_dir / name).read_bytes()
        # Add the slide relationship in presentation.xml.rels and the slide id in presentation.xml.
        ppt_entries["ppt/_rels/presentation.xml.rels"] = ppt_entries["ppt/_rels/presentation.xml.rels"].replace(
            b"</Relationships>",
            f'<Relationship Id="rId{next_rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{slide_num}.xml"/>'.encode("utf-8") + b"</Relationships>",
            1,
        )
        ppt_entries["ppt/presentation.xml"] = ppt_entries["ppt/presentation.xml"].replace(
            b"</p:sldIdLst>",
            f'<p:sldId id="{263 + i}" r:id="rId{next_rel_id}"/>'.encode("utf-8") + b"</p:sldIdLst>",
            1,
        )
        next_rel_id += 1

    with zipfile.ZipFile(pptx_out, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in ppt_entries.items():
            zout.writestr(name, data)

    print(f"Generated:\n - {docx_out}\n - {pptx_out}")


if __name__ == "__main__":
    main()
