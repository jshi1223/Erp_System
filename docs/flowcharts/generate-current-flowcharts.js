'use strict';

const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;

const styles = {
  title: 'text;html=1;strokeColor=none;fillColor=none;fontSize=22;fontStyle=1;',
  note: 'rounded=0;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;fontSize=11;',
  start: 'ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;',
  process: 'rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;',
  decision: 'rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;',
  data: 'shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;',
  report: 'rounded=0;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;',
  end: 'ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;'
};

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function label(value) {
  return Array.isArray(value) ? value.map(esc).join('&lt;br&gt;') : esc(value);
}

function cell(id, value, kind, x, y, w = 180, h = 80) {
  return `        <mxCell id="${id}" value="${label(value)}" style="${styles[kind] || styles.process}" vertex="1" parent="1">
          <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" />
        </mxCell>`;
}

function edge(id, source, target, value = '') {
  return `        <mxCell id="${id}" value="${esc(value)}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;" edge="1" parent="1" source="${source}" target="${target}">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>`;
}

function xml(title, width, height, nodes, edges) {
  return `<mxfile host="Electron" modified="2026-05-18T00:00:00.000Z" agent="Codex" version="24.7.17">
  <diagram id="${esc(title).replace(/[^A-Za-z0-9]/g, '')}" name="${esc(title)}">
    <mxGraphModel dx="${width}" dy="${height}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${width}" pageHeight="${height}" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${nodes.join('\n')}
${edges.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

function write(filename, title, width, height, nodes, edges) {
  fs.writeFileSync(path.join(OUT_DIR, filename), xml(title, width, height, nodes, edges), 'utf8');
}

function common(prefix, moduleName) {
  const nodes = [
    cell(`${prefix}-title`, `${moduleName} CURRENT FLOW CHART`, 'title', 285, 15, 520, 40),
    cell(`${prefix}-legend`, ['Legend:', 'Green = Start/End', 'Blue = Process', 'Yellow = Decision', 'Orange = Database Record', 'Purple = Report/Summary'], 'note', 930, 60, 230, 120),
    cell(`${prefix}-start`, 'START', 'start', 485, 80, 120, 65),
    cell(`${prefix}-login`, 'LOGIN', 'process', 480, 195, 130, 70),
    cell(`${prefix}-role`, ['ROLE', 'CHECK?'], 'decision', 492, 315, 105, 105),
    cell(`${prefix}-denied`, 'ACCESS DENIED', 'end', 250, 330, 150, 65),
    cell(`${prefix}-dash`, 'DASHBOARD', 'process', 470, 480, 150, 75),
    cell(`${prefix}-module`, ['SELECT MODULE', moduleName], 'process', 430, 625, 230, 80)
  ];
  const edges = [
    edge(`${prefix}-e1`, `${prefix}-start`, `${prefix}-login`),
    edge(`${prefix}-e2`, `${prefix}-login`, `${prefix}-role`),
    edge(`${prefix}-e3`, `${prefix}-role`, `${prefix}-dash`, 'Admin'),
    edge(`${prefix}-e4`, `${prefix}-role`, `${prefix}-denied`, 'No access'),
    edge(`${prefix}-e5`, `${prefix}-dash`, `${prefix}-module`)
  ];
  return { nodes, edges };
}

{
  const { nodes, edges } = common('proj', 'PROJECTS');
  nodes.push(
    cell('proj-tabs', ['SELECT PROJECT TAB', 'Projects / Ongoing / Transactions / Service Orders / Overview / Documents'], 'process', 365, 770, 360, 95),
    cell('proj-view', 'VIEW PROJECT RECORDS', 'process', 455, 920, 190, 75),
    cell('proj-action', ['CREATE OR EDIT', 'PROJECT?'], 'decision', 465, 1045, 170, 115),
    cell('proj-archive', ['ARCHIVE / VIEW ONLY', 'No related records deleted'], 'report', 775, 1060, 230, 80),
    cell('proj-form', 'OPEN PROJECT FORM', 'process', 455, 1215, 190, 75),
    cell('proj-company', ['COMPANY', 'REGISTERED?'], 'decision', 170, 1210, 155, 110),
    cell('proj-registry', ['CREATE / SELECT COMPANY', 'company_registry'], 'data', 120, 1380, 240, 85),
    cell('proj-valid', ['DATES, BUDGET,', 'MEMBERS VALID?'], 'decision', 455, 1380, 190, 115),
    cell('proj-save', ['SAVE PROJECT', 'projects'], 'data', 465, 1560, 170, 80),
    cell('proj-soq', ['SERVICE ORDER', 'NEEDED?'], 'decision', 150, 1560, 170, 110),
    cell('proj-so', ['CREATE SERVICE ORDER', 'service_orders'], 'data', 125, 1740, 220, 85),
    cell('proj-procq', ['PROCUREMENT', 'NEEDED?'], 'decision', 770, 1560, 170, 110),
    cell('proj-pr', ['CREATE PR / PO', 'purchase_requisitions / purchase_orders'], 'data', 715, 1740, 280, 85),
    cell('proj-monitor', ['MONITOR PROJECT', 'tasks, costs, resources, documents'], 'data', 415, 1905, 270, 90),
    cell('proj-end', 'END', 'end', 490, 2070, 120, 65)
  );
  edges.push(
    edge('proj-e6', 'proj-module', 'proj-tabs'),
    edge('proj-e7', 'proj-tabs', 'proj-view'),
    edge('proj-e8', 'proj-view', 'proj-action'),
    edge('proj-e9', 'proj-action', 'proj-form', 'Yes'),
    edge('proj-e10', 'proj-action', 'proj-archive', 'No / Archive'),
    edge('proj-e11', 'proj-form', 'proj-company'),
    edge('proj-e12', 'proj-company', 'proj-valid', 'Yes'),
    edge('proj-e13', 'proj-company', 'proj-registry', 'No'),
    edge('proj-e14', 'proj-registry', 'proj-valid'),
    edge('proj-e15', 'proj-valid', 'proj-save', 'Valid'),
    edge('proj-e16', 'proj-valid', 'proj-form', 'Invalid / Revise'),
    edge('proj-e17', 'proj-save', 'proj-soq'),
    edge('proj-e18', 'proj-soq', 'proj-so', 'Yes'),
    edge('proj-e19', 'proj-soq', 'proj-monitor', 'No'),
    edge('proj-e20', 'proj-save', 'proj-procq'),
    edge('proj-e21', 'proj-procq', 'proj-pr', 'Yes'),
    edge('proj-e22', 'proj-procq', 'proj-monitor', 'No'),
    edge('proj-e23', 'proj-so', 'proj-monitor'),
    edge('proj-e24', 'proj-pr', 'proj-monitor'),
    edge('proj-e25', 'proj-archive', 'proj-end'),
    edge('proj-e26', 'proj-monitor', 'proj-end')
  );
  write('PROJECTS MODULE.drawio', 'PROJECTS MODULE CURRENT FLOW', 1200, 2200, nodes, edges);
}

{
  const { nodes, edges } = common('proc', 'PROCUREMENT');
  nodes.push(
    cell('proc-tabs', ['SELECT PROCUREMENT TAB', 'Vendors / PR / RFQ / Quotations / PO / Goods Receipts'], 'process', 365, 770, 360, 95),
    cell('proc-vendorq', ['VENDOR', 'EXISTS?'], 'decision', 455, 925, 170, 110),
    cell('proc-vendor', ['CREATE / UPDATE VENDOR', 'vendors'], 'data', 150, 935, 230, 85),
    cell('proc-pr', ['CREATE PURCHASE REQUISITION', 'purchase_requisitions + items'], 'data', 420, 1095, 260, 90),
    cell('proc-prvalid', ['PR COMPLETE?', 'Project + items + amount'], 'decision', 455, 1255, 180, 115),
    cell('proc-submit', 'SUBMIT PR', 'process', 455, 1430, 180, 75),
    cell('proc-approve', ['ADMIN', 'APPROVES PR?'], 'decision', 455, 1570, 180, 115),
    cell('proc-revise', 'REVISE / CANCEL PR', 'report', 160, 1585, 220, 80),
    cell('proc-rfq', ['CREATE RFQ / QUOTATIONS', 'procurement_quotations'], 'data', 405, 1745, 280, 90),
    cell('proc-quotes', ['ENOUGH', 'QUOTATIONS?'], 'decision', 455, 1910, 180, 115),
    cell('proc-addquote', 'ADD MORE QUOTES', 'process', 160, 1925, 210, 75),
    cell('proc-select', ['SELECT WINNING', 'QUOTE?'], 'decision', 455, 2085, 180, 115),
    cell('proc-po', ['CREATE PURCHASE ORDER', 'purchase_orders + po_line_items'], 'data', 415, 2260, 270, 90),
    cell('proc-poapprove', ['ADMIN', 'APPROVES PO?'], 'decision', 455, 2425, 180, 115),
    cell('proc-porevise', 'REVISE / CANCEL PO', 'report', 760, 2440, 220, 80),
    cell('proc-grnq', ['GOODS', 'RECEIVED?'], 'decision', 455, 2605, 180, 115),
    cell('proc-pending', 'PENDING RECEIPT', 'report', 155, 2620, 220, 80),
    cell('proc-grn', ['SAVE GOODS RECEIPT', 'goods_receipts + items'], 'data', 415, 2785, 270, 90),
    cell('proc-billq', ['GENERATE', 'AP BILL?'], 'decision', 455, 2950, 180, 115),
    cell('proc-ap', ['CREATE AP BILL', 'accounts_payable'], 'data', 735, 2965, 230, 85),
    cell('proc-end', 'END', 'end', 490, 3140, 120, 65)
  );
  edges.push(
    edge('proc-e6', 'proc-module', 'proc-tabs'),
    edge('proc-e7', 'proc-tabs', 'proc-vendorq'),
    edge('proc-e8', 'proc-vendorq', 'proc-pr', 'Yes'),
    edge('proc-e9', 'proc-vendorq', 'proc-vendor', 'No'),
    edge('proc-e10', 'proc-vendor', 'proc-pr'),
    edge('proc-e11', 'proc-pr', 'proc-prvalid'),
    edge('proc-e12', 'proc-prvalid', 'proc-submit', 'Yes'),
    edge('proc-e13', 'proc-prvalid', 'proc-pr', 'No / Revise'),
    edge('proc-e14', 'proc-submit', 'proc-approve'),
    edge('proc-e15', 'proc-approve', 'proc-rfq', 'Approved'),
    edge('proc-e16', 'proc-approve', 'proc-revise', 'Rejected'),
    edge('proc-e17', 'proc-rfq', 'proc-quotes'),
    edge('proc-e18', 'proc-quotes', 'proc-select', 'Yes'),
    edge('proc-e19', 'proc-quotes', 'proc-addquote', 'No'),
    edge('proc-e20', 'proc-addquote', 'proc-rfq'),
    edge('proc-e21', 'proc-select', 'proc-po', 'Yes'),
    edge('proc-e22', 'proc-select', 'proc-addquote', 'No'),
    edge('proc-e23', 'proc-po', 'proc-poapprove'),
    edge('proc-e24', 'proc-poapprove', 'proc-grnq', 'Approved'),
    edge('proc-e25', 'proc-poapprove', 'proc-porevise', 'Rejected'),
    edge('proc-e26', 'proc-grnq', 'proc-grn', 'Yes'),
    edge('proc-e27', 'proc-grnq', 'proc-pending', 'No'),
    edge('proc-e28', 'proc-grn', 'proc-billq'),
    edge('proc-e29', 'proc-billq', 'proc-ap', 'Yes'),
    edge('proc-e30', 'proc-billq', 'proc-end', 'No'),
    edge('proc-e31', 'proc-ap', 'proc-end')
  );
  write('PROCUREMENT MODULE.drawio', 'PROCUREMENT MODULE CURRENT FLOW', 1200, 3300, nodes, edges);
}

{
  const { nodes, edges } = common('ap', 'ACCOUNTS PAYABLE');
  nodes.push(
    cell('ap-tabs', ['SELECT AP TAB', 'Bills / Vendor Balances / AP Aging / Payments / Disbursements'], 'process', 365, 770, 360, 95),
    cell('ap-source', ['BILL FROM', 'APPROVED PO?'], 'decision', 455, 925, 180, 115),
    cell('ap-po', ['LOAD PO DETAILS', 'vendor, project, amount'], 'data', 140, 950, 230, 85),
    cell('ap-manual', ['MANUAL BILL ENTRY', 'vendor invoice + due date'], 'process', 735, 950, 240, 85),
    cell('ap-valid', ['BILL DATA', 'VALID?'], 'decision', 455, 1120, 180, 115),
    cell('ap-save', ['SAVE AP BILL', 'accounts_payable'], 'data', 455, 1300, 190, 80),
    cell('ap-due', ['DUE FOR', 'PAYMENT?'], 'decision', 455, 1455, 180, 115),
    cell('ap-aging', ['AP AGING / VENDOR BALANCES', 'pending / overdue'], 'report', 140, 1470, 260, 85),
    cell('ap-pay', ['RECORD PAYMENT', 'payments.ap_id'], 'data', 455, 1635, 190, 80),
    cell('ap-full', ['FULLY PAID?'], 'decision', 455, 1790, 180, 115),
    cell('ap-partial', ['PARTIAL PAYMENT', 'status = partially_paid'], 'report', 135, 1810, 250, 80),
    cell('ap-paid', ['MARK BILL PAID', 'status = paid'], 'data', 735, 1810, 220, 80),
    cell('ap-disb', ['DISBURSEMENT REPORT', 'payment history'], 'report', 435, 1985, 230, 85),
    cell('ap-end', 'END', 'end', 490, 2150, 120, 65)
  );
  edges.push(
    edge('ap-e6', 'ap-module', 'ap-tabs'),
    edge('ap-e7', 'ap-tabs', 'ap-source'),
    edge('ap-e8', 'ap-source', 'ap-po', 'Yes'),
    edge('ap-e9', 'ap-source', 'ap-manual', 'No'),
    edge('ap-e10', 'ap-po', 'ap-valid'),
    edge('ap-e11', 'ap-manual', 'ap-valid'),
    edge('ap-e12', 'ap-valid', 'ap-save', 'Yes'),
    edge('ap-e13', 'ap-valid', 'ap-manual', 'No / Revise'),
    edge('ap-e14', 'ap-save', 'ap-due'),
    edge('ap-e15', 'ap-due', 'ap-pay', 'Yes'),
    edge('ap-e16', 'ap-due', 'ap-aging', 'No'),
    edge('ap-e17', 'ap-aging', 'ap-end'),
    edge('ap-e18', 'ap-pay', 'ap-full'),
    edge('ap-e19', 'ap-full', 'ap-paid', 'Yes'),
    edge('ap-e20', 'ap-full', 'ap-partial', 'No'),
    edge('ap-e21', 'ap-partial', 'ap-aging'),
    edge('ap-e22', 'ap-paid', 'ap-disb'),
    edge('ap-e23', 'ap-disb', 'ap-end')
  );
  write('AP MODULE CURRENT.drawio', 'ACCOUNTS PAYABLE MODULE CURRENT FLOW', 1200, 2300, nodes, edges);
}

{
  const { nodes, edges } = common('ar', 'ACCOUNTS RECEIVABLE');
  nodes.push(
    cell('ar-tabs', ['SELECT AR TAB', 'Service Orders / Transactions / Receivables / Payments'], 'process', 365, 770, 360, 95),
    cell('ar-soq', ['SERVICE ORDER', 'NEEDED?'], 'decision', 455, 925, 180, 115),
    cell('ar-so', ['CREATE SERVICE ORDER', 'service_orders'], 'data', 140, 950, 230, 85),
    cell('ar-project', ['PROJECT / CUSTOMER', 'VALID?'], 'decision', 455, 1110, 180, 115),
    cell('ar-fix', ['FIX CUSTOMER / PROJECT', 'company_registry / projects'], 'process', 140, 1125, 240, 85),
    cell('ar-tx', ['CREATE / SYNC INVOICE', 'transactions'], 'data', 455, 1290, 210, 85),
    cell('ar-recv', ['CREATE RECEIVABLE', 'accounts_receivable'], 'data', 455, 1455, 210, 85),
    cell('ar-due', ['INVOICE', 'DUE / OVERDUE?'], 'decision', 455, 1615, 180, 115),
    cell('ar-follow', ['SEND FOLLOW-UP', 'status = overdue'], 'report', 140, 1635, 220, 80),
    cell('ar-pay', ['RECORD COLLECTION', 'payments.ar_id'], 'data', 455, 1795, 210, 85),
    cell('ar-full', ['FULLY PAID?'], 'decision', 455, 1960, 180, 115),
    cell('ar-partial', ['PARTIAL / SENT', 'remaining balance'], 'report', 140, 1980, 220, 80),
    cell('ar-paid', ['MARK PAID', 'AR + transaction status'], 'data', 735, 1980, 230, 80),
    cell('ar-report', ['AR REPORTS', 'collections + aging'], 'report', 435, 2150, 230, 85),
    cell('ar-end', 'END', 'end', 490, 2315, 120, 65)
  );
  edges.push(
    edge('ar-e6', 'ar-module', 'ar-tabs'),
    edge('ar-e7', 'ar-tabs', 'ar-soq'),
    edge('ar-e8', 'ar-soq', 'ar-so', 'Yes'),
    edge('ar-e9', 'ar-soq', 'ar-project', 'No / Existing'),
    edge('ar-e10', 'ar-so', 'ar-project'),
    edge('ar-e11', 'ar-project', 'ar-tx', 'Yes'),
    edge('ar-e12', 'ar-project', 'ar-fix', 'No'),
    edge('ar-e13', 'ar-fix', 'ar-project'),
    edge('ar-e14', 'ar-tx', 'ar-recv'),
    edge('ar-e15', 'ar-recv', 'ar-due'),
    edge('ar-e16', 'ar-due', 'ar-follow', 'Overdue'),
    edge('ar-e17', 'ar-due', 'ar-pay', 'Due / Collect'),
    edge('ar-e18', 'ar-follow', 'ar-pay'),
    edge('ar-e19', 'ar-pay', 'ar-full'),
    edge('ar-e20', 'ar-full', 'ar-paid', 'Yes'),
    edge('ar-e21', 'ar-full', 'ar-partial', 'No'),
    edge('ar-e22', 'ar-partial', 'ar-due'),
    edge('ar-e23', 'ar-paid', 'ar-report'),
    edge('ar-e24', 'ar-report', 'ar-end')
  );
  write('AR MODULE CURRENT.drawio', 'ACCOUNTS RECEIVABLE MODULE CURRENT FLOW', 1200, 2500, nodes, edges);
}

{
  const nodes = [
    cell('all-title', 'CURRENT ERP COMBINED FLOW CHART', 'title', 500, 20, 600, 45),
    cell('all-legend', ['Legend:', 'Blue = Process', 'Yellow = Decision', 'Orange = Database Record', 'Purple = Report'], 'note', 1225, 60, 230, 105),
    cell('all-start', 'START', 'start', 700, 90, 120, 65),
    cell('all-login', 'LOGIN', 'process', 695, 210, 130, 70),
    cell('all-role', ['ROLE', 'CHECK?'], 'decision', 710, 335, 110, 110),
    cell('all-denied', 'ACCESS DENIED', 'end', 450, 360, 150, 65),
    cell('all-dashboard', 'DASHBOARD', 'process', 680, 505, 160, 75),
    cell('all-moduleq', ['WHICH MODULE', 'WILL BE USED?'], 'decision', 685, 650, 170, 120),
    cell('all-project', ['PROJECTS', 'projects'], 'data', 100, 850, 210, 85),
    cell('all-need-so', ['SERVICE ORDER', 'NEEDED?'], 'decision', 120, 1015, 170, 110),
    cell('all-so', ['SERVICE ORDERS', 'service_orders'], 'data', 100, 1190, 220, 85),
    cell('all-tx', ['INVOICE TRANSACTION', 'transactions'], 'data', 100, 1360, 220, 85),
    cell('all-ar', ['ACCOUNTS RECEIVABLE', 'accounts_receivable'], 'data', 100, 1530, 240, 85),
    cell('all-arpaidq', ['CUSTOMER', 'PAID?'], 'decision', 130, 1700, 170, 110),
    cell('all-ar-pay', ['AR COLLECTION', 'payments.ar_id'], 'data', 100, 1880, 220, 85),
    cell('all-proc', ['PROCUREMENT', 'PR / RFQ / PO / GRN'], 'process', 620, 850, 280, 85),
    cell('all-prq', ['PURCHASE', 'NEEDED?'], 'decision', 670, 1015, 170, 110),
    cell('all-pr', ['PURCHASE REQUISITION', 'purchase_requisitions'], 'data', 620, 1190, 280, 85),
    cell('all-approveq', ['PR / PO', 'APPROVED?'], 'decision', 670, 1360, 170, 110),
    cell('all-po', ['PURCHASE ORDER', 'purchase_orders + items'], 'data', 620, 1530, 280, 85),
    cell('all-grnq', ['GOODS', 'RECEIVED?'], 'decision', 670, 1700, 170, 110),
    cell('all-grn', ['GOODS RECEIPT', 'goods_receipts'], 'data', 620, 1880, 280, 85),
    cell('all-ap', ['ACCOUNTS PAYABLE', 'accounts_payable'], 'data', 1135, 1530, 250, 85),
    cell('all-appaidq', ['VENDOR', 'PAID?'], 'decision', 1175, 1700, 170, 110),
    cell('all-ap-pay', ['AP PAYMENT', 'payments.ap_id'], 'data', 1135, 1880, 220, 85),
    cell('all-reports', ['REPORTS / DASHBOARD', 'Projects, Procurement, AR, AP'], 'report', 620, 2100, 300, 90),
    cell('all-end', 'END', 'end', 700, 2280, 120, 65)
  ];
  const edges = [
    edge('all-e1', 'all-start', 'all-login'),
    edge('all-e2', 'all-login', 'all-role'),
    edge('all-e3', 'all-role', 'all-dashboard', 'Admin'),
    edge('all-e4', 'all-role', 'all-denied', 'No access'),
    edge('all-e5', 'all-dashboard', 'all-moduleq'),
    edge('all-e6', 'all-moduleq', 'all-project', 'Projects / AR'),
    edge('all-e7', 'all-project', 'all-need-so'),
    edge('all-e8', 'all-need-so', 'all-so', 'Yes'),
    edge('all-e9', 'all-need-so', 'all-tx', 'No'),
    edge('all-e10', 'all-so', 'all-tx'),
    edge('all-e11', 'all-tx', 'all-ar'),
    edge('all-e12', 'all-ar', 'all-arpaidq'),
    edge('all-e13', 'all-arpaidq', 'all-ar-pay', 'Yes / Partial'),
    edge('all-e14', 'all-arpaidq', 'all-reports', 'No / Aging'),
    edge('all-e15', 'all-ar-pay', 'all-reports'),
    edge('all-e16', 'all-moduleq', 'all-proc', 'Procurement'),
    edge('all-e17', 'all-project', 'all-prq', 'Project request'),
    edge('all-e18', 'all-proc', 'all-prq'),
    edge('all-e19', 'all-prq', 'all-pr', 'Yes'),
    edge('all-e20', 'all-prq', 'all-reports', 'No'),
    edge('all-e21', 'all-pr', 'all-approveq'),
    edge('all-e22', 'all-approveq', 'all-po', 'Approved'),
    edge('all-e23', 'all-approveq', 'all-reports', 'Rejected / Cancelled'),
    edge('all-e24', 'all-po', 'all-grnq'),
    edge('all-e25', 'all-grnq', 'all-grn', 'Yes'),
    edge('all-e26', 'all-grnq', 'all-reports', 'Pending'),
    edge('all-e27', 'all-grn', 'all-ap'),
    edge('all-e28', 'all-ap', 'all-appaidq'),
    edge('all-e29', 'all-appaidq', 'all-ap-pay', 'Yes / Partial'),
    edge('all-e30', 'all-appaidq', 'all-reports', 'No / Aging'),
    edge('all-e31', 'all-ap-pay', 'all-reports'),
    edge('all-e32', 'all-reports', 'all-end')
  ];
  write('CURRENT ERP FLOW - COMBINED.drawio', 'CURRENT ERP COMBINED FLOW', 1500, 2450, nodes, edges);
}

console.log('Generated polished draw.io flowcharts with decision branches.');
