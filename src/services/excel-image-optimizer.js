const sharp = require('sharp');

// 480 px provides several pixels per displayed Excel pixel at the grid's size.
// Only the embedded copy changes; files in the photo directory stay untouched.
async function optimizeExcelImage(buffer, extension) {
  try {
    const pipeline = sharp(buffer).resize({ width:480, height:480, fit:'inside', withoutEnlargement:true });
    const metadata = await sharp(buffer).metadata();
    const outputExtension = metadata.hasAlpha ? 'png' : 'jpeg';
    const optimized = await (metadata.hasAlpha
      ? pipeline.png({ compressionLevel:9 })
      : pipeline.jpeg({ quality:82, mozjpeg:true, chromaSubsampling:'4:4:4' })).toBuffer();
    return optimized.length < buffer.length ? { buffer:optimized, extension:outputExtension } : { buffer, extension };
  } catch {
    // A photo Excel can already display must not prevent export if conversion fails.
    return { buffer, extension };
  }
}

module.exports = { optimizeExcelImage };
