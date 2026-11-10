// Packs the built extension into ../qa-tools.zip (repository root).
// No external dependencies and no `zip` CLI, so it works the same on Windows, macOS and Linux.
// Usage: node scripts/zip.mjs [--from <dir>] [--out <file>]   (defaults: dist, ../qa-tools.zip)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : path.resolve(args[index + 1]);
};
const sourceDir = option('--from', path.join(root, 'dist'));
const outFile = option('--out', path.resolve(root, '..', 'qa-tools.zip'));

// Store assets and local screenshots live in public/ on some machines and get copied to dist/.
// They are not part of the extension and must never ship.
const EXCLUDED = [/^screenshot\.png$/i, /^image.*\.png$/i, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/i, /\.map$/];
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;

if (!fs.existsSync(path.join(sourceDir, 'manifest.json'))) {
  console.error(`manifest.json not found in ${sourceDir}. Run the build first.`);
  process.exit(1);
}

function listFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), name + '/') : [name];
  });
}

const all = listFiles(sourceDir).sort();
const skipped = all.filter((name) => EXCLUDED.some((pattern) => pattern.test(name)));
const files = all.filter((name) => !skipped.includes(name));

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const chunks = [];
const central = [];
let offset = 0;
let totalBytes = 0;

for (const name of files) {
  const absolute = path.join(sourceDir, name);
  const data = fs.readFileSync(absolute);
  const compressed = zlib.deflateRawSync(data, { level: 9 });
  const nameBytes = Buffer.from(name, 'utf8'); // forward slashes, as the ZIP format requires
  const { time, date } = dosDateTime(fs.statSync(absolute).mtime);
  const crc = zlib.crc32(data);
  totalBytes += data.length;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 file names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);

  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressed.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt32LE(offset, 42);

  chunks.push(local, nameBytes, compressed);
  central.push(header, nameBytes);
  offset += local.length + nameBytes.length + compressed.length;
}

if (totalBytes > MAX_TOTAL_BYTES) {
  console.error(`Extension is ${(totalBytes / 1048576).toFixed(1)} MiB, limit is ${MAX_TOTAL_BYTES / 1048576} MiB. A stray asset probably got into ${sourceDir}.`);
  process.exit(1);
}

const centralSize = central.reduce((sum, part) => sum + part.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const archive = Buffer.concat([...chunks, ...central, end]);
fs.writeFileSync(outFile, archive);

const sha256 = crypto.createHash('sha256').update(archive).digest('hex').toUpperCase();
if (skipped.length) console.log(`Skipped: ${skipped.join(', ')}`);
console.log(`Created: ${outFile}`);
console.log(`Files: ${files.length}, unpacked ${(totalBytes / 1024).toFixed(0)} KiB, archive ${(archive.length / 1024).toFixed(0)} KiB`);
console.log(`SHA256: ${sha256}`);
