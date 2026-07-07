const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', 'results');

function escapeCsvField(field) {
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function generateCsv(ranking) {
  const rows = [['順位', '名前', '合計得点']];
  ranking.forEach((entry) => {
    rows.push([entry.rank, entry.name, entry.totalScore]);
  });
  const csvBody = rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n');
  const bom = '﻿';
  return bom + csvBody;
}

function saveCsvToDisk(ranking) {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
  const filename = `result-${Date.now()}.csv`;
  const filePath = path.join(RESULTS_DIR, filename);
  fs.writeFileSync(filePath, generateCsv(ranking), 'utf-8');
  return filePath;
}

module.exports = { generateCsv, saveCsvToDisk };
