import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const iconsDir = resolve(projectRoot, "public/icons");

const sizes = [
  { name: "icon16", size: 16 },
  { name: "icon48", size: 48 },
  { name: "icon128", size: 128 },
];

async function convert() {
  for (const { name, size } of sizes) {
    const svg = readFileSync(resolve(iconsDir, `${name}.svg`), "utf-8");
    const png = await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toBuffer();
    writeFileSync(resolve(iconsDir, `${name}.png`), png);
    console.log(`✅ ${name}.png (${size}x${size})`);
  }
}

convert().catch(console.error);
