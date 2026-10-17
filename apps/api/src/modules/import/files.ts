import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { badRequest } from '../../lib/errors';
import type { RawRow } from './normalize';

export const MAX_ROWS = 5000;

export interface ParsedFile {
  source: 'csv' | 'xlsx';
  headers: string[];
  rows: RawRow[];
}

/** Gives every column a unique, non-empty header. */
const uniqueHeaders = (cells: string[]) => {
  const seen = new Map<string, number>();
  return cells.map((cell, i) => {
    const base = cell.trim() || `Columna ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
};

/** Bank exports often start with a few title lines: the header is the first row with 2+ filled cells. */
const toRows = (matrix: string[][]): Omit<ParsedFile, 'source'> => {
  const start = matrix.findIndex((r) => r.filter((c) => c.trim()).length >= 2);
  if (start === -1) throw badRequest('El archivo no tiene filas con datos');
  const headers = uniqueHeaders(matrix[start]!);
  const rows = matrix
    .slice(start + 1)
    .filter((r) => r.some((c) => c.trim()))
    .slice(0, MAX_ROWS)
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, rows };
};

const decode = (data: Buffer) => {
  const utf8 = data.toString('utf8').replace(/^﻿/, '');
  // Spanish exports saved by Excel are often Windows-1252.
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(data) : utf8;
};

const parseCsvFile = (data: Buffer): string[][] => {
  const text = decode(data);
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const delimiter = [';', ',', '\t', '|'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]!;
  return parseCsv(text, { delimiter, relax_column_count: true, skip_empty_lines: true, bom: true }) as string[][];
};

const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return String(value.text);
    return '';
  }
  return String(value);
};

const parseXlsxFile = async (data: Buffer): Promise<string[][]> => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const sheet = wb.worksheets.find((ws) => ws.actualRowCount >= 2) ?? wb.worksheets[0];
  if (!sheet) throw badRequest('El Excel no tiene hojas');
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    matrix.push(values.slice(1).map(cellText));
  });
  return matrix;
};

export const parseUpload = async (fileName: string, data: Buffer): Promise<ParsedFile> => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) return { source: 'xlsx', ...toRows(await parseXlsxFile(data)) };
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return { source: 'csv', ...toRows(parseCsvFile(data)) };
  if (lower.endsWith('.xls')) throw badRequest('Guarda el archivo como .xlsx o .csv (el formato .xls antiguo no es compatible)');
  throw badRequest('Formato no compatible: usa .xlsx o .csv');
};

// ---------------------------------------------------------------- template

export const TEMPLATE_HEADERS = ['Fecha', 'Descripción', 'Monto', 'Moneda', 'Categoría', 'Tipo', 'De', 'Cuenta'];
const TEMPLATE_EXAMPLES = [
  ['2026-10-05', 'Supermercado Nacional', '3250.75', 'DOP', 'Supermercado', 'Gasto', 'Hogar', ''],
  ['2026-10-06', 'Netflix', '15.99', 'USD', 'Suscripciones', 'Gasto', '', ''],
  ['2026-10-07', 'Venta de artículos', '2000', 'DOP', '', 'Ingreso', '', ''],
];

export const templateCsv = () =>
  `﻿${[TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLES].map((r) => r.map((c) => (/[",;\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n')}\r\n`;

export const templateXlsx = async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Gastos');
  ws.addRow(TEMPLATE_HEADERS).font = { bold: true };
  for (const r of TEMPLATE_EXAMPLES) ws.addRow(r);
  ws.columns.forEach((col, i) => (col.width = [12, 32, 12, 9, 18, 10, 12, 18][i] ?? 12));
  const notes = wb.addWorksheet('Instrucciones');
  for (const line of [
    'Fecha: AAAA-MM-DD o DD/MM/AAAA.',
    'Monto: positivo. Usa la columna Tipo para indicar Gasto o Ingreso.',
    'Moneda: DOP, USD o EUR (vacío = la moneda que elijas al importar).',
    'Categoría: nombre de una categoría existente (opcional).',
    'De: "Hogar" para gastos comunes o el nombre de la persona (opcional).',
    'Cuenta: nombre de una cuenta existente (opcional).',
    'Borra las filas de ejemplo antes de importar.',
  ])
    notes.addRow([line]);
  return Buffer.from(await wb.xlsx.writeBuffer());
};
