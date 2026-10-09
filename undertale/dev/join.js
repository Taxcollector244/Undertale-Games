const fs = require("fs/promises");
const path = require("path");

const gameDirectory = path.resolve(__dirname, "..");
const outputPath = path.join(gameDirectory + "/dev/", "game.unx");
const partPaths = Array.from({ length: 5 }, (_, index) =>
  path.join(gameDirectory, `game.unx.part${index + 1}`),
);

async function mergeFiles() {
  const parts = await Promise.all(partPaths.map((partPath) => fs.readFile(partPath)));
  const merged = Buffer.concat(parts);

  await fs.writeFile(outputPath, merged, { flag: "wx" });
  console.log(`Created ${outputPath} (${merged.length} bytes)`);
}

mergeFiles().catch((error) => {
  console.error(`Failed to create ${outputPath}:`, error.message);
  process.exitCode = 1;
});
