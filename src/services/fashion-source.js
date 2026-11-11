// Non-Atomik companies must explicitly configure their path: never reuse
// Atomik's master merely because shared FTP credentials are available.
function fashionSource(code, env = process.env) {
  code = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,40}$/.test(code)) return null;
  const prefix = `MAESTRO_FTP_${code}_`;
  const path = env[prefix + 'PATH'] || (code === '0'
    ? env.MAESTRO_FTP_PATH || '/productos/maestros_vicbor/maestro_Atomik.dbi'
    : '');
  if (!path) return null;
  const value = name => env[prefix + name] ?? env['MAESTRO_FTP_' + name];
  return { code, path, host:value('HOST'), port:Number(value('PORT') || 21),
    user:value('USER'), password:value('PASSWORD'), secure:value('SECURE') === 'true' };
}
function fashionEnabled(code) { return Boolean(fashionSource(code)); }
module.exports = { fashionSource, fashionEnabled };
