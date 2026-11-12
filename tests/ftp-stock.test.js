const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeFtpPath,stockSource}=require('../src/services/ftp-stock');
const {fashionSource}=require('../src/services/fashion-source');
test('SQL tiene prioridad y permite desactivar moda sin cambiar env',()=>{
 const env={MAESTRO_FTP_PATH:'/old.dbi',MAESTRO_FTP_HOST:'host'};
 assert.equal(fashionSource({CODIGO:'0',FASHION_FTP_PATH:'/new.dbi'},env).path,'/new.dbi');
 assert.equal(fashionSource({CODIGO:'0',FASHION_FTP_PATH:''},env),null);
 assert.equal(normalizeFtpPath('/STOCK/ATOMIK/file.txt'),'/STOCK/ATOMIK/file.txt');
 for(const p of ['relative','/../file','/folder/'])assert.throws(()=>normalizeFtpPath(p));
});
test('descarga stock FTP a temporal y limpia el archivo',async()=>{
 const {Client}=require('basic-ftp'),fs=require('node:fs/promises');
 const access=Client.prototype.access,download=Client.prototype.downloadTo,close=Client.prototype.close;
 const original={...process.env};
 process.env.MAESTRO_FTP_HOST='test';process.env.MAESTRO_FTP_USER='test';process.env.MAESTRO_FTP_PASSWORD='test';
 Client.prototype.access=async()=>{};Client.prototype.close=()=>{};
 Client.prototype.downloadTo=async(file,remote)=>{assert.equal(remote,'/STOCK/test.txt');await fs.writeFile(file,'stock');};
 try {const result=await stockSource({CODIGO:'0',STOCK_FTP_PATH:'/STOCK/test.txt'});assert.equal(await fs.readFile(result.file,'utf8'),'stock');await result.cleanup();await assert.rejects(fs.stat(result.file));}
 finally{Client.prototype.access=access;Client.prototype.downloadTo=download;Client.prototype.close=close;for(const key of ['MAESTRO_FTP_HOST','MAESTRO_FTP_USER','MAESTRO_FTP_PASSWORD']){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}}
});
