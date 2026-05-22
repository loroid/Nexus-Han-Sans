import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

import { addEmptyTtcDsigToFile } from "./ttc_dsig.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUNDLER = path.join(ROOT, "node_modules", "otb-ttc-bundle", "bin", "otb-ttc-bundle");
const FULL_WEIGHTS = Array.from({ length: 27 }, (_, i) => i + 1);

function weightName(weight) {
	return `W${String(weight).padStart(2, "0")}`;
}

function parseList(value) {
	const result = [];
	for (const raw of String(value).split(/[,\s]+/)) {
		const part = raw.trim();
		if (!part) continue;
		if (part.includes("-")) {
			const [a, b] = part.split("-").map(v => Number(v));
			if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`Invalid weight range: ${part}`);
			for (let n = a; n <= b; n++) result.push(n);
		} else {
			const n = Number(part);
			if (!Number.isInteger(n)) throw new Error(`Invalid weight: ${part}`);
			result.push(n);
		}
	}
	return [...new Set(result)];
}

function parseArgs() {
	const args = {
		weights: "1-27",
		inputDir: path.join(ROOT, "release", "TTC"),
		outputDir: path.join(ROOT, "release", "SuperTTC"),
		heapSize: Number(process.env.NEXUS_NODE_HEAP_MB || 12288)
	};
	for (let i = 2; i < process.argv.length; i++) {
		const arg = process.argv[i];
		if (arg === "--weights") args.weights = process.argv[++i];
		else if (arg === "--input-dir") args.inputDir = path.resolve(process.argv[++i]);
		else if (arg === "--output-dir") args.outputDir = path.resolve(process.argv[++i]);
		else if (arg === "--heap-size") args.heapSize = Number(process.argv[++i]);
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return {
		...args,
		weights: parseList(args.weights).sort((a, b) => a - b),
		heapSize: Math.max(4096, Number.isFinite(args.heapSize) ? Math.floor(args.heapSize) : 12288)
	};
}

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit", shell: false });
		child.on("error", reject);
		child.on("exit", code => {
			if (code === 0) resolve();
			else reject(new Error(`${command} exited with ${code}`));
		});
	});
}

function isFullWeightSet(weights) {
	if (weights.length !== FULL_WEIGHTS.length) return false;
	return FULL_WEIGHTS.every((weight, index) => weights[index] === weight);
}

function compactWeightName(weights) {
	const sorted = [...weights].sort((a, b) => a - b);
	const ranges = [];
	let start = sorted[0];
	let previous = sorted[0];
	for (const weight of sorted.slice(1)) {
		if (weight === previous + 1) {
			previous = weight;
			continue;
		}
		ranges.push(start === previous ? weightName(start) : `${weightName(start)}-${weightName(previous)}`);
		start = previous = weight;
	}
	ranges.push(start === previous ? weightName(start) : `${weightName(start)}-${weightName(previous)}`);
	return ranges.join("_");
}

function outputName(weights) {
	if (isFullWeightSet(weights)) return "NexusHanSans-Super.ttc";
	return `NexusHanSans-Super-${compactWeightName(weights)}.ttc`;
}

async function buildSuper(inputDir, outputDir, weights) {
	const inputs = weights.map(weight => path.join(inputDir, `NexusHanSans-${weightName(weight)}.ttc`));
	const missing = inputs.filter(input => !fs.existsSync(input));
	if (missing.length) {
		throw new Error(`Missing TTC files for Super TTC:\n${missing.map(p => `  ${p}`).join("\n")}`);
	}

	await fs.promises.mkdir(outputDir, { recursive: true });
	const output = path.join(outputDir, outputName(weights));
	return { output, inputs };
}

async function writeSuperTtc(inputDir, outputDir, weights, heapSize) {
	const { output, inputs } = await buildSuper(inputDir, outputDir, weights);
	await run(process.execPath, [`--max-old-space-size=${heapSize}`, BUNDLER, "-o", output, ...inputs]);
	await addEmptyTtcDsigToFile(output);
	console.log(`built ${output}`);
}

async function main() {
	const { weights, inputDir, outputDir, heapSize } = parseArgs();
	await writeSuperTtc(inputDir, outputDir, weights, heapSize);
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
