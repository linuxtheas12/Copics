const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const input = path.join(root, 'logo.svg');
const sizes = [16, 32, 48, 128];

async function run() {
  for (const size of sizes) {
    const output = path.join(root, `icon-${size}.png`);
    await sharp(input)
      .resize(size, size, { fit: 'contain' })
      .png()
      .toFile(output);
    console.log(`Generated ${output}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
