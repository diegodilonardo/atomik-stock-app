const test = require('node:test');
const assert = require('node:assert/strict');
const { fashionSource } = require('../src/services/fashion-source');

test('una empresa nueva no hereda el maestro de Atomik', () => {
  const env = { MAESTRO_FTP_HOST:'ftp.test', MAESTRO_FTP_USER:'user', MAESTRO_FTP_PASSWORD:'test', MAESTRO_FTP_PATH:'/atomik.dbi' };
  assert.equal(fashionSource('0',env).path,'/atomik.dbi');
  assert.equal(fashionSource('GYD_TEST',env),null);
  const source = fashionSource('GYD_TEST',{...env,MAESTRO_FTP_GYD_TEST_PATH:'/gyd.dbi'});
  assert.equal(source.path,'/gyd.dbi');
  assert.equal(source.host,'ftp.test');
  const separate = fashionSource('GYD_TEST',{...env,MAESTRO_FTP_GYD_TEST_PATH:'/gyd.dbi',MAESTRO_FTP_GYD_TEST_HOST:'other.test',MAESTRO_FTP_GYD_TEST_USER:'other',MAESTRO_FTP_GYD_TEST_PASSWORD:'other-test'});
  assert.equal(separate.host,'other.test');assert.equal(separate.user,'other');
  assert.equal(fashionSource('../0',env),null);
});

test('caché y descargas de moda se mantienen separadas por empresa', async () => {
  const { Client } = require('basic-ftp');
  const { loadMaster } = require('../src/services/fashion-master');
  const original = {access:Client.prototype.access,downloadTo:Client.prototype.downloadTo,close:Client.prototype.close};
  const changed = {};
  const calls=[];
  function data(code) {
    const fields=['CODIGO','COD_ALFA','COD_ANO','COD_TEM','DMODC','DCOLORC','PRECIO'];
    const header=33+fields.length*32, size=1+fields.length*12, buffer=Buffer.alloc(header+size,32);
    buffer[0]=3;buffer.writeUInt32LE(1,4);buffer.writeUInt16LE(header,8);buffer.writeUInt16LE(size,10);
    fields.forEach((name,i)=>{const p=32+i*32;buffer.fill(0,p,p+32);buffer.write(name,p,'ascii');buffer[p+11]=67;buffer[p+16]=12;});
    buffer[header-1]=13;
    [code,code,'27','2','Modelo','Negro','100'].forEach((v,i)=>buffer.write(v,header+1+i*12,'ascii'));
    return buffer;
  }
  try {
    for(const code of ['TEST_A','TEST_B']) for(const [key,value] of Object.entries({HOST:'test',USER:'test',PASSWORD:'test',PATH:`/${code}.dbi`})) {
      const name=`MAESTRO_FTP_${code}_${key}`;changed[name]=process.env[name];process.env[name]=value;
    }
    Client.prototype.access=async()=>{};Client.prototype.close=()=>{};
    Client.prototype.downloadTo=async(destination,path)=>{calls.push(path);destination.write(data(path.includes('TEST_A')?'AAA':'BBB'));destination.end();};
    const [a,b]=await Promise.all([loadMaster(true,'TEST_A'),loadMaster(true,'TEST_B')]);
    assert.equal(a.products[0].CODIGO,'AAA');assert.equal(b.products[0].CODIGO,'BBB');
    assert.equal(await loadMaster(false,'TEST_A'),a);assert.equal(await loadMaster(false,'TEST_B'),b);
    assert.equal(calls.length,2);
    await loadMaster(true,'TEST_A');assert.equal(calls.length,3);
    assert.equal(await loadMaster(false,'TEST_B'),b);
  } finally {
    Object.assign(Client.prototype,original);
    for(const [key,value] of Object.entries(changed)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
