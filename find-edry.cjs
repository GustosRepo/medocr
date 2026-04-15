const fs = require('fs');
const p = JSON.parse(fs.readFileSync('./data/processed.json','utf8'));
for (const [key, info] of Object.entries(p)) {
  if (info && info.suggestedFilename && info.suggestedFilename.includes('Edry')) {
    const hash = info.fileHash;
    const exists = hash ? fs.existsSync('./data/uploads/' + hash) : false;
    if (exists) {
      console.log('Found: key=' + key, 'hash=' + hash, 'id=' + info.id);
    }
  }
}
// Check all uploads for PDFs
const uploads = fs.readdirSync('./data/uploads');
for (const f of uploads) {
  const fpath = './data/uploads/' + f;
  const stat = fs.statSync(fpath);
  const buf = Buffer.alloc(5);
  const fd = fs.openSync(fpath, 'r');
  fs.readSync(fd, buf, 0, 5, 0);
  fs.closeSync(fd);
  if (buf.toString().startsWith('%PDF') && stat.size > 1000000) {
    console.log('PDF:', f, 'size:', (stat.size/1024/1024).toFixed(1) + 'MB', 'modified:', new Date(stat.mtimeMs).toISOString().slice(0,10));
  }
}
