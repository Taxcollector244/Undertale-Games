const fs = require("fs/promises");
const path = require("path");

const gameDirectory = path.resolve(__dirname, "..");
const outputDirectory = path.join(gameDirectory, "dev");
const inputPath = path.join(outputDirectory, "game.unx");

function getPartCount() {
	const partCount = Number.parseInt(process.argv[2], 10);
	if (!Number.isInteger(partCount) || partCount < 1) {
		throw new Error("Usage: node split.js <positive part count> [--force]");
	}
	return partCount;
}

async function splitFile() {
	const partCount = getPartCount();
	const force = process.argv.includes("--force");
	const source = await fs.readFile(inputPath);
	const baseSize = Math.floor(source.length / partCount);
	const remainder = source.length % partCount;
	const partPaths = Array.from({ length: partCount }, (_, index) =>
		path.join(outputDirectory, `game.unx.part${index + 1}`),
	);

	const existingParts = await Promise.all(
		partPaths.map((partPath) => fs.access(partPath).then(() => true).catch(() => false)),
	);
	if (existingParts.some(Boolean) && !force) {
		throw new Error("One or more output parts already exist; remove them before retrying");
	}

	let offset = 0;
	for (let index = 0; index < partCount; index++) {
		const partSize = baseSize + (index < remainder ? 1 : 0);
		const part = source.subarray(offset, offset + partSize);
		await fs.writeFile(partPaths[index], part, { flag: force ? "w" : "wx" });
		offset += partSize;
		console.log(`Created ${partPaths[index]} (${part.length} bytes)`);
	}
}

splitFile().catch((error) => {
	console.error(`Failed to split ${inputPath}:`, error.message);
	process.exitCode = 1;
});
