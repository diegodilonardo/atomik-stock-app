const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../scripts/export-grid');
test('CLI exige empresa y una seleccion unica con destinos explicitos', () => {
  assert.equal(parseArgs(['--empresa','0','--id','7'])['--id'], '7');
  assert.equal(parseArgs(['--empresa','0','--nombre','Grilla SL','--salida','C:\\Grillas\\sl.xlsx'])['--nombre'], 'Grilla SL');
  for (const args of [['--id','7'], ['--empresa','0'], ['--empresa','0','--todas','--id','7'], ['--empresa','0','--id','0'], ['--empresa','0','--listar','--salida','x'], ['--empresa','0','--nombre'], ['--empresa','0','--empresa','OTRA','--listar']]) assert.throws(() => parseArgs(args));
});
