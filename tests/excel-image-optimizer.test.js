const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { optimizeExcelImage } = require('../src/services/excel-image-optimizer');

test('reduce fotos grandes sin deformar, no agranda pequeñas y conserva transparencia', async () => {
  const source = await sharp({ create:{width:1800,height:900,channels:3,background:'#467ea6'} }).jpeg({quality:100}).toBuffer();
  const result = await optimizeExcelImage(source,'jpeg');
  const meta = await sharp(result.buffer).metadata();
  assert.ok(result.buffer.length < source.length);
  assert.equal(meta.width,480);assert.equal(meta.height,240);
  const small = await sharp({create:{width:30,height:15,channels:4,background:{r:10,g:80,b:120,alpha:0.5}}}).png().toBuffer();
  const output = await optimizeExcelImage(small,'png');
  const alpha = await sharp(output.buffer).metadata();
  assert.equal(alpha.width,30);assert.equal(alpha.height,15);assert.equal(alpha.hasAlpha,true);
  assert.ok(output.buffer.length<=small.length);
});

test('embedding optimizado mantiene anclaje, reutiliza fotos y no modifica originales', async () => {
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
  const ExcelJS=require('exceljs');
  const {embedProductImages}=require('../src/services/product-images');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fashion-photos-'));
  const file=path.join(dir,'271ABC01.jpg');
  try {
    const original=await sharp({create:{width:1600,height:800,channels:3,background:'#abc'}}).jpeg({quality:100}).toBuffer();
    await fs.writeFile(file,original);
    const row={COD_ANIO:'27',COD_TEM:'1',MODC:'ABC',COLORC:'01',EXCEL_IMAGE_ROW:3};
    const book=new ExcelJS.Workbook(),cache=new Map(),index=new Map([['271abc01.jpg','271ABC01.jpg']]);
    for(const name of ['A','B']) {
      const sheet=book.addWorksheet(name);sheet.getColumn(2).width=16;sheet.getRow(3).height=69;
      await embedProductImages(book,sheet,[row],dir,index,cache,{}, {optimize:true});
    }
    assert.equal(book.media.length,1);assert.ok(book.media[0].buffer.length<original.length);
    const {imagePlacement}=require('../src/services/product-images');
    const expected=imagePlacement(book.getWorksheet('A'),3,{width:1600,height:800});
    const actual=book.getWorksheet('A').getImages()[0].range;
    assert.deepEqual(actual.ext,expected.ext);
    assert.deepEqual(await fs.readFile(file),original);
  } finally {
    await fs.unlink(file).catch(()=>{});await fs.rmdir(dir);
  }
});
