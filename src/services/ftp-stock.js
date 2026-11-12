const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {Client}=require('basic-ftp');
function normalizeFtpPath(value) {
  const result=String(value ?? '').trim();
  if(!result)return '';
  if(result.length>400 || !result.startsWith('/') || /[\\\x00-\x1f]/.test(result) || result.split('/').includes('..') || result.endsWith('/'))
    throw new Error('Ingrese una ruta FTP absoluta, por ejemplo /STOCK/empresa/stock.txt');
  return result;
}
async function stockSource(company) {
  if(!company.STOCK_FTP_PATH)return {file:company.SOURCE_FILE,cleanup:async()=>{}};
  const remote=normalizeFtpPath(company.STOCK_FTP_PATH);
  const source=require('./fashion-source').fashionSource({...company,FASHION_FTP_PATH:remote});
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'stock-ftp-'));
  const file=path.join(directory,'stock.txt');
  const cleanup=()=>fs.rm(directory,{recursive:true,force:true});
  const client=new Client(30000);
  try {
    if(!source?.host || !source.user || !source.password)throw new Error('FTP incompleto');
    await client.access({host:source.host,port:source.port,user:source.user,password:source.password,secure:source.secure});
    await client.downloadTo(file,remote);
    return {file,cleanup};
  } catch {await cleanup();throw new Error('No se pudo descargar el stock FTP. Revise la ruta y la conexión configuradas.');}
  finally {client.close();}
}
module.exports={normalizeFtpPath,stockSource};
