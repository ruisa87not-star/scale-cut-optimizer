export const formatLength = value => new Intl.NumberFormat('zh-TW').format(value || 0);
export const specificationLabel = ({ length, start = 0, end = 0 }) => start || end
  ? `${formatLength(length)}-${start}/${end}` : formatLength(length);

export function cutInstruction(items = [], orders = []) {
  const counts = new Map();
  for (const length of items) counts.set(length, (counts.get(length) || 0) + 1);
  return [...counts].map(([length, quantity]) => {
    const matches = orders.filter(order => Number(order.length) === Number(length));
    return `${matches.length === 1 ? specificationLabel(matches[0]) : formatLength(length)} × ${formatLength(quantity)}`;
  }).join(' ＋ ') || '—';
}

export function physicalSegments(bin) {
  return bin.layoutSegments?.length ? bin.layoutSegments : (bin.items || []).map(length => ({ length, kind: 'product' }));
}

// Allocate across the whole order, not the visible page. Blue-to-rose hues
// leave the green remainder and orange filler treatments distinct.
export function createLengthColours(orders) {
  return new Map([...new Set(orders.map(order => Number(order.length)))].sort((a,b)=>b-a).map((length,index) => {
    const hue = 190 + ((index * .61803398875) % 1) * 170;
    const lightness = .78 + (Math.floor(index / 12) % 2) * .08;
    const chroma = (1 - Math.abs(2 * lightness - 1)) * .65;
    const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
    const offset = lightness - chroma / 2;
    const channels = [[chroma,x,0],[x,chroma,0],[0,chroma,x],[0,x,chroma],[x,0,chroma],[chroma,0,x]][Math.floor(hue / 60)];
    const fill = '#' + channels.map(channel => Math.round((channel + offset) * 255).toString(16).padStart(2,'0')).join('').toUpperCase();
    return [length,{fill,text:'#172E3B'}];
  }));
}

// Only reorder whole new rolls. Product and pitch views share the permutation;
// their internal physical sequences and existing inventory IDs stay intact.
export function sortCuttingResult(result) {
  const rows = (result.productBins || result.newBins).map((bin,index) => {
    const counts = new Map();
    for (const length of bin.items || []) counts.set(length,(counts.get(length) || 0) + 1);
    return {index,recipe:[...counts].sort((a,b)=>b[0]-a[0]),signature:JSON.stringify([bin.capacity,bin.remainder,physicalSegments(bin)])};
  });
  rows.sort((a,b) => {
    for (let index=0;index<Math.max(a.recipe.length,b.recipe.length);index++) {
      const left=a.recipe[index],right=b.recipe[index];
      if (!left || !right) return left ? -1 : 1;
      const difference=right[0]-left[0] || right[1]-left[1];
      if (difference) return difference;
    }
    return a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : a.index-b.index;
  });
  return {...result,newBins:rows.map(row=>result.newBins[row.index]),...(result.productBins ? {productBins:rows.map(row=>result.productBins[row.index])} : {})};
}

export function rollEntries(result, includeUnused = false) {
  const entries = (result.productBins || result.newBins || []).map((bin, index) => ({ bin, index, source: 'new', key: `new-${index}` }));
  (result.productOffcuts || result.offcuts || []).forEach((bin, index) => {
    if (includeUnused || bin.used) entries.push({ bin, index, source: 'offcut', key: `offcut-${index}` });
  });
  return entries;
}

export function groupRolls(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const signature = JSON.stringify([entry.source, entry.bin.capacity, entry.bin.remainder, physicalSegments(entry.bin)]);
    if (!groups.has(signature)) groups.set(signature, { ...entry, key: signature, indices: [] });
    groups.get(signature).indices.push(entry.index);
  }
  return [...groups.values()];
}

export function rollNumbers(indices) {
  const spans = [];
  for (let cursor = 0; cursor < indices.length; cursor++) {
    const first = indices[cursor];
    while (cursor + 1 < indices.length && indices[cursor + 1] === indices[cursor] + 1) cursor++;
    const last = indices[cursor];
    spans.push(first === last ? `#${first + 1}` : `#${first + 1}–${last + 1}`);
  }
  return spans.join(', ');
}

export function entryMatches(entry, filter, query, threshold) {
  const { bin, index } = entry;
  if (filter === 'remainder' && !(bin.used && bin.remainder > 0)) return false;
  if (filter === 'full' && !(bin.used && !bin.remainder)) return false;
  if (filter === 'scrap' && !(bin.edgeScrap > 0 || (bin.used && bin.remainder > 0 && bin.remainder < threshold))) return false;
  const search = String(query).trim().replaceAll(',', '');
  if (!search) return true;
  if (/^#\d+$/.test(search)) return index + 1 === Number(search.slice(1));
  return [index + 1, bin.capacity, bin.remainder, ...(bin.items || []), ...physicalSegments(bin).map(segment => segment.length)].some(value => String(value).includes(search));
}

export function materialSummary(result, threshold) {
  const bins = rollEntries(result).map(entry => entry.bin).filter(bin => bin.used);
  const tails = bins.filter(bin => bin.remainder > 0 && bin.remainder >= threshold).map(bin => bin.remainder);
  const stock = bins.reduce((sum, bin) => sum + bin.capacity, 0);
  return {
    stock,
    product: result.summary.orderLength,
    scrap: result.summary.deadScrapLength,
    reusable: result.summary.recoverableRemainder,
    tailCount: tails.length,
    longestTail: Math.max(0, ...tails),
    productPercent: stock ? result.summary.orderLength / stock * 100 : 0,
  };
}

export function requestFingerprint({ capacity, threshold, segmentSize, orders, offcuts }) {
  return JSON.stringify({
    capacity: Number(capacity), threshold: Number(threshold), segmentSize: Number(segmentSize),
    orders: orders.map(({ length, quantity, start = 0, end = 0 }) => [Number(length), Number(quantity), Number(start), Number(end)]),
    offcuts: offcuts.map(Number),
  });
}
