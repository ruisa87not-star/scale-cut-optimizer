import XLSX from 'xlsx-js-style';
import { normalizeLanguage, translateReportText } from './localization.js';
import { createLengthColours, sortCuttingResult } from './planPresentation.js';

const palette = {
  navy: '#12395A',
  blue: '#2E78A6',
  teal: '#13877B',
  mint: '#DDF4EF',
  sky: '#E7F1FA',
  amber: '#F5B942',
  amberLight: '#FFF3D6',
  red: '#C85E52',
  redLight: '#FDECEA',
  green: '#478E6B',
  greenLight: '#E8F4EC',
  slate: '#53687D',
  line: '#D9E4EE',
  pale: '#F5F8FB',
  remainder: '#E7EDF3',
  white: '#FFFFFF',
};

const productColours = ['#3979B8', '#8B61B4', '#2E9B83', '#D37A45', '#B55C85', '#5B8EA7'];

const baseFont = { name: 'Aptos', sz: 10, color: { rgb: '20384F' } };
const border = { top: { style: 'thin', color: { rgb: 'D9E4EE' } }, bottom: { style: 'thin', color: { rgb: 'D9E4EE' } }, left: { style: 'thin', color: { rgb: 'D9E4EE' } }, right: { style: 'thin', color: { rgb: 'D9E4EE' } } };
const numberFormat = '#,##0';

function style(fill, font = {}, extra = {}) {
  return {
    font: { ...baseFont, ...font },
    fill: { patternType: 'solid', fgColor: { rgb: fill.replace('#', '') } },
    alignment: { vertical: 'center', ...extra.alignment },
    border: extra.border ?? border,
    numFmt: extra.numFmt,
  };
}

const styles = {
  blank: style(palette.white, {}, { border: {} }),
  title: style(palette.navy, { bold: true, sz: 20, color: { rgb: 'FFFFFF' } }, { alignment: { horizontal: 'left' }, border: { bottom: { style: 'medium', color: { rgb: '0D2B44' } } } }),
  subtitle: style(palette.navy, { color: { rgb: 'D8E8F3' }, sz: 10 }, { alignment: { horizontal: 'left' }, border: { bottom: { style: 'medium', color: { rgb: '0D2B44' } } } }),
  section: style(palette.blue, { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 }, { alignment: { horizontal: 'left' } }),
  header: style(palette.navy, { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 }, { alignment: { horizontal: 'center', wrapText: true } }),
  cardLabel: style(palette.pale, { bold: true, color: { rgb: '52667D' } }, { alignment: { horizontal: 'center', wrapText: true } }),
  cardValue: style(palette.white, { bold: true, sz: 18, color: { rgb: '12395A' } }, { alignment: { horizontal: 'center' }, numFmt: numberFormat }),
  label: style(palette.pale, { bold: true, color: { rgb: '52667D' } }, { alignment: { horizontal: 'left' } }),
  value: style(palette.white, {}, { alignment: { horizontal: 'right' }, numFmt: numberFormat }),
  text: style(palette.white, {}, { alignment: { horizontal: 'left', wrapText: true } }),
  number: style(palette.white, {}, { alignment: { horizontal: 'right' }, numFmt: numberFormat }),
  note: style(palette.mint, { color: { rgb: '236C65' }, italic: true }, { alignment: { horizontal: 'left', wrapText: true } }),
  recoverable: style(palette.greenLight, { bold: true, color: { rgb: '347054' } }, { alignment: { horizontal: 'center' } }),
  visualRecoverable: style(palette.amberLight, { bold: true, color: { rgb: '80500E' } }, { alignment: { horizontal: 'center' } }),
  scrap: style(palette.redLight, { bold: true, color: { rgb: 'A5443C' } }, { alignment: { horizontal: 'center' } }),
  perfect: style(palette.mint, { bold: true, color: { rgb: '236C65' } }, { alignment: { horizontal: 'center' } }),
  unused: style(palette.remainder, { bold: true, color: { rgb: '64758B' } }, { alignment: { horizontal: 'center' } }),
};

function cellRef(row, col) {
  return XLSX.utils.encode_cell({ r: row, c: col });
}

function put(ws, row, col, value, cellStyle = styles.text) {
  ws[cellRef(row, col)] = {
    t: typeof value === 'number' ? 'n' : 's',
    v: value,
    s: cellStyle,
  };
  const next = { s: { r: 0, c: 0 }, e: { r: row, c: col } };
  if (ws['!ref']) {
    const current = XLSX.utils.decode_range(ws['!ref']);
    next.e.r = Math.max(current.e.r, row);
    next.e.c = Math.max(current.e.c, col);
  }
  ws['!ref'] = XLSX.utils.encode_range(next);
}

function merge(ws, row, firstCol, lastCol) {
  ws['!merges'] ||= [];
  ws['!merges'].push({ s: { r: row, c: firstCol }, e: { r: row, c: lastCol } });
}

function fillGaps(ws, lastRow, lastCol) {
  for (let row = 0; row <= lastRow; row += 1) {
    for (let col = 0; col <= lastCol; col += 1) {
      if (!ws[cellRef(row, col)]) put(ws, row, col, '', styles.blank);
    }
  }
}

function mergedValue(ws, row, firstCol, lastCol, value, cellStyle) {
  put(ws, row, firstCol, value, cellStyle);
  for (let col = firstCol + 1; col <= lastCol; col += 1) put(ws, row, col, '', cellStyle);
  if (lastCol > firstCol) merge(ws, row, firstCol, lastCol);
}

function newSheet(name, widths) {
  const ws = {};
  ws['!cols'] = widths.map((width) => ({ wch: width }));
  ws['!rows'] = [];
  ws['!merges'] = [];
  ws['!sheetViews'] = [{ showGridLines: false }];
  return ws;
}

function number(value) {
  return new Intl.NumberFormat('zh-TW').format(value || 0);
}

function displaySpecification({ length, start = 0, end = 0 }) {
  return start || end ? `${number(length)}-${start}/${end}` : number(length);
}

function cutBreakdown(order, segmentSize) {
  if (!order.start && !order.end) return `${number(order.length)}（完整裁切）`;
  const innerSections = (order.length - order.start - order.end) / segmentSize;
  return `${order.start} ｜ ${number(segmentSize)} × ${number(innerSections)} ｜ ${order.end}`;
}

function groupCuts(items = []) {
  const groups = new Map();
  items.forEach((length) => {
    const existing = groups.get(length) || { length, count: 0 };
    existing.count += 1;
    groups.set(length, existing);
  });
  return [...groups.values()];
}

function cutInstruction(items = []) {
  return groupCuts(items).map(({ length, count }) => `${number(length)} × ${number(count)}`).join(' ＋ ') || '未使用';
}

function productCutInstruction(orders) {
  return orders.map((order) => `${displaySpecification(order)} × ${number(order.quantity)}`).join('；');
}

// In pitch mode the C++ engine returns two views of the same run: a product
// recipe and a physical 50 mm pitch plan.  Keep the product label here so the
// operator sees the exact specification they entered (for example 940-20/20),
// rather than an anonymous number of pitch sections.
function productLabelForLength(length, orders) {
  const matches = orders.filter((order) => Number(order.length) === Number(length));
  return matches.length === 1 ? displaySpecification(matches[0]) : number(length);
}

function productBinInstruction(bin, orders) {
  const products = groupCuts(bin.items)
    .map(({ length, count }) => `${productLabelForLength(length, orders)} × ${number(count)}`)
    .join(' ＋ ') || '未使用';
  const sequences = (bin.sequenceDetails || []).map((sequence) => {
    const items = [
      `${number(sequence.leftScrap ?? 0)}（端段補位）`,
      ...sequence.items.map((length) => productLabelForLength(length, orders)),
      `${number(sequence.rightScrap ?? 0)}（端段補位）`,
    ].join(' → ');
    return `${items}（端段碎料 ${number(sequence.edgeScrap)}）`;
  });
  const layout = (bin.layoutSegments || []).map((segment) => segment.kind === 'edgeScrap'
    ? `${number(segment.length)}（端段補位）`
    : productLabelForLength(segment.length, orders)).join(' ＋ ');
  if (layout) return `${products}\n實際物理順序：${layout}`;
  return sequences.length ? `${products}\n實際串接：${sequences.join('；')}` : products;
}

function productVisualSegments(bin, threshold, orders, colours = createLengthColours(orders)) {
  if (bin.layoutSegments?.length) {
    const groups = bin.layoutSegments.map((segment) => ({
      // The band is the physical sequence, so show the physical length itself
      // on every segment. Full specifications and instructions remain in the
      // Cut Recipes sheet; they do not fit on narrow 20 / 30 / 160 cells.
      label: number(segment.length),
      kind: segment.kind,
      length: segment.length,
      fill: segment.kind === 'edgeScrap' ? palette.amber : colours.get(segment.length).fill,
      text: segment.kind === 'edgeScrap' ? '#172E3B' : colours.get(segment.length).text,
    }));
    if (bin.remainder) {
      groups.push({
        label: `餘料 ${number(bin.remainder)}`,
        kind: 'remainder',
        length: bin.remainder,
        fill: bin.remainder >= threshold ? palette.green : palette.remainder,
      });
    }
    return groups;
  }
  const groups = (bin.items || []).map((length) => ({
    label: number(length),
    kind: 'product',
    length,
    fill: colours.get(length).fill,
    text: colours.get(length).text,
  }));
  if (bin.edgeScrap) {
    groups.push({
      label: `端段碎料 ${number(bin.edgeScrap)}`,
      kind: 'edgeScrap',
      length: bin.edgeScrap,
      fill: palette.amber,
    });
  }
  if (bin.remainder) {
    groups.push({
      label: `餘料 ${number(bin.remainder)}`,
      kind: 'remainder',
      length: bin.remainder,
      fill: bin.remainder >= threshold ? palette.green : palette.remainder,
    });
  }
  return groups;
}

function combinePairs(pairs = []) {
  const result = new Map();
  pairs.forEach(({ left, right, count }) => {
    const low = Math.min(left, right);
    const high = Math.max(left, right);
    const key = `${low}|${high}`;
    result.set(key, { left: low, right: high, count: (result.get(key)?.count || 0) + count });
  });
  return [...result.values()];
}

function binDetail(bin, segmentSize) {
  if (bin.pairedSections === undefined) return cutInstruction(bin.items);
  const pairs = combinePairs(bin.pairDetails).map((pair) => `${pair.left} + ${pair.right} × ${number(pair.count)}`);
  const singles = (bin.singleDetails || []).map((item) => `端段 ${item.value} × ${number(item.count)}`);
  const full = bin.fullSections ? `完整 ${number(segmentSize)} 節 × ${number(bin.fullSections)}` : '';
  return [...pairs, full, ...singles].filter(Boolean).join('；') || '未使用';
}

function binPairDetail(bin) {
  return combinePairs(bin.pairDetails).map((pair) => `${pair.left} + ${pair.right} × ${number(pair.count)}`).join('；') || '—';
}

function binSingleDetail(bin) {
  return (bin.singleDetails || []).map((item) => `端段 ${item.value} × ${number(item.count)}`).join('；') || '—';
}

function binStatus(bin, threshold) {
  const occupied = bin.pairedSections !== undefined ? bin.used > 0 : bin.items?.length > 0;
  if (!occupied) return { label: '保留庫存', cellStyle: styles.unused };
  if (!bin.remainder) return { label: '完美使用', cellStyle: styles.perfect };
  if (bin.remainder >= threshold) return { label: '可回收', cellStyle: styles.recoverable };
  return { label: '不可回收碎料', cellStyle: styles.scrap };
}

function normalColour(item) {
  const hash = String(item).split('').reduce((total, digit) => total + digit.charCodeAt(0), 0);
  return productColours[hash % productColours.length];
}

function groupedVisualSegments(bin, segmentSize, threshold) {
  const groups = [];
  const push = (label, length, fill) => {
    if (!length) return;
    const previous = groups.at(-1);
    if (previous?.label === label && previous.fill === fill) previous.length += length;
    else groups.push({ label, length, fill });
  };
  if (bin.pairedSections === undefined) {
    groupCuts(bin.items).forEach(({ length, count }) => push(`${number(length)} × ${number(count)}`, length * count, normalColour(length)));
  } else {
    combinePairs(bin.pairDetails).forEach((pair) => push(`${pair.left}+${pair.right} × ${number(pair.count)}`, pair.count * segmentSize, palette.teal));
    if (bin.fullSections) push(`完整 ${number(segmentSize)} × ${number(bin.fullSections)}`, bin.fullSections * segmentSize, palette.blue);
    (bin.singleDetails || []).forEach((single) => push(`端段 ${single.value}`, single.count * segmentSize, palette.amber));
  }
  if (bin.remainder) push(bin.remainder >= threshold ? '可回收餘料' : '碎料', bin.remainder, bin.remainder >= threshold ? palette.green : palette.remainder);
  return groups;
}

function visualWidths(groups, capacity, slots) {
  if (!groups.length) return [];
  const widths = groups.map((group) => Math.max(1, Math.round((group.length / capacity) * slots)));
  let difference = slots - widths.reduce((sum, width) => sum + width, 0);
  const order = groups.map((group, index) => ({ index, length: group.length })).sort((left, right) => right.length - left.length);
  let cursor = 0;
  while (difference !== 0 && cursor < order.length * slots * 2) {
    const index = order[cursor % order.length].index;
    if (difference > 0) { widths[index] += 1; difference -= 1; }
    else if (widths[index] > 1) { widths[index] -= 1; difference += 1; }
    cursor += 1;
  }
  return widths;
}

function writeTitle(ws, title, subtitle, lastCol) {
  mergedValue(ws, 0, 0, lastCol, title, styles.title);
  mergedValue(ws, 1, 0, lastCol, subtitle, styles.subtitle);
  ws['!rows'][0] = { hpt: 31 };
  ws['!rows'][1] = { hpt: 21 };
}

function writeSummarySheet({ capacity, threshold, segmentSize, orders, offcuts, result, language }) {
  const ws = newSheet('總覽', [20, 16, 4, 20, 16, 4, 20, 16, 4, 20, 16, 4]);
  writeTitle(ws, '卷材裁切優化報告', `React 介面 · C++ 排料引擎 · 匯出時間 ${new Date().toLocaleString(language === 'en' ? 'en-GB' : 'zh-TW')}`, 11);
  mergedValue(ws, 3, 0, 11, '生產設定', styles.section);
  const settings = [['新卷標準長度', capacity], ['可回收門檻', threshold], ['節距', segmentSize], ['訂單件數', result.summary.itemCount]];
  settings.forEach(([label, value], index) => {
    const start = index * 3;
    mergedValue(ws, 4, start, start + 1, label, styles.label);
    mergedValue(ws, 5, start, start + 1, value, styles.value);
  });

  mergedValue(ws, 7, 0, 11, '本次最佳化結果', styles.section);
  const metrics = [
    ['需開新卷', result.summary.newRolls, '卷'],
    ['不可回收碎料', result.summary.deadScrapLength, '長度'],
    ['可回收餘料', result.summary.recoverableRemainder, '長度'],
    ['已用既有餘料', result.summary.offcutConsumed, '長度'],
  ];
  metrics.forEach(([label, value, unit], index) => {
    const start = index * 3;
    mergedValue(ws, 8, start, start + 1, label, styles.cardLabel);
    mergedValue(ws, 9, start, start + 1, value, styles.cardValue);
    mergedValue(ws, 10, start, start + 1, unit, styles.cardLabel);
  });
  ws['!rows'][8] = { hpt: 22 };
  ws['!rows'][9] = { hpt: 35 };

  mergedValue(ws, 12, 0, 11, '訂單摘要', styles.section);
  const headers = ['規格', '數量', '訂單總長', '切段說明', '備註'];
  [0, 2, 4, 6, 9].forEach((start, index) => mergedValue(ws, 13, start, index === 4 ? 11 : start + 1, headers[index], styles.header));
  orders.forEach((order, index) => {
    const row = 14 + index;
    mergedValue(ws, row, 0, 1, displaySpecification(order), styles.text);
    mergedValue(ws, row, 2, 3, order.quantity, styles.number);
    mergedValue(ws, row, 4, 5, order.length * order.quantity, styles.number);
    mergedValue(ws, row, 6, 8, cutBreakdown(order, segmentSize), styles.text);
    mergedValue(ws, row, 9, 11, order.start || order.end ? '含端段對接規則' : '一般裁切', styles.text);
  });
  const noteRow = 15 + orders.length;
  mergedValue(ws, noteRow, 0, 11, result.sectionPlan
    ? `節距對接：${combinePairs(result.sectionPlan.pairs).map((pair) => `${pair.left} + ${pair.right} = ${segmentSize} × ${number(pair.count)}`).join('；')}。僅在卷材中段進行對接。`
    : `現有餘料庫存：${number(offcuts.length)} 段，合計 ${number(offcuts.reduce((sum, value) => sum + value, 0))} 長度。`, styles.note);
  ws['!rows'][noteRow] = { hpt: 30 };
  ws['!autofilter'] = { ref: `A14:L${Math.max(14, noteRow - 1)}` };
  fillGaps(ws, noteRow, 11);
  return ws;
}

function writeDetailSheet({ threshold, segmentSize, orders, result }) {
  const ws = newSheet('排料明細', [11, 12, 44, 28, 17, 20, 15, 15, 16]);
  writeTitle(ws, '裁切與餘料明細', '每列先列出要裁切的成品長度；特殊規格則另列中段對接與完整節配置。', 8);
  mergedValue(ws, 3, 0, 8, `本次成品裁切指令：${productCutInstruction(orders)}`, styles.note);
  const headers = ['來源', '原始長度', '實際裁切內容', '中段對接', '完整節', '未配對端段', '已用長度', '剩餘長度', '狀態'];
  headers.forEach((header, index) => put(ws, 5, index, header, styles.header));
  const entries = [
    ...result.newBins.map((bin, index) => ({ label: `新卷 #${index + 1}`, bin })),
    ...result.offcuts.map((bin, index) => ({ label: `餘料 #${index + 1}`, bin })),
  ];
  entries.forEach(({ label, bin }, index) => {
    const row = 6 + index;
    const state = binStatus(bin, threshold);
    put(ws, row, 0, label, styles.text);
    put(ws, row, 1, bin.capacity, styles.number);
    put(ws, row, 2, binDetail(bin, segmentSize), styles.text);
    put(ws, row, 3, bin.pairedSections === undefined ? '—' : binPairDetail(bin), styles.text);
    put(ws, row, 4, bin.pairedSections === undefined ? '—' : `完整 ${number(segmentSize)} 節 × ${number(bin.fullSections || 0)}`, styles.text);
    put(ws, row, 5, bin.pairedSections === undefined ? '—' : binSingleDetail(bin), styles.text);
    put(ws, row, 6, bin.used, styles.number);
    put(ws, row, 7, bin.remainder, styles.number);
    put(ws, row, 8, state.label, state.cellStyle);
    ws['!rows'][row] = { hpt: 31 };
  });
  ws['!autofilter'] = { ref: `A6:I${Math.max(6, entries.length + 5)}` };
  ws['!freeze'] = { xSplit: 0, ySplit: 6 };
  fillGaps(ws, Math.max(6, entries.length + 5), 8);
  return ws;
}

function writeVisualSheet({ capacity, threshold, segmentSize, orders, result }) {
  const slots = 30;
  const ws = newSheet('視覺排料', [15, ...Array(slots).fill(3.5), 4, 22, 32]);
  writeTitle(ws, '視覺排料圖', '每條色帶顯示本卷要裁切的長度與數量；特殊規格則同時標示節距對接方式。', slots + 3);
  mergedValue(ws, 3, 0, slots + 3, `本次成品裁切指令：${productCutInstruction(orders)}`, styles.note);
  const legendRow = 5;
  const legends = [
    ['一般裁切', productColours[0]],
    ['中段對接', palette.teal],
    ['完整節', palette.blue],
    ['未配對端段', palette.amber],
    ['可回收餘料', palette.green],
    ['碎料', palette.remainder],
  ];
  legends.forEach(([label, fill], index) => {
    const col = index * 5;
    put(ws, legendRow, col, '', style(fill, {}, { alignment: { horizontal: 'center' } }));
    mergedValue(ws, legendRow, col + 1, col + 3, label, styles.text);
  });
  let row = 7;
  const entries = [
    ...result.newBins.map((bin, index) => ({ label: `新卷 #${index + 1}`, bin })),
    ...result.offcuts.filter((bin) => bin.used > 0).map((bin, index) => ({ label: `已用餘料 #${index + 1}`, bin })),
  ];
  entries.forEach(({ label, bin }) => {
    const state = binStatus(bin, threshold);
    put(ws, row, 0, label, styles.header);
    const groups = groupedVisualSegments(bin, segmentSize, threshold);
    const widths = visualWidths(groups, bin.capacity || capacity, slots);
    let cursor = 1;
    groups.forEach((group, index) => {
      const width = widths[index];
      const segmentStyle = style(group.fill, { bold: width >= 2, color: { rgb: group.fill === palette.remainder ? '53687D' : 'FFFFFF' } }, { alignment: { horizontal: 'center', wrapText: true } });
      for (let slot = 0; slot < width; slot += 1) put(ws, row, cursor + slot, '', segmentStyle);
      if (width >= 2) mergedValue(ws, row, cursor, cursor + width - 1, group.label, segmentStyle);
      cursor += width;
    });
    while (cursor <= slots) { put(ws, row, cursor, '', style(palette.white)); cursor += 1; }
    put(ws, row, slots + 2, `使用 ${number(bin.used)} / ${number(bin.capacity)}`, styles.number);
    put(ws, row, slots + 3, state.label, state.cellStyle);
    put(ws, row + 1, 0, '裁切內容', styles.label);
    mergedValue(ws, row + 1, 1, slots, binDetail(bin, segmentSize), styles.text);
    put(ws, row + 1, slots + 2, `剩餘 ${number(bin.remainder)}`, styles.number);
    ws['!rows'][row] = { hpt: 27 };
    ws['!rows'][row + 1] = { hpt: 27 };
    row += 3;
  });
  if (!entries.length) mergedValue(ws, row, 0, slots + 3, '本次沒有需要顯示的排料。', styles.note);
  ws['!freeze'] = { xSplit: 1, ySplit: 7 };
  fillGaps(ws, Math.max(row + (entries.length ? -1 : 0), 9), slots + 3);
  return ws;
}

function writeProductDetailSheet({ threshold, orders, result }) {
  const ws = newSheet('成品裁切配方', [11, 12, 52, 15, 15, 17, 18]);
  writeTitle(ws, '成品裁切配方', '每卷清楚列出要裁的成品規格、實際特殊規格串接順序，以及端段造成的實體碎料。', 6);
  const hasPitchPlan = Boolean(result.sectionPlan);
  mergedValue(ws, 3, 0, 6, hasPitchPlan
    ? '注意：端段碎料已計入「實體佔用」，而非當作可用餘量。每段「實際串接」只在同一卷中相鄰的 20 / 30 端段對接。'
    : '本頁為每卷實際要裁的成品長度與數量。', styles.note);
  const headers = ['來源', '原始長度', '本卷成品裁切內容', '成品合計', '端段碎料', '實體餘量', '狀態'];
  headers.forEach((header, index) => put(ws, 5, index, header, styles.header));
  const productBins = result.productBins || result.newBins;
  const productOffcuts = result.productOffcuts || result.offcuts;
  const entries = [
    ...productBins.map((bin, index) => ({ label: `新卷 #${index + 1}`, bin })),
    ...productOffcuts.map((bin, index) => ({ label: `餘料 #${index + 1}`, bin })),
  ];
  entries.forEach(({ label, bin }, index) => {
    const row = 6 + index;
    const state = binStatus(bin, threshold);
    put(ws, row, 0, label, styles.text);
    put(ws, row, 1, bin.capacity, styles.number);
    put(ws, row, 2, productBinInstruction(bin, orders), styles.text);
    put(ws, row, 3, bin.productLength ?? bin.used, styles.number);
    put(ws, row, 4, bin.edgeScrap || 0, styles.number);
    put(ws, row, 5, bin.remainder, styles.number);
    put(ws, row, 6, state.label, state.cellStyle);
    ws['!rows'][row] = { hpt: (bin.sequenceDetails || []).length ? 48 : 31 };
  });
  ws['!autofilter'] = { ref: `A6:G${Math.max(6, entries.length + 5)}` };
  ws['!freeze'] = { xSplit: 0, ySplit: 6 };
  fillGaps(ws, Math.max(6, entries.length + 5), 6);
  return ws;
}

function writeProductVisualSheet({ capacity, threshold, orders, result }) {
  const colours = createLengthColours(orders);
  const productBins = result.productBins || result.newBins;
  const productOffcuts = result.productOffcuts || result.offcuts;
  const entries = [
    ...productBins.map((bin, index) => ({ label: `新卷 #${index + 1}`, bin })),
    ...productOffcuts.map((bin, index) => ({ label: `已用餘料 #${index + 1}`, bin })).filter(({ bin }) => bin.used > 0),
  ];
  // One physical cut per cell, including repeated lengths. Long rolls wrap to
  // continuation rows instead of exceeding Excel's column limit or hiding cuts.
  const slots = Math.max(12, Math.min(24, Math.max(0, ...entries.map(({ bin }) => productVisualSegments(bin, threshold, orders, colours).length))));
  const ws = newSheet('視覺成品排料', [15, ...Array(slots).fill(10), 4, 22, 24]);
  writeTitle(ws, '視覺成品排料圖', '每個 Cell 代表一個實際裁切段；相同長度逐件列出，最後一格顯示餘料長度。', slots + 3);
  mergedValue(ws, 3, 0, slots + 3, '每格等寬，不代表長度比例。20 / 30 端段補位以橙色獨立列出；超過一行的裁切會接續下一行，不省略任何長度。', styles.note);
  let row = 5;
  entries.forEach(({ label, bin }) => {
    const state = binStatus(bin, threshold);
    const groups = productVisualSegments(bin, threshold, orders, colours);
    const lines = Math.max(1, Math.ceil(groups.length / slots));
    for (let line = 0; line < lines; line += 1) {
      put(ws, row + line, 0, line === 0 ? label : `續行 ${line + 1}`, styles.header);
      groups.slice(line * slots, (line + 1) * slots).forEach((group, index) => {
        const segmentStyle = style(group.fill, { bold: true, sz: 10, color: { rgb: group.text ? group.text.replace('#','') : group.fill === palette.remainder ? '53687D' : 'FFFFFF' } }, { alignment: { horizontal: 'center', wrapText: true }, numFmt: numberFormat });
        put(ws, row + line, index + 1, group.kind === 'remainder' ? group.label : group.length, segmentStyle);
      });
      ws['!rows'][row + line] = { hpt: 30 };
    }
    put(ws, row, slots + 2, `實體 ${number(bin.used)} / ${number(bin.capacity)}`, styles.number);
    put(ws, row, slots + 3, state.label, state.label === '可回收' ? styles.visualRecoverable : state.cellStyle);
    row += lines;
  });
  if (!entries.length) mergedValue(ws, row, 0, slots + 3, '本次沒有需要顯示的排料。', styles.note);
  ws['!freeze'] = { xSplit: 1, ySplit: 5 };
  fillGaps(ws, Math.max(row + (entries.length ? -1 : 0), 5), slots + 3);
  return ws;
}

// This is deliberately calculated from the same physical layout segments used
// by the visual sheet, rather than copied from the input order.  It gives the
// operator a printable quantity check for what the optimiser actually placed
// on the rolls, including every visible 20/30 end filler.
function actualLayoutSummary({ threshold, orders, result }) {
  const productBins = result.productBins || result.newBins;
  const productOffcuts = result.productOffcuts || result.offcuts;
  const entries = [
    ...productBins.map((bin, index) => ({ label: `新卷 #${index + 1}`, bin })),
    ...productOffcuts.map((bin, index) => ({ label: `已用餘料 #${index + 1}`, bin })).filter(({ bin }) => bin.used > 0),
  ];
  const products = new Map();
  const edgeFillers = new Map();
  const remainders = new Map();
  const add = (map, length, quantity = 1) => {
    const previous = map.get(length) || { length, quantity: 0 };
    previous.quantity += quantity;
    map.set(length, previous);
  };
  entries.forEach(({ bin }) => {
    if (bin.layoutSegments?.length) {
      bin.layoutSegments.forEach((segment) => {
        if (segment.kind === 'edgeScrap') add(edgeFillers, segment.length);
        else add(products, segment.length);
      });
    } else {
      (bin.items || []).forEach((length) => add(products, length));
      if (bin.edgeScrap) add(edgeFillers, bin.edgeScrap);
    }
    if (bin.remainder) add(remainders, bin.remainder);
  });
  return {
    entries,
    products: [...products.values()].sort((left, right) => right.length - left.length),
    edgeFillers: [...edgeFillers.values()].sort((left, right) => left.length - right.length),
    recoverable: [...remainders.values()]
      .filter((item) => item.length >= threshold)
      .sort((left, right) => left.length - right.length),
    smallRemainders: [...remainders.values()]
      .filter((item) => item.length > 0 && item.length < threshold)
      .sort((left, right) => left.length - right.length),
  };
}

function writeActualCutCountSheet({ threshold, orders, result }) {
  const ws = newSheet('實際裁切數量', [24, 15, 17, 17, 15, 18, 16]);
  writeTitle(ws, '實際裁切數量', '依「視覺成品排料」的實體版面逐段統計；此頁用作現場剪料數量與訂單的核對表。', 6);
  const actual = actualLayoutSummary({ threshold, orders, result });
  const actualByLength = new Map(actual.products.map((item) => [Number(item.length), item.quantity]));
  const expectedByLength = new Map();
  orders.forEach((order) => expectedByLength.set(Number(order.length), (expectedByLength.get(Number(order.length)) || 0) + Number(order.quantity)));
  const actualPieces = actual.products.reduce((sum, item) => sum + item.quantity, 0);
  const completeRows = orders.filter((order) => (actualByLength.get(Number(order.length)) || 0) === Number(order.quantity)).length;
  mergedValue(ws, 3, 0, 6,
    `共剪出 ${number(actualPieces)} 件成品；${number(completeRows)} / ${number(orders.length)} 種規格與訂單數量吻合。端段補位與餘料會在下方獨立列示，不會混入成品件數。`, styles.note);

  mergedValue(ws, 5, 0, 6, '一、成品實際裁切數量（由 Visual Layout 的成品段統計）', styles.section);
  ['成品規格', '完成長度', '實際剪出', '訂單要求', '差異', '成品總長', '核對'].forEach((header, index) => put(ws, 6, index, header, styles.header));
  orders.forEach((order, index) => {
    const row = 7 + index;
    const actualQuantity = actualByLength.get(Number(order.length)) || 0;
    const difference = actualQuantity - Number(order.quantity);
    put(ws, row, 0, displaySpecification(order), styles.text);
    put(ws, row, 1, order.length, styles.number);
    put(ws, row, 2, actualQuantity, styles.number);
    put(ws, row, 3, order.quantity, styles.number);
    put(ws, row, 4, difference, styles.number);
    put(ws, row, 5, actualQuantity * order.length, styles.number);
    put(ws, row, 6, difference === 0 ? '數量吻合' : '請檢查', difference === 0 ? styles.perfect : styles.scrap);
  });
  const productEndRow = 7 + orders.length;
  const productActualLength = actual.products.reduce((sum, item) => sum + item.length * item.quantity, 0);
  mergedValue(ws, productEndRow, 0, 1, '成品合計', styles.label);
  put(ws, productEndRow, 2, actualPieces, styles.number);
  put(ws, productEndRow, 3, orders.reduce((sum, order) => sum + Number(order.quantity), 0), styles.number);
  put(ws, productEndRow, 4, actualPieces - orders.reduce((sum, order) => sum + Number(order.quantity), 0), styles.number);
  put(ws, productEndRow, 5, productActualLength, styles.number);
  put(ws, productEndRow, 6, actualPieces === orders.reduce((sum, order) => sum + Number(order.quantity), 0) ? '全部吻合' : '請檢查', actualPieces === orders.reduce((sum, order) => sum + Number(order.quantity), 0) ? styles.perfect : styles.scrap);

  let row = productEndRow + 3;
  mergedValue(ws, row, 0, 6, '二、Visual Layout 的非成品段（端段補位與餘料）', styles.section);
  row += 1;
  ['類別', '版面標示', '單段長度', '數量', '實體總長', '處理方式', '說明'].forEach((header, index) => put(ws, row, index, header, styles.header));
  row += 1;
  const writePhysicalRow = (category, label, length, quantity, handling, explanation, statusStyle) => {
    put(ws, row, 0, category, styles.text);
    put(ws, row, 1, label, styles.text);
    put(ws, row, 2, length, styles.number);
    put(ws, row, 3, quantity, styles.number);
    put(ws, row, 4, length * quantity, styles.number);
    put(ws, row, 5, handling, statusStyle);
    put(ws, row, 6, explanation, styles.text);
    row += 1;
  };
  actual.edgeFillers.forEach((item) => writePhysicalRow(
    '端段補位', `${number(item.length)} 補位`, item.length, item.quantity,
    '不可回收', '特殊規格位於卷材端部時，為補足 50 節距而剪出的實體端段。', styles.scrap,
  ));
  actual.recoverable.forEach((item) => writePhysicalRow(
    '可回收餘料', `${number(item.length)} 餘料`, item.length, item.quantity,
    '可回收', '可保留作下一張訂單使用。', styles.recoverable,
  ));
  actual.smallRemainders.forEach((item) => writePhysicalRow(
    '小餘量', `${number(item.length)} 餘量`, item.length, item.quantity,
    '不可回收', `低於可回收門檻 ${number(threshold)}。`, styles.scrap,
  ));
  if (!actual.edgeFillers.length && !actual.recoverable.length && !actual.smallRemainders.length) {
    mergedValue(ws, row, 0, 6, '本次沒有端段補位或餘料。', styles.note);
    row += 1;
  }
  const finalRow = row;
  const edgeTotal = actual.edgeFillers.reduce((sum, item) => sum + item.length * item.quantity, 0);
  const recoverableTotal = actual.recoverable.reduce((sum, item) => sum + item.length * item.quantity, 0);
  const smallTotal = actual.smallRemainders.reduce((sum, item) => sum + item.length * item.quantity, 0);
  mergedValue(ws, finalRow, 0, 1, '非成品段合計', styles.label);
  put(ws, finalRow, 2, '—', styles.text);
  put(ws, finalRow, 3, actual.edgeFillers.reduce((sum, item) => sum + item.quantity, 0) + actual.recoverable.reduce((sum, item) => sum + item.quantity, 0) + actual.smallRemainders.reduce((sum, item) => sum + item.quantity, 0), styles.number);
  put(ws, finalRow, 4, edgeTotal + recoverableTotal + smallTotal, styles.number);
  put(ws, finalRow, 5, `端段 ${number(edgeTotal)}｜可回收 ${number(recoverableTotal)}｜小餘量 ${number(smallTotal)}`, styles.note);
  put(ws, finalRow, 6, '端段補位與餘料均不計入成品件數。', styles.text);
  ws['!autofilter'] = { ref: `A7:G${productEndRow}` };
  ws['!freeze'] = { xSplit: 0, ySplit: 7 };
  ws['!rows'][3] = { hpt: 29 };
  fillGaps(ws, finalRow, 6);
  return ws;
}

function writePitchLayoutSheet({ threshold, segmentSize, result }) {
  const ws = newSheet('節距對接配置', [11, 12, 32, 23, 22, 17, 17, 18]);
  writeTitle(ws, '節距對接配置', '僅供現場依固定節距安排 20 / 30 端段對接；成品裁切長度請以「成品裁切配方」為準。', 7);
  const pairs = combinePairs(result.sectionPlan?.pairs).map((pair) => `${pair.left} + ${pair.right} = ${segmentSize} × ${number(pair.count)}`).join('；') || '沒有可互補的端段';
  mergedValue(ws, 3, 0, 7, `中段對接：${pairs}。未配對端段會形成額外碎料，已計入總覽的不可回收碎料。`, styles.note);
  const headers = ['來源', '原始長度', '中段端段對接', '完整節距配置', '未配對端段', '實體佔用', '物料餘量', '狀態'];
  headers.forEach((header, index) => put(ws, 5, index, header, styles.header));
  const entries = [
    ...result.newBins.map((bin, index) => ({ label: `新卷 #${index + 1}`, bin })),
    ...result.offcuts.map((bin, index) => ({ label: `餘料 #${index + 1}`, bin })),
  ];
  entries.forEach(({ label, bin }, index) => {
    const row = 6 + index;
    const state = binStatus(bin, threshold);
    put(ws, row, 0, label, styles.text);
    put(ws, row, 1, bin.capacity, styles.number);
    put(ws, row, 2, binPairDetail(bin), styles.text);
    put(ws, row, 3, `完整 ${number(segmentSize)} 節 × ${number(bin.fullSections || 0)}`, styles.text);
    put(ws, row, 4, binSingleDetail(bin), styles.text);
    put(ws, row, 5, bin.used, styles.number);
    put(ws, row, 6, bin.remainder, styles.number);
    put(ws, row, 7, state.label, state.cellStyle);
    ws['!rows'][row] = { hpt: 31 };
  });
  ws['!autofilter'] = { ref: `A6:H${Math.max(6, entries.length + 5)}` };
  ws['!freeze'] = { xSplit: 0, ySplit: 6 };
  fillGaps(ws, Math.max(6, entries.length + 5), 7);
  return ws;
}

export function createCuttingReport({ capacity, threshold, segmentSize, orders, offcuts, result, language = 'zh' }) {
  result = sortCuttingResult(result);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, writeSummarySheet({ capacity, threshold, segmentSize, orders, offcuts, result, language: normalizeLanguage(language) }), '總覽');
  XLSX.utils.book_append_sheet(workbook, writeProductDetailSheet({ threshold, orders, result }), '成品裁切配方');
  XLSX.utils.book_append_sheet(workbook, writeProductVisualSheet({ capacity, threshold, orders, result }), '視覺成品排料');
  XLSX.utils.book_append_sheet(workbook, writeActualCutCountSheet({ threshold, orders, result }), '實際裁切數量');
  if (result.sectionPlan) XLSX.utils.book_append_sheet(workbook, writePitchLayoutSheet({ threshold, segmentSize, result }), '節距對接配置');
  if (normalizeLanguage(language) === 'en') {
    const translatedSheets = {};
    workbook.SheetNames = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      for (const [address, cell] of Object.entries(sheet)) {
        if (!address.startsWith('!') && cell.t === 's') cell.v = translateReportText(cell.v, language);
      }
      const translatedName = translateReportText(name, language);
      translatedSheets[translatedName] = sheet;
      return translatedName;
    });
    workbook.Sheets = translatedSheets;
  }
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellStyles: true });
}
