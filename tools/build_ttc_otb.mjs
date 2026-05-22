import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

import { addEmptyTtcDsigToFile } from "./ttc_dsig.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUNDLER = path.join(ROOT, "node_modules", "otb-ttc-bundle", "bin", "otb-ttc-bundle");
const REGION_ORDER = ["SC", "TC", "HC", "JP", "KR"];

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
		inputDir: path.join(ROOT, "release", "TTF"),
		outputDir: path.join(ROOT, "release", "TTC"),
		jobs: 1
	};
	for (let i = 2; i < process.argv.length; i++) {
		const arg = process.argv[i];
		if (arg === "--weights") args.weights = process.argv[++i];
		else if (arg === "--input-dir") args.inputDir = path.resolve(process.argv[++i]);
		else if (arg === "--output-dir") args.outputDir = path.resolve(process.argv[++i]);
		else if (arg === "--jobs") args.jobs = Number(process.argv[++i]);
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return {
		...args,
		weights: parseList(args.weights),
		jobs: Math.max(1, Number.isFinite(args.jobs) ? Math.floor(args.jobs) : 1)
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

async function buildOne(inputDir, outputDir, weight) {
	const w = weightName(weight);
	const inputs = REGION_ORDER.map(region => path.join(inputDir, `NexusHanSans${region}-${w}.ttf`));
	const missing = inputs.filter(input => !fs.existsSync(input));
	if (missing.length) {
		throw new Error(`Missing TTF files for ${w}:\n${missing.map(p => `  ${p}`).join("\n")}`);
	}

	await fs.promises.mkdir(outputDir, { recursive: true });
	const output = path.join(outputDir, `NexusHanSans-${w}.ttc`);
	await run(process.execPath, [BUNDLER, "-x", "-Oz", "-o", output, ...inputs]);
	await addEmptyTtcDsigToFile(output);
	console.log(`built ${output}`);
}

async function main() {
	const { weights, inputDir, outputDir, jobs } = parseArgs();
	let next = 0;
	let done = 0;
	async function runWorker() {
		while (next < weights.length) {
			const weight = weights[next++];
			await buildOne(inputDir, outputDir, weight);
			done++;
			if (done % 5 === 0 || done === weights.length) {
				console.log(`  ${done}/${weights.length} TTC done`);
			}
		}
	}
	const workerCount = Math.min(jobs, weights.length);
	console.log(`Building ${weights.length} TTC files with ${workerCount} parallel job(s).`);
	await Promise.all(Array.from({ length: workerCount }, runWorker));
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
