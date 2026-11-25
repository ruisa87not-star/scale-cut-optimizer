import { specificationLabel } from './planPresentation.js';

const newId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const integer = value => {
  const numeric = Number(String(value).replaceAll(',', '').trim());
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
};

function parseSpecification(value) {
  const text = String(value).trim();
  const special = text.match(/^(\d+(?:,\d{3})*)\s*-\s*(\d+)\s*\/\s*(\d+)$/);
  if (special) return { length: integer(special[1]), start: integer(special[2]), end: integer(special[3]) };
  const length = integer(text);
  return length ? { length, start: 0, end: 0 } : null;
}

const displaySpecification = specificationLabel;

function parseOrders(rows) {
  const parsed = [];
  rows.forEach(row => {
    const values = Array.isArray(row) ? row.filter(value => value !== undefined && value !== null && value !== '') : [row];
    if (!values.length) return;
    let specification, quantity;
    if (values.length >= 2) {
      specification = parseSpecification(values[0]); quantity = integer(values[1]);
    } else {
      const text = String(values[0]).trim();
      const multiplication = text.match(/^(.+?)\s*(?:x|X|×|\*)\s*(.+)$/);
      if (multiplication) {
        specification = parseSpecification(multiplication[1]); quantity = integer(multiplication[2]);
      } else {
        // A comma separates length and quantity: 1050,114 is 114 pieces.
        const commaSpecification = text.match(/^(.+?)\s*[,;，]\s*(\d+)$/);
        if (commaSpecification) {
          specification = parseSpecification(commaSpecification[1]); quantity = integer(commaSpecification[2]);
        } else {
          const numbers = text.match(/\d+(?:,\d{3})*/g)?.map(item => integer(item)).filter(Boolean) || [];
          specification = numbers[0] ? { length: numbers[0], start: 0, end: 0 } : null;
          quantity = numbers.length > 1 ? numbers[1] : 1;
        }
      }
    }
    if (specification?.length && quantity) parsed.push({ ...specification, quantity });
  });
  return parsed;
}

function parseOffcuts(rows) {
  const parsed = [];
  rows.forEach(row => {
    const value = Array.isArray(row) ? row[0] : row;
    if (value === undefined || value === null) return;
    const direct = integer(value);
    if (direct) parsed.push(direct);
    else String(value).match(/\d+(?:,\d{3})*/g)?.forEach(item => {
      const number = integer(item); if (number) parsed.push(number);
    });
  });
  return parsed;
}

export function parseOffcutBatch(lengthValue, quantityValue = 1) {
  const length = integer(lengthValue), quantity = integer(quantityValue);
  if (!length) return { field: 'offcut-length', error: '餘料長度必須是大於 0 的整數。' };
  if (!quantity) return { field: 'offcut-quantity', error: '數量必須是大於 0 的整數。' };
  if (quantity > 10000) return { field: 'offcut-quantity', error: '每次最多加入 10,000 段餘料。' };
  return { offcuts: Array(quantity).fill(length) };
}

function mergeOrders(existing, additions) {
  const quantities = new Map();
  [...existing, ...additions].forEach(({ length, quantity, start = 0, end = 0 }) => {
    const key = `${length}|${start}|${end}`;
    quantities.set(key, { length, start, end, quantity: Number(quantities.get(key)?.quantity || 0) + Number(quantity) });
  });
  return [...quantities.values()].map(item => ({ id: newId(), ...item })).sort((left, right) => right.length - left.length);
}

export const textRows = text => text.split(/\r?\n|；/).map(line => line.includes('\t') || line.includes(';') ? line.split(/[\t;]/) : [line]);
export { integer, parseSpecification, parseOrders, parseOffcuts, mergeOrders, displaySpecification };
