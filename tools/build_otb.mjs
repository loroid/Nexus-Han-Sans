import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

import { CliProc, FontIo, Ot } from "ot-builder";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const RELEASE = path.join(ROOT, "release");
const SOURCE_VERSION_FONT = path.join(ROOT, "sources", "source-han-sans", "SourceHanSans-VF.ttf");

const DREAM_WEIGHT_CLASSES = [
	250,
	270,
	291,
	312,
	333,
	354,
	376,
	398,
	420,
	443,
	466,
	489,
	513,
	537,
	562,
	587,
	613,
	639,
	666,
	693,
	721,
	749,
	778,
	808,
	838,
	869,
	900
];

const STYLE_LINK_REGULAR = 12;
const STYLE_LINK_BOLD = 22;
// Bump this for each Nexus Han Sans release. Upstream Source updates should
// produce strings like "Version 1.01; Source 2.006".
const NEXUS_VERSION = "1.00";
const NEXUS_FONT_REVISION = 1.0;
const DREAM_TARGET_UPM = 2048;
const DREAM_GLYPH_COUNT = 65535;
const DREAM_UNICODE_RANGES = [805306499, 736050192, 22, 0];
const DREAM_GASP_BEHAVIOR =
	Ot.Gasp.RangeBehavior.DoGray | Ot.Gasp.RangeBehavior.SymmetricSmoothing;
const DREAM_PREP_PROGRAM = Buffer.from([0xb8, 0x01, 0xff, 0x85, 0xb8, 0x00, 0x04, 0x8d]);
const REGIONS = {
	SC: {
		en: "Nexus Han Sans SC",
		local: { zh_CN: "结源黑体 SC" },
		cjk: "SC",
		enc: { gbk: true, big5: false, jis: false, korean: false }
	},
	TC: {
		en: "Nexus Han Sans TC",
		local: { zh_TW: "結源黑體 TC", zh_HK: "結源黑體 TC" },
		cjk: "TC",
		enc: { gbk: false, big5: true, jis: false, korean: false }
	},
	HC: {
		en: "Nexus Han Sans HC",
		local: { zh_TW: "結源黑體 HC", zh_HK: "結源黑體 HC" },
		cjk: "HC",
		enc: { gbk: false, big5: true, jis: false, korean: false }
	},
	JP: {
		en: "Nexus Han Sans JP",
		local: { ja_JP: "結ノ角ゴ JP" },
		cjk: "JP",
		enc: { gbk: false, big5: false, jis: true, korean: false }
	},
	KR: {
		en: "Nexus Han Sans KR",
		local: { ko_KR: "결본고딕 KR" },
		cjk: "KR",
		enc: { gbk: false, big5: false, jis: false, korean: true }
	}
};

function weightName(weight) {
	return `W${String(weight).padStart(2, "0")}`;
}

function weightValue(weight) {
	return DREAM_WEIGHT_CLASSES[weight - 1];
}

function decodeUtf16Be(buffer) {
	const values = [];
	for (let i = 0; i + 1 < buffer.length; i += 2) values.push(buffer.readUInt16BE(i));
	return String.fromCharCode(...values);
}

function decodeNameRecordString(platformID, encodingID, buffer) {
	if (platformID === 0 || platformID === 3 || (platformID === 2 && encodingID === 1)) {
		return decodeUtf16Be(buffer);
	}
	return buffer.toString("latin1");
}

async function readNameTableRecord(input, nameID) {
	const buffer = await fs.promises.readFile(input);
	const numTables = buffer.readUInt16BE(4);
	let nameTableOffset = null;
	for (let i = 0; i < numTables; i++) {
		const recordOffset = 12 + i * 16;
		const tag = buffer.toString("ascii", recordOffset, recordOffset + 4);
		if (tag === "name") {
			nameTableOffset = buffer.readUInt32BE(recordOffset + 8);
			break;
		}
	}
	if (nameTableOffset === null) throw new Error(`No name table found in ${input}`);

	const count = buffer.readUInt16BE(nameTableOffset + 2);
	const stringOffset = buffer.readUInt16BE(nameTableOffset + 4);
	const values = [];
	for (let i = 0; i < count; i++) {
		const recordOffset = nameTableOffset + 6 + i * 12;
		const platformID = buffer.readUInt16BE(recordOffset);
		const encodingID = buffer.readUInt16BE(recordOffset + 2);
		const languageID = buffer.readUInt16BE(recordOffset + 4);
		const recordNameID = buffer.readUInt16BE(recordOffset + 6);
		if (recordNameID !== nameID) continue;
		const length = buffer.readUInt16BE(recordOffset + 8);
		const offset = buffer.readUInt16BE(recordOffset + 10);
		const start = nameTableOffset + stringOffset + offset;
		const raw = buffer.subarray(start, start + length);
		const value = decodeNameRecordString(platformID, encodingID, raw).replace(/\0/g, "");
		values.push({ platformID, encodingID, languageID, value });
	}
	const preferred = values.find(r => r.platformID === 3 && r.languageID === 1033);
	const fallback = values.find(r => r.platformID === 3) || values[0];
	if (!fallback) throw new Error(`No nameID ${nameID} found in ${input}`);
	return (preferred || fallback).value;
}

async function readSourceVersion() {
	return readNameTableRecord(SOURCE_VERSION_FONT, 5);
}

function sourceVersionNumber(sourceVersion) {
	const sourceMatch = /\bSource\s+(\d+(?:\.\d+)?)/i.exec(sourceVersion);
	if (sourceMatch) return sourceMatch[1];
	const versionMatch = /\bVersion\s+(\d+(?:\.\d+)?)/i.exec(sourceVersion);
	if (versionMatch) return versionMatch[1];
	return sourceVersion.split(";")[0].replace(/^Version\s+/i, "").trim();
}

function parseList(value, allowed) {
	if (!value) return allowed;
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
		regions: "SC,TC,HC,JP,KR",
		jobs: 1,
		worker: false,
		sourceVersion: null
	};
	for (let i = 2; i < process.argv.length; i++) {
		const arg = process.argv[i];
		if (arg === "--weights") args.weights = process.argv[++i];
		else if (arg === "--regions") args.regions = process.argv[++i];
		else if (arg === "--jobs") args.jobs = Number(process.argv[++i]);
		else if (arg === "--worker") args.worker = true;
		else if (arg === "--source-version") args.sourceVersion = process.argv[++i];
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return {
		weights: parseList(args.weights, Array.from({ length: 27 }, (_, i) => i + 1)),
		regions: args.regions
			.split(",")
			.map(s => s.trim())
		.filter(Boolean),
		jobs: Math.max(1, Number.isFinite(args.jobs) ? Math.floor(args.jobs) : 1),
		worker: args.worker,
		sourceVersion: args.sourceVersion
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

async function runBuildQueue(tasks, jobs, sourceVersion) {
	const script = fileURLToPath(import.meta.url);
	let next = 0;
	let done = 0;
	async function runWorker() {
		while (next < tasks.length) {
			const task = tasks[next++];
			const args = [
				script,
				"--weights",
				String(task.weight),
				"--regions",
				task.region,
				"--source-version",
				sourceVersion,
				"--worker"
			];
			await run(process.execPath, args);
			done++;
			if (done % 5 === 0 || done === tasks.length) {
				console.log(`  ${done}/${tasks.length} TTF done`);
			}
		}
	}
	const workerCount = Math.min(jobs, tasks.length);
	await Promise.all(Array.from({ length: workerCount }, runWorker));
}

async function readFont(input) {
	const buf = await fs.promises.readFile(input);
	const sfnt = FontIo.readSfntOtf(buf);
	return FontIo.readFont(sfnt, Ot.ListGlyphStoreFactory);
}

async function writeFont(output, font) {
	await fs.promises.mkdir(path.dirname(output), { recursive: true });
	const sfnt = FontIo.writeFont(font, { glyphStore: { statOs2XAvgCharWidth: false } });
	let buf = FontIo.writeSfntOtf(sfnt);
	buf = dropSfntTable(buf, "VORG");
	buf = addEmptyDsigTable(buf);
	patchHeadBoundsToHhea(buf);
	await fs.promises.writeFile(output, buf);
}

function aligned4(value) {
	return (value + 3) & ~3;
}

function sfntSearchParams(numTables) {
	const entrySelector = Math.floor(Math.log2(numTables));
	const searchRange = (1 << entrySelector) * 16;
	const rangeShift = numTables * 16 - searchRange;
	return { searchRange, entrySelector, rangeShift };
}

function addEmptyDsigTable(buffer) {
	if (findSfntTable(buffer, "DSIG")) return buffer;

	const tables = [];
	const numTables = buffer.readUInt16BE(4);
	for (let i = 0; i < numTables; i++) {
		const recordOffset = 12 + i * 16;
		const tag = buffer.toString("ascii", recordOffset, recordOffset + 4);
		tables.push({
			tag,
			data: buffer.subarray(
				buffer.readUInt32BE(recordOffset + 8),
				buffer.readUInt32BE(recordOffset + 8) + buffer.readUInt32BE(recordOffset + 12)
			)
		});
	}

	const dsig = Buffer.alloc(8);
	dsig.writeUInt32BE(1, 0);
	dsig.writeUInt16BE(0, 4);
	dsig.writeUInt16BE(0, 6);
	tables.push({ tag: "DSIG", data: dsig });
	tables.sort((a, b) => a.tag.localeCompare(b.tag));

	const outputSize = tables.reduce((size, table) => aligned4(size) + aligned4(table.data.length), 12 + tables.length * 16);
	const output = Buffer.alloc(outputSize);
	output.writeUInt32BE(buffer.readUInt32BE(0), 0);
	output.writeUInt16BE(tables.length, 4);
	const { searchRange, entrySelector, rangeShift } = sfntSearchParams(tables.length);
	output.writeUInt16BE(searchRange, 6);
	output.writeUInt16BE(entrySelector, 8);
	output.writeUInt16BE(rangeShift, 10);

	let dataOffset = 12 + tables.length * 16;
	for (let i = 0; i < tables.length; i++) {
		const table = tables[i];
		dataOffset = aligned4(dataOffset);
		table.data.copy(output, dataOffset);
		const recordOffset = 12 + i * 16;
		output.write(table.tag, recordOffset, 4, "ascii");
		output.writeUInt32BE(tableChecksum(output, dataOffset, table.data.length), recordOffset + 4);
		output.writeUInt32BE(dataOffset, recordOffset + 8);
		output.writeUInt32BE(table.data.length, recordOffset + 12);
		dataOffset += aligned4(table.data.length);
	}
	return output;
}

function dropSfntTable(buffer, tagToDrop) {
	if (!findSfntTable(buffer, tagToDrop)) return buffer;

	const tables = [];
	const numTables = buffer.readUInt16BE(4);
	for (let i = 0; i < numTables; i++) {
		const recordOffset = 12 + i * 16;
		const tag = buffer.toString("ascii", recordOffset, recordOffset + 4);
		if (tag === tagToDrop) continue;
		const offset = buffer.readUInt32BE(recordOffset + 8);
		const length = buffer.readUInt32BE(recordOffset + 12);
		tables.push({
			tag,
			data: buffer.subarray(offset, offset + length)
		});
	}
	tables.sort((a, b) => a.tag.localeCompare(b.tag));

	const outputSize = tables.reduce((size, table) => aligned4(size) + aligned4(table.data.length), 12 + tables.length * 16);
	const output = Buffer.alloc(outputSize);
	output.writeUInt32BE(buffer.readUInt32BE(0), 0);
	output.writeUInt16BE(tables.length, 4);
	const { searchRange, entrySelector, rangeShift } = sfntSearchParams(tables.length);
	output.writeUInt16BE(searchRange, 6);
	output.writeUInt16BE(entrySelector, 8);
	output.writeUInt16BE(rangeShift, 10);

	let dataOffset = 12 + tables.length * 16;
	for (let i = 0; i < tables.length; i++) {
		const table = tables[i];
		dataOffset = aligned4(dataOffset);
		table.data.copy(output, dataOffset);
		const recordOffset = 12 + i * 16;
		output.write(table.tag, recordOffset, 4, "ascii");
		output.writeUInt32BE(tableChecksum(output, dataOffset, table.data.length), recordOffset + 4);
		output.writeUInt32BE(dataOffset, recordOffset + 8);
		output.writeUInt32BE(table.data.length, recordOffset + 12);
		dataOffset += aligned4(table.data.length);
	}
	return output;
}

function findSfntTable(buffer, tag) {
	const numTables = buffer.readUInt16BE(4);
	for (let i = 0; i < numTables; i++) {
		const recordOffset = 12 + i * 16;
		const recordTag = buffer.toString("ascii", recordOffset, recordOffset + 4);
		if (recordTag !== tag) continue;
		return {
			recordOffset,
			offset: buffer.readUInt32BE(recordOffset + 8),
			length: buffer.readUInt32BE(recordOffset + 12)
		};
	}
	return null;
}

function tableChecksum(buffer, offset, length) {
	let sum = 0n;
	const end = offset + Math.ceil(length / 4) * 4;
	for (let pos = offset; pos < end; pos += 4) {
		let value = 0;
		for (let b = 0; b < 4; b++) {
			value = (value << 8) + (pos + b < buffer.length ? buffer[pos + b] : 0);
		}
		sum = (sum + BigInt(value >>> 0)) & 0xffffffffn;
	}
	return Number(sum);
}

function fontChecksum(buffer) {
	return tableChecksum(buffer, 0, buffer.length);
}

function patchHeadBoundsToHhea(buffer) {
	const head = findSfntTable(buffer, "head");
	const hhea = findSfntTable(buffer, "hhea");
	if (!head || !hhea) return;

	const ascender = buffer.readInt16BE(hhea.offset + 4);
	const descender = buffer.readInt16BE(hhea.offset + 6);
	buffer.writeUInt16BE(0x0003, head.offset + 16);
	buffer.writeInt16BE(descender, head.offset + 38);
	buffer.writeInt16BE(ascender, head.offset + 42);
	patchOs2DreamUnicodeRanges(buffer);
	buffer.writeUInt32BE(0, head.offset + 8);

	buffer.writeUInt32BE(tableChecksum(buffer, head.offset, head.length), head.recordOffset + 4);
	const adjustment = Number((0xb1b0afban - BigInt(fontChecksum(buffer))) & 0xffffffffn);
	buffer.writeUInt32BE(adjustment, head.offset + 8);
}

function patchOs2DreamUnicodeRanges(buffer) {
	const os2 = findSfntTable(buffer, "OS/2");
	if (!os2 || os2.length < 58) return;
	for (let i = 0; i < DREAM_UNICODE_RANGES.length; i++) {
		buffer.writeUInt32BE(DREAM_UNICODE_RANGES[i], os2.offset + 42 + i * 4);
	}
	buffer.writeUInt32BE(tableChecksum(buffer, os2.offset, os2.length), os2.recordOffset + 4);
}

function dropCharacters(font, fn) {
	for (const [ch] of font.cmap.unicode.entries()) {
		if (fn(ch)) font.cmap.unicode.delete(ch);
	}
	for (const [ch, vs] of font.cmap.vs.entries()) {
		if (fn(ch)) font.cmap.vs.delete(ch, vs);
	}
}

function dropHints(font) {
	font.cvt = font.fpgm = font.prep = null;
	for (const g of font.glyphs.decideOrder()) g.hints = null;
}

function dropOtl(font) {
	font.gsub = font.gpos = null;
}

function dropFeature(table, featureSet) {
	if (!table || !table.features) return;
	const fs = new Set(featureSet);
	for (const feature of table.features) {
		if (fs.has(feature.tag)) {
			feature.lookups.length = 0;
			feature.params = null;
		}
	}
}

function unifySameFeatures(table) {
	if (!table?.scripts || !table.features) return;
	const nonAliasable = [];
	const aliases = new Map();
	out: for (const feature of table.features) {
		for (const existing of nonAliasable) {
			if (featureAliasable(existing, feature)) {
				aliases.set(feature, existing);
				continue out;
			}
		}
		nonAliasable.push(feature);
	}
	for (const script of table.scripts.values()) {
		if (script.defaultLanguage) aliasLanguageFeatures(script.defaultLanguage, aliases);
		for (const language of script.languages.values()) aliasLanguageFeatures(language, aliases);
	}
}

function aliasLanguageFeatures(language, aliases) {
	if (language.requiredFeature) {
		const alias = aliases.get(language.requiredFeature);
		if (alias) language.requiredFeature = alias;
	}
	for (let i = 0; i < language.features.length; i++) {
		const alias = aliases.get(language.features[i]);
		if (alias) language.features[i] = alias;
	}
}

function featureAliasable(a, b) {
	if (a.tag !== b.tag) return false;
	const lookupsA = new Set(a.lookups);
	const lookupsB = new Set(b.lookups);
	for (const lookup of lookupsA) if (!lookupsB.has(lookup)) return false;
	for (const lookup of lookupsB) if (!lookupsA.has(lookup)) return false;
	return true;
}

function dropGlyphNames(font) {
	if (!font.post) return;
	const oldPost = font.post;
	font.post = new Ot.Post.Table(3, 0);
	font.post.italicAngle = oldPost.italicAngle;
	font.post.underlinePosition = oldPost.underlinePosition;
	font.post.underlineThickness = oldPost.underlineThickness;
	font.post.isFixedPitch = oldPost.isFixedPitch;
}

function isCjkFeatureToneMark(c) {
	return c === 0x02c7 || c === 0x02ca || c === 0x02cb || c === 0x02ea || c === 0x02eb;
}

function isCjkSourceSymbol(c) {
	return c === 0x00b7 ||
		(c >= 0x2010 && c <= 0x2015) ||
		(c >= 0x2018 && c <= 0x201d) ||
		c === 0x2025 ||
		c === 0x2026 ||
		c === 0x2e3a ||
		c === 0x2e3b ||
		(c >= 0x31b4 && c <= 0x31b7);
}

function isFullwidthLatinAlnum(c) {
	return (c >= 0xff10 && c <= 0xff19) ||
		(c >= 0xff21 && c <= 0xff3a) ||
		(c >= 0xff41 && c <= 0xff5a);
}

function isDreamCjkDirectCodepoint(c) {
	return (c >= 0x1100 && c <= 0x11ff) ||
		isCjkSourceSymbol(c) ||
		c === 0x210a ||
		c === 0x210f ||
		c === 0x2126 ||
		c === 0x2127 ||
		c === 0x2135 ||
		(c >= 0x3000 && c <= 0x303f) ||
		(c >= 0xfe10 && c <= 0xfe1f) ||
		(c >= 0xfe30 && c <= 0xfe4f) ||
		(c >= 0xff00 && c <= 0xffef && !isFullwidthLatinAlnum(c));
}

function isWestern(c) {
	if (isFullwidthLatinAlnum(c)) return true;
	if (isCjkFeatureToneMark(c)) return false;
	if (isDreamCjkDirectCodepoint(c)) return false;
	return (c < 0x2000 && c !== 0x00b7) || (c >= 0x2070 && c <= 0x218f);
}

function shouldDropLatinDirectCodepoint(c) {
	return isDreamCjkDirectCodepoint(c) ||
		(c >= 0xe000 && c <= 0xf8ff) ||
		(c >= 0xfe20 && c <= 0xfe2f) ||
		c === 0xfeff ||
		c >= 0x1f000 ||
		c === 0xa69f ||
		c === 0xa7ff ||
		c === 0xa92e;
}

function isKorean(c) {
	return (c >= 0x1100 && c <= 0x11ff) ||
		(c >= 0x3130 && c <= 0x318f) ||
		(c >= 0x3200 && c <= 0x321e) ||
		(c >= 0x3260 && c <= 0x327f) ||
		(c >= 0xa960 && c <= 0xa97f) ||
		(c >= 0xac00 && c <= 0xd7af) ||
		(c >= 0xd7b0 && c <= 0xd7ff) ||
		(c >= 0xffa1 && c <= 0xffdc);
}

function isKoreanSecondary(c) {
	return (c >= 0x1100 && c <= 0x11ff) ||
		(c >= 0x3130 && c <= 0x318f) ||
		(c >= 0x3200 && c <= 0x321e) ||
		(c >= 0x3260 && c <= 0x327f) ||
		(c >= 0xa960 && c <= 0xa97f) ||
		(c >= 0xd7b0 && c <= 0xd7ff) ||
		(c >= 0xffa1 && c <= 0xffdc);
}

function isHangulSyllable(c) {
	return c >= 0xac00 && c <= 0xd7af;
}

function isLowerPriorityHangulSyllable(c) {
	if (!isHangulSyllable(c)) return false;
	const finalIndex = (c - 0xac00) % 28;
	return finalIndex === 3 ||
		finalIndex === 5 ||
		finalIndex === 6 ||
		(finalIndex >= 9 && finalIndex <= 15) ||
		finalIndex === 18;
}

function copyGeometryData(target, source) {
	if (source.horizontal) target.horizontal = { ...source.horizontal };
	if (source.vertical) target.vertical = { ...source.vertical };
	if (source.geometry) {
		target.geometry = new Ot.Glyph.ContourSet(
			Ot.GeometryUtil.apply(Ot.GeometryUtil.Flattener, source.geometry)
		);
	}
}

function flatCloneGlyph(glyph) {
	const cloned = new Ot.Glyph();
	cloned.name = glyph.name;
	copyGeometryData(cloned, glyph);
	cloned.hints = null;
	return cloned;
}

function getAdvanceWidth(glyph) {
	return glyph.horizontal ? glyph.horizontal.end : 0;
}

function setAdvanceWidth(glyph, width) {
	glyph.horizontal = { start: 0, end: width };
}

function shiftContours(glyph, delta) {
	if (!glyph.geometry || !delta) return;
	const contours = Ot.GeometryUtil.apply(Ot.GeometryUtil.Flattener, glyph.geometry);
	for (const contour of contours) {
		for (let i = 0; i < contour.length; i++) {
			const point = contour[i];
			contour[i] = Ot.Glyph.Point.create(point.x + delta, point.y, point.kind);
		}
	}
	glyph.geometry = new Ot.Glyph.ContourSet(contours);
}

function centerGlyphToWidth(font, glyph, width) {
	const advance = getAdvanceWidth(glyph);
	shiftContours(glyph, (width - advance) / 2);
	setAdvanceWidth(glyph, width);
}

function makeGlyphCodepointPredicate(font, codepointPredicate) {
	const cpsByGlyph = new Map();
	for (const [codepoint, glyph] of font.cmap.unicode.entries()) {
		let cps = cpsByGlyph.get(glyph);
		if (!cps) cpsByGlyph.set(glyph, cps = []);
		cps.push(codepoint);
	}
	return glyph => (cpsByGlyph.get(glyph) || []).some(codepointPredicate);
}

function makeGlyphDirectCodepointPredicate(font, glyphPredicate) {
	const cpsByGlyph = new Map();
	for (const [codepoint, glyph] of font.cmap.unicode.entries()) {
		let cps = cpsByGlyph.get(glyph);
		if (!cps) cpsByGlyph.set(glyph, cps = []);
		cps.push(codepoint);
	}
	return glyph => glyphPredicate(cpsByGlyph.get(glyph) || []);
}

function hasMatchingGlyph(glyphs, isMatchingGlyph) {
	for (const glyph of glyphs) if (isMatchingGlyph(glyph)) return true;
	return false;
}

function withoutMatchingGlyphs(glyphSet, isMatchingGlyph) {
	const result = new Set();
	for (const glyph of glyphSet) {
		if (!isMatchingGlyph(glyph)) result.add(glyph);
	}
	return result;
}

function filterMatchingGlyphsFromGsubLookup(lookup, isMatchingGlyph, seen = new Set()) {
	if (!lookup || seen.has(lookup)) return;
	seen.add(lookup);
	if (lookup.ignoreGlyphs) lookup.ignoreGlyphs = withoutMatchingGlyphs(lookup.ignoreGlyphs, isMatchingGlyph);

	if (lookup instanceof Ot.Gsub.Single) {
		for (const [from, to] of Array.from(lookup.mapping.entries())) {
			if (isMatchingGlyph(from) || isMatchingGlyph(to)) lookup.mapping.delete(from);
		}
	} else if (lookup instanceof Ot.Gsub.Multiple || lookup instanceof Ot.Gsub.Alternate) {
		for (const [from, to] of Array.from(lookup.mapping.entries())) {
			if (isMatchingGlyph(from) || hasMatchingGlyph(to, isMatchingGlyph)) lookup.mapping.delete(from);
		}
	} else if (lookup instanceof Ot.Gsub.Ligature) {
		lookup.mapping = lookup.mapping.filter(
			({ from, to }) => !isMatchingGlyph(to) && !hasMatchingGlyph(from, isMatchingGlyph)
		);
	} else if (lookup instanceof Ot.Gsub.ReverseSub) {
		lookup.rules = lookup.rules
			.map(rule => {
				const replacement = new Map();
				for (const [from, to] of rule.replacement) {
					if (!isMatchingGlyph(from) && !isMatchingGlyph(to)) replacement.set(from, to);
				}
				return {
					...rule,
					replacement,
					match: rule.match.map(set => withoutMatchingGlyphs(set, isMatchingGlyph))
				};
			})
			.filter(rule => rule.replacement.size && rule.match.every(set => set.size));
	} else if (lookup instanceof Ot.Gsub.Chaining) {
		for (const rule of lookup.rules) {
			for (const app of rule.applications) {
				filterMatchingGlyphsFromGsubLookup(app.apply, isMatchingGlyph, seen);
			}
		}
		lookup.rules = lookup.rules
			.map(rule => ({
				...rule,
				match: rule.match.map(set => withoutMatchingGlyphs(set, isMatchingGlyph))
			}))
			.filter(rule => rule.match.every(set => set.size));
	}
}

function filterMatchingGlyphsFromGsub(table, isMatchingGlyph) {
	if (!table?.lookups) return;
	for (const lookup of table.lookups) {
		filterMatchingGlyphsFromGsubLookup(lookup, isMatchingGlyph);
	}
}

function cjkInstance(regionCode, weight) {
	const w = weightName(weight);
	return path.join(BUILD, "instances", "cjk", regionCode, `NexusHanSans${regionCode}-CJK-${w}.ttf`);
}

function latinInstance(weight) {
	return path.join(BUILD, "instances", "pretendard-std", `PretendardStd-${weightName(weight)}.ttf`);
}

function fullwidthLatinInstance(weight) {
	return path.join(BUILD, "instances", "pretendard-jp", `PretendardJP-${weightName(weight)}.ttf`);
}

function gc(font) {
	CliProc.gcFont(font, Ot.ListGlyphStoreFactory);
}

function debugFontCounts(label, font) {
	if (!process.env.NEXUS_DEBUG_COUNTS) return;
	const glyphCount = font.glyphs?.decideOrder().length ?? 0;
	const cmapCount = font.cmap?.unicode?.size ?? 0;
	console.log(`${label}: glyphs=${glyphCount} cmap=${cmapCount}`);
}

async function makeCjkComponent(input) {
	const font = await readFont(input);
	dropHints(font);
	const isWesternGlyph = makeGlyphCodepointPredicate(font, isWestern);
	filterMatchingGlyphsFromGsub(font.gsub, isWesternGlyph);
	dropCharacters(font, isWestern);
	gc(font);
	return font;
}

function makeAllowedLatinCodepoints(cjkSource) {
	const allowed = new Set();
	for (const [codepoint] of cjkSource.cmap.unicode.entries()) {
		if (isWestern(codepoint)) allowed.add(codepoint);
	}
	return allowed;
}

function filterLatinComponent(font, cjkSource, regionCode) {
	const allowedLatinCodepoints = makeAllowedLatinCodepoints(cjkSource);
	const allowExtraLatinCodepoints = regionCode !== "KR";
	const shouldDropCodepoint = codepoint =>
		allowExtraLatinCodepoints
			? isDreamCjkDirectCodepoint(codepoint)
			: shouldDropLatinDirectCodepoint(codepoint) || !allowedLatinCodepoints.has(codepoint);
	const isDroppedDirectGlyph = makeGlyphDirectCodepointPredicate(font, codepoints =>
		codepoints.length > 0 && codepoints.every(shouldDropCodepoint)
	);
	filterMatchingGlyphsFromGsub(font.gsub, isDroppedDirectGlyph);
	dropCharacters(font, shouldDropCodepoint);
	gc(font);
}

async function makeFullwidthLatinComponent(input) {
	const font = await readFont(input);
	if (font.head.unitsPerEm !== 1000) CliProc.rebaseFont(font, 1000);
	dropHints(font);
	dropOtl(font);
	dropCharacters(font, codepoint => !isFullwidthLatinAlnum(codepoint));
	const em = font.head.unitsPerEm;
	for (const [codepoint, glyph] of font.cmap.unicode.entries()) {
		if (isFullwidthLatinAlnum(codepoint)) centerGlyphToWidth(font, glyph, em);
	}
	gc(font);
	return font;
}

function initVerticalMetrics(main, cjkMetricsSource) {
	if (cjkMetricsSource.vhea) main.vhea = cjkMetricsSource.vhea;
	if (cjkMetricsSource.base) main.base = cjkMetricsSource.base;
	const em = main.head.unitsPerEm;
	for (const glyph of main.glyphs.decideOrder()) {
		if (glyph.vertical && glyph.vertical.start !== glyph.vertical.end) continue;
		glyph.vertical = {
			start: em * 0.88,
			end: em * -0.12
		};
	}
}

function addTrivialGdef(font) {
	if (!font.gdef) font.gdef = new Ot.Gdef.Table();
	if (!font.gdef.glyphClassDef || !font.gdef.glyphClassDef.size) {
		font.gdef.glyphClassDef = new Map();
		for (const g of font.glyphs.decideOrder()) {
			font.gdef.glyphClassDef.set(g, Ot.Gdef.GlyphClass.Base);
		}
	}
}

function shareFeatures(table) {
	if (!table?.scripts) return;
	const langDflt = table.scripts.get("DFLT")?.defaultLanguage;
	if (!langDflt?.features) return;
	for (const [scriptTag, script] of table.scripts) {
		if (script.defaultLanguage && isFarEastScript(scriptTag)) {
			script.defaultLanguage.features = [
				...script.defaultLanguage.features,
				...langDflt.features
			];
		}
		for (const [languageTag, language] of script.languages) {
			if (isFarEastScript(scriptTag) || isFarEastLanguage(languageTag)) {
				language.features = [
					...language.features,
					...langDflt.features
				];
			}
		}
	}
}

function isFarEastScript(tag) {
	return tag === "hani" || tag === "kana" || tag === "bopo" || tag === "hang";
}

function isFarEastLanguage(tag) {
	const normalized = tag.trim();
	return normalized === "JAN" ||
		normalized === "KOR" ||
		normalized === "ZHS" ||
		normalized === "ZHT" ||
		normalized === "ZHH";
}

function simplifySingleSub(table, tag) {
	if (!table?.features || !table.lookups) return;
	for (const feature of table.features) {
		if (feature.tag !== tag) continue;
		const mapping = new Map();
		for (const lookup of feature.lookups) {
			if (!(lookup instanceof Ot.Gsub.Single)) continue;
			for (const [from, to] of lookup.mapping) mapping.set(from, to);
		}
		if (!mapping.size) continue;
		const newLookup = new Ot.Gsub.Single({ mapping });
		feature.lookups = [newLookup];
		table.lookups.push(newLookup);
	}
}

function glyphCount(font) {
	return font.glyphs.decideOrder().length;
}

function dropCodepointSet(font, codepoints) {
	dropCharacters(font, c => codepoints.has(c));
}

function trimHangulSyllablesToFit(font, candidatePredicate) {
	let over = glyphCount(font) - DREAM_GLYPH_COUNT;
	if (over <= 0) return true;
	const candidates = Array.from(font.cmap.unicode.entries(), ([codepoint]) => codepoint)
		.filter(candidatePredicate)
		.sort((a, b) => b - a);
	let cursor = 0;
	while (over > 0 && cursor < candidates.length) {
		const dropCount = Math.min(candidates.length - cursor, over + 32);
		const dropped = new Set(candidates.slice(cursor, cursor + dropCount));
		cursor += dropCount;
		dropCodepointSet(font, dropped);
		gc(font);
		over = glyphCount(font) - DREAM_GLYPH_COUNT;
	}
	return over <= 0;
}

function trimKoreanToFit(font, regionCode) {
	if (regionCode === "JP") return trimJapaneseKorean(font);
	if (glyphCount(font) <= DREAM_GLYPH_COUNT) return false;
	if (regionCode === "KR") {
		throw new Error(`Glyph count ${glyphCount(font)} exceeds TrueType limit ${DREAM_GLYPH_COUNT}; refusing to trim Korean in KR`);
	}

	const isKoreanGlyph = makeGlyphCodepointPredicate(font, isKorean);
	dropFeature(font.gsub, ["ljmo", "tjmo", "vjmo"]);
	filterMatchingGlyphsFromGsub(font.gsub, isKoreanGlyph);
	gc(font);
	debugFontCounts("after Korean OTL trim", font);
	if (glyphCount(font) <= DREAM_GLYPH_COUNT) return true;

	if (trimHangulSyllablesToFit(font, isLowerPriorityHangulSyllable)) {
		debugFontCounts("after lower-priority Hangul trim", font);
		return true;
	}
	if (trimHangulSyllablesToFit(font, isHangulSyllable)) {
		debugFontCounts("after fallback Hangul trim", font);
		return true;
	}
	dropCharacters(font, isKoreanSecondary);
	gc(font);
	debugFontCounts("after secondary Korean trim", font);
	if (glyphCount(font) <= DREAM_GLYPH_COUNT) return true;
	throw new Error(`Glyph count ${glyphCount(font)} still exceeds TrueType limit ${DREAM_GLYPH_COUNT} after Korean trim`);
}

function trimJapaneseKorean(font) {
	const isKoreanGlyph = makeGlyphCodepointPredicate(font, isKorean);
	dropFeature(font.gsub, ["ljmo", "tjmo", "vjmo"]);
	filterMatchingGlyphsFromGsub(font.gsub, isKoreanGlyph);
	gc(font);
	debugFontCounts("after JP Korean OTL trim", font);

	dropCharacters(font, isKoreanSecondary);
	gc(font);
	debugFontCounts("after JP secondary Korean trim", font);
	if (glyphCount(font) <= DREAM_GLYPH_COUNT) return true;

	if (trimHangulSyllablesToFit(font, isLowerPriorityHangulSyllable)) {
		debugFontCounts("after JP lower-priority Hangul trim", font);
		return true;
	}
	if (trimHangulSyllablesToFit(font, isHangulSyllable)) {
		debugFontCounts("after JP fallback Hangul trim", font);
		return true;
	}
	throw new Error(`Glyph count ${glyphCount(font)} still exceeds TrueType limit ${DREAM_GLYPH_COUNT} after JP Korean trim`);
}

function preserveDreamGlyphCount(font, cjkSource, options = {}) {
	const skipGlyph = options.skipGlyph || (() => false);
	const existing = Array.from(font.glyphs.decideOrder());
	if (existing.length > DREAM_GLYPH_COUNT) {
		throw new Error(`Glyph count ${existing.length} exceeds TrueType limit ${DREAM_GLYPH_COUNT}`);
	}
	if (existing.length === DREAM_GLYPH_COUNT) return;

	const existingNames = new Set(existing.map(g => g.name).filter(Boolean));
	const extras = [];
	for (const sourceGlyph of cjkSource.glyphs.decideOrder()) {
		if (existing.length + extras.length >= DREAM_GLYPH_COUNT) break;
		if (skipGlyph(sourceGlyph)) continue;
		if (sourceGlyph.name && existingNames.has(sourceGlyph.name)) continue;
		const glyph = flatCloneGlyph(sourceGlyph);
		extras.push(glyph);
		if (glyph.name) existingNames.add(glyph.name);
	}
	font.glyphs = Ot.ListGlyphStoreFactory.createStoreFromList([...existing, ...extras]);
}

function scaleMetric(value, sourceUpm) {
	return Math.round(value * DREAM_TARGET_UPM / sourceUpm);
}

function applyDreamOutputSpecs(font, cjkMetricsSource) {
	const sourceUpm = cjkMetricsSource.head.unitsPerEm;
	if (font.head.unitsPerEm !== DREAM_TARGET_UPM) CliProc.rebaseFont(font, DREAM_TARGET_UPM);

	copyOs2RangesFromSource(font, cjkMetricsSource);
	[
		font.os2.ulUnicodeRange1,
		font.os2.ulUnicodeRange2,
		font.os2.ulUnicodeRange3,
		font.os2.ulUnicodeRange4
	] = DREAM_UNICODE_RANGES;
	font.os2.version = 4;
	copyOs2ProportionMetricsFromSource(font, cjkMetricsSource, sourceUpm);
	font.os2.sTypoAscender = scaleMetric(cjkMetricsSource.os2.sTypoAscender, sourceUpm);
	font.os2.sTypoDescender = scaleMetric(cjkMetricsSource.os2.sTypoDescender, sourceUpm);
	font.os2.sTypoLineGap = scaleMetric(cjkMetricsSource.os2.sTypoLineGap, sourceUpm);
	font.os2.usWinAscent = scaleMetric(cjkMetricsSource.os2.usWinAscent, sourceUpm);
	font.os2.usWinDescent = scaleMetric(cjkMetricsSource.os2.usWinDescent, sourceUpm);
	font.hhea.ascender = scaleMetric(cjkMetricsSource.hhea.ascender, sourceUpm);
	font.hhea.descender = scaleMetric(cjkMetricsSource.hhea.descender, sourceUpm);
	font.hhea.lineGap = scaleMetric(cjkMetricsSource.hhea.lineGap, sourceUpm);
	font.hhea.caretSlopeRise = 1;
	font.hhea.caretSlopeRun = 0;
	if (font.vhea) {
		font.vhea.caretSlopeRise = 0;
		font.vhea.caretSlopeRun = 1;
	}

	font.head.yMax = font.hhea.ascender;
	font.head.yMin = font.hhea.descender;
	font.gasp = new Ot.Gasp.Table([
		new Ot.Gasp.Range(DREAM_GLYPH_COUNT, DREAM_GASP_BEHAVIOR)
	]);
	font.prep = new Ot.Prep.Table(Buffer.from(DREAM_PREP_PROGRAM));
	font.fpgm = null;
	font.cvt = null;
	for (const glyph of font.glyphs.decideOrder()) glyph.hints = null;
}

function copyOs2RangesFromSource(font, cjkMetricsSource) {
	for (const field of [
		"ulUnicodeRange1",
		"ulUnicodeRange2",
		"ulUnicodeRange3",
		"ulUnicodeRange4",
		"ulCodePageRange1",
		"ulCodePageRange2"
	]) {
		if (cjkMetricsSource.os2[field] !== undefined) font.os2[field] = cjkMetricsSource.os2[field];
	}
}

function copyOs2ProportionMetricsFromSource(font, cjkMetricsSource, sourceUpm) {
	for (const field of [
		"xAvgCharWidth",
		"ySubscriptXSize",
		"ySubscriptYSize",
		"ySubscriptXOffset",
		"ySubscriptYOffset",
		"ySuperscriptXSize",
		"ySuperscriptYSize",
		"ySuperscriptXOffset",
		"ySuperscriptYOffset",
		"yStrikeoutSize",
		"yStrikeoutPosition",
		"sCapHeight",
		"sxHeight"
	]) {
		if (cjkMetricsSource.os2[field] !== undefined) {
			font.os2[field] = scaleMetric(cjkMetricsSource.os2[field], sourceUpm);
		}
	}
	if (cjkMetricsSource.os2.panose) font.os2.panose = cjkMetricsSource.os2.panose;
	if (cjkMetricsSource.os2.sFamilyClass !== undefined) font.os2.sFamilyClass = cjkMetricsSource.os2.sFamilyClass;
	if (cjkMetricsSource.os2.fsType !== undefined) font.os2.fsType = cjkMetricsSource.os2.fsType;
}

function nameEntry(languageID, nameID, value, encodingID = 1) {
	return { platformID: 3, encodingID, languageID, nameID, value };
}

function addName(records, languageID, nameID, value, encodingIDs = [1]) {
	for (const encodingID of encodingIDs) records.push(nameEntry(languageID, nameID, value, encodingID));
}

function addEnglishName(records, nameID, value) {
	addName(records, 0x0409, nameID, value, [1, 10]);
}

function dreamLegacyFamilyName(family, weight) {
	if (weight === STYLE_LINK_REGULAR || weight === STYLE_LINK_BOLD) return family;
	return `${family} ${weightName(weight)}`;
}

function dreamLegacySubfamilyName(weight) {
	if (weight === STYLE_LINK_BOLD) return "Bold";
	return "Regular";
}

function dreamFullName(family, weight) {
	return `${family} ${weightName(weight)}`;
}

function dreamPostScriptName(family, weight) {
	return `${family.replace(/ /g, "")}-${weightName(weight)}`;
}

function nexusVersionString(sourceVersion) {
	return `Version ${NEXUS_VERSION}; Source ${sourceVersionNumber(sourceVersion)}`;
}

function createEnglishNameTuple(records, family, weight, sourceVersion) {
	const style = weightName(weight);
	const legacyFamily = dreamLegacyFamilyName(family, weight);
	const legacySubfamily = dreamLegacySubfamilyName(weight);
	const fullName = dreamFullName(family, weight);
	const postScriptName = dreamPostScriptName(family, weight);
	addEnglishName(records, 1, legacyFamily);
	addEnglishName(records, 2, legacySubfamily);
	addEnglishName(records, 3, `${fullName}; ${nexusVersionString(sourceVersion)}`);
	addEnglishName(records, 4, fullName);
	addEnglishName(records, 6, postScriptName);
	addEnglishName(records, 16, family);
	addEnglishName(records, 17, style);
}

function createLocalizedNameTuple(records, languageID, family, weight) {
	const style = weightName(weight);
	const legacyFamily = dreamLegacyFamilyName(family, weight);
	const legacySubfamily = dreamLegacySubfamilyName(weight);
	addName(records, languageID, 1, legacyFamily);
	addName(records, languageID, 2, legacySubfamily);
	addName(records, languageID, 4, dreamFullName(family, weight));
	addName(records, languageID, 16, family);
	addName(records, languageID, 17, style);
}

function setMetadata(font, region, weight, sourceVersion) {
	const records = [];
	createEnglishNameTuple(records, region.en, weight, sourceVersion);
	if (region.local.zh_CN) createLocalizedNameTuple(records, 2052, region.local.zh_CN, weight);
	if (region.local.zh_TW) createLocalizedNameTuple(records, 1028, region.local.zh_TW, weight);
	if (region.local.zh_HK) createLocalizedNameTuple(records, 3076, region.local.zh_HK, weight);
	if (region.local.ja_JP) createLocalizedNameTuple(records, 1041, region.local.ja_JP, weight);
	if (region.local.ko_KR) createLocalizedNameTuple(records, 1042, region.local.ko_KR, weight);
	addEnglishName(records, 0, `${region.en} is free to use under OFL license.`);
	addEnglishName(records, 5, nexusVersionString(sourceVersion));
	addEnglishName(records, 7, `${region.en} is not any registered trademark.`);
	addEnglishName(records, 8, "Nexus Han Sans contributors");
	addEnglishName(records, 9, "Adobe; Pretendard contributors");
	addEnglishName(
		records,
		10,
		"Nexus Han Sans is compiled from Source Han Sans and Pretendard Std."
	);
	addEnglishName(records, 11, "https://github.com/");
	addEnglishName(records, 12, "http://www.adobe.com/type/");
	addEnglishName(
		records,
		13,
		'This Font Software is licensed under the SIL Open Font License, Version 1.1. This Font Software is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the SIL Open Font License for the specific language, permissions and limitations governing your use of this Font Software.'
	);
	addEnglishName(records, 14, "http://scripts.sil.org/OFL");
	font.name.records = records;

	font.head.fontRevision = NEXUS_FONT_REVISION;

	font.os2.usWeightClass = weightValue(weight);
	font.os2.fsSelection &= ~Ot.Os2.FsSelection.USE_TYPO_METRICS;
	font.os2.fsSelection |= Ot.Os2.FsSelection.WWS;
	font.os2.fsSelection &= ~Ot.Os2.FsSelection.REGULAR;
	font.os2.fsSelection &= ~Ot.Os2.FsSelection.BOLD;
	if (weight === STYLE_LINK_REGULAR) font.os2.fsSelection |= Ot.Os2.FsSelection.REGULAR;
	if (weight === STYLE_LINK_BOLD) font.os2.fsSelection |= Ot.Os2.FsSelection.BOLD;
	font.os2.achVendID = "NXHS";

	if (region.enc.jis) font.os2.ulCodePageRange1 |= Ot.Os2.CodePageRange1.CP932;
	if (region.enc.gbk) font.os2.ulCodePageRange1 |= Ot.Os2.CodePageRange1.CP936;
	if (region.enc.korean) font.os2.ulCodePageRange1 |= Ot.Os2.CodePageRange1.CP949 | Ot.Os2.CodePageRange1.CP1361;
	if (region.enc.big5) font.os2.ulCodePageRange1 |= Ot.Os2.CodePageRange1.CP950;
	font.os2.ulCodePageRange1 |= Ot.Os2.CodePageRange1.CP1252;
	font.os2.ulCodePageRange2 |= Ot.Os2.CodePageRange2.CP437;

	font.head.flags =
		Ot.Head.Flags.BaseLineYAt0 |
		Ot.Head.Flags.LeftSidebearingAtX0;

	font.stat = null;
	font.fvar = null;
	font.avar = null;
}

function ttfOutputPath(regionCode, weight) {
	return path.join(RELEASE, "TTF", `NexusHanSans${regionCode}-${weightName(weight)}.ttf`);
}

async function buildOne(regionCode, weight, sourceVersion) {
	const region = REGIONS[regionCode];
	if (!region) throw new Error(`Unknown region ${regionCode}`);

	const output = ttfOutputPath(regionCode, weight);
	const latin = await readFont(latinInstance(weight));
	if (latin.head.unitsPerEm !== 1000) CliProc.rebaseFont(latin, 1000);

	const cjkPath = cjkInstance(region.cjk, weight);
	const cjkFull = await readFont(cjkPath);
	filterLatinComponent(latin, cjkFull, regionCode);
	const fullwidthLatin = await makeFullwidthLatinComponent(fullwidthLatinInstance(weight));
	CliProc.mergeFonts(latin, fullwidthLatin, Ot.ListGlyphStoreFactory, { preferOverride: true });
	debugFontCounts("latin", latin);
	const cjk = await makeCjkComponent(cjkPath);
	debugFontCounts("cjkFull", cjkFull);
	debugFontCounts("cjk", cjk);

	const main = cjk;
	CliProc.mergeFonts(main, latin, Ot.ListGlyphStoreFactory, { preferOverride: true });
	debugFontCounts("after latin", main);

	initVerticalMetrics(main, cjk);
	shareFeatures(main.gsub);
	shareFeatures(main.gpos);
	CliProc.consolidateFont(main);
	debugFontCounts("after consolidate", main);
	gc(main);
	debugFontCounts("after final gc", main);
	const trimmedKorean = trimKoreanToFit(main, regionCode);
	if (trimmedKorean) debugFontCounts("after Korean trim", main);
	const preserveSkipGlyph = regionCode === "JP"
		? makeGlyphCodepointPredicate(cjkFull, isKoreanSecondary)
		: undefined;
	preserveDreamGlyphCount(main, cjkFull, preserveSkipGlyph ? { skipGlyph: preserveSkipGlyph } : {});
	debugFontCounts("after preserveDreamGlyphCount", main);
	dropGlyphNames(main);
	simplifySingleSub(main.gsub, "vert");
	simplifySingleSub(main.gsub, "vrt2");
	setMetadata(main, region, weight, sourceVersion);
	applyDreamOutputSpecs(main, cjkFull);
	debugFontCounts("after applyDreamOutputSpecs", main);

	await writeFont(output, main);
	return output;
}

async function main() {
	const { weights, regions, jobs, worker, sourceVersion: passedSourceVersion } = parseArgs();
	const sourceVersion = passedSourceVersion || await readSourceVersion();
	if (!worker) console.log(`Using Source Han Sans version: ${sourceVersion}`);
	if (!worker && jobs > 1) {
		const tasks = [];
		for (const weight of weights) {
			for (const region of regions) {
				tasks.push({ weight, region });
			}
		}
		console.log(`Building ${tasks.length} TTF files with ${Math.min(jobs, tasks.length)} parallel job(s).`);
		await runBuildQueue(tasks, jobs, sourceVersion);
		return;
	}
	for (const weight of weights) {
		for (const region of regions) {
			const output = await buildOne(region, weight, sourceVersion);
			console.log(`built ${output}`);
		}
	}
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
