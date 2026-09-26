const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFile } = require('../src/services/company-service');

test('normaliza rutas completas y rechaza rutas ambiguas', () => {
  assert.equal(normalizeFile('C:\\Stock\\old\\..\\stock.TXT'), 'C:\\Stock\\stock.TXT');
  assert.equal(normalizeFile('\\\\server\\share\\stock.TXT'), '\\\\server\\share\\stock.TXT');
  for (const value of ['stock.txt', '\\stock.txt', 'file://server/share/stock.txt', 'C:\\stock.txt.', 'C:\\stock.txt:other', 'C:\\Stock\\', '']) {
    assert.throws(() => normalizeFile(value));
  }
});
