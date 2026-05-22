import fs from "fs";

const TTC_TAG = "ttcf";
const TTC_V1 = 0x00010000;
const TTC_V2 = 0x00020000;
const EMPTY_DSIG = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
const CHECKSUM_MAGIC = 0xb1b0afban;
const DREAM_UNICODE_RANGES = [805306499, 736050192, 22, 0];

function aligned4(value) {
	return (value + 3) & ~3;
}

function sfntSearchParams(numTables) {
	const entrySelector = Math.floor(Math.log2(numTables));
	const searchRange = (1 << entrySelector) * 16;
	const rangeShift = numTables * 16 - searchRange;
	return { searchRange, entrySelector, rangeShift };
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

function parseFontDirectory(buffer, fontOffset) {
	const scaler = buffer.readUInt32BE(fontOffset);
	const numTables = buffer.readUInt16BE(fontOffset + 4);
	const records = [];
	for (let i = 0; i < numTables; i++) {
		const recordOffset = fontOffset + 12 + i * 16;
		records.push({
			tag: buffer.toString("ascii", recordOffset, recordOffset + 4),
			checksum: buffer.readUInt32BE(recordOffset + 4),
			offset: buffer.readUInt32BE(recordOffset + 8),
			length: buffer.readUInt32BE(recordOffset + 12)
		});
	}
	return {
		scaler,
		numTables,
		dirLength: 12 + numTables * 16,
		records
	};
}

function findTable(buffer, fontOffset, tag) {
	const directory = parseFontDirectory(buffer, fontOffset);
	return directory.records.find(record => record.tag === tag) || null;
}

function trimHeadBoundsToHhea(buffer, fontOffset) {
	const head = findTable(buffer, fontOffset, "head");
	const hhea = findTable(buffer, fontOffset, "hhea");
	if (!head || !hhea) return;

	const ascender = buffer.readInt16BE(hhea.offset + 4);
	const descender = buffer.readInt16BE(hhea.offset + 6);
	buffer.writeUInt16BE(0x0003, head.offset + 16);
	buffer.writeInt16BE(descender, head.offset + 38);
	buffer.writeInt16BE(ascender, head.offset + 42);
	patchOs2DreamUnicodeRanges(buffer, fontOffset);
}

function patchOs2DreamUnicodeRanges(buffer, fontOffset) {
	const os2 = findTable(buffer, fontOffset, "OS/2");
	if (!os2 || os2.length < 58) return;
	for (let i = 0; i < DREAM_UNICODE_RANGES.length; i++) {
		buffer.writeUInt32BE(DREAM_UNICODE_RANGES[i], os2.offset + 42 + i * 4);
	}
}

function patchFontChecksum(buffer, fontOffset) {
	const directory = parseFontDirectory(buffer, fontOffset);
	const head = findTable(buffer, fontOffset, "head");
	if (!head) return;

	trimHeadBoundsToHhea(buffer, fontOffset);
	buffer.writeUInt32BE(0, head.offset + 8);
	const headRecordIndex = directory.records.findIndex(record => record.tag === "head");
	const headRecordOffset = fontOffset + 12 + headRecordIndex * 16;
	buffer.writeUInt32BE(tableChecksum(buffer, head.offset, head.length), headRecordOffset + 4);
	const os2RecordIndex = directory.records.findIndex(record => record.tag === "OS/2");
	if (os2RecordIndex >= 0) {
		const os2 = directory.records[os2RecordIndex];
		const os2RecordOffset = fontOffset + 12 + os2RecordIndex * 16;
		buffer.writeUInt32BE(tableChecksum(buffer, os2.offset, os2.length), os2RecordOffset + 4);
	}

	const refreshed = parseFontDirectory(buffer, fontOffset);
	let sum = BigInt(tableChecksum(buffer, fontOffset, 12 + refreshed.numTables * 16));
	for (const record of refreshed.records) {
		sum = (sum + BigInt(tableChecksum(buffer, record.offset, record.length))) & 0xffffffffn;
	}
	const adjustment = Number((CHECKSUM_MAGIC - sum) & 0xffffffffn);
	buffer.writeUInt32BE(adjustment, head.offset + 8);
}

function countExpansionsBefore(expansionPoints, position) {
	let count = 0;
	for (const point of expansionPoints) {
		if (point <= position) count++;
	}
	return count;
}

function shiftedOffset(expansionPoints, position) {
	return position + countExpansionsBefore(expansionPoints, position) * 16;
}

function copyWithDirectoryGaps(buffer, expansionPoints, output, appendedDsigOffset) {
	let inputPos = 0;
	let outputPos = 0;
	for (const point of expansionPoints) {
		buffer.copy(output, outputPos, inputPos, point);
		outputPos += point - inputPos + 16;
		inputPos = point;
	}
	buffer.copy(output, outputPos, inputPos);
	if (appendedDsigOffset !== null) EMPTY_DSIG.copy(output, appendedDsigOffset);
}

function writeFontDirectory(output, fontOffset, directory, expansionPoints, dsigOffset) {
	const records = [
		...directory.records.filter(record => record.tag !== "DSIG" && record.tag !== "VORG").map(record => ({
			...record,
			offset: shiftedOffset(expansionPoints, record.offset)
		})),
		{
			tag: "DSIG",
			checksum: tableChecksum(EMPTY_DSIG, 0, EMPTY_DSIG.length),
			offset: dsigOffset,
			length: EMPTY_DSIG.length
		}
	].sort((a, b) => a.tag.localeCompare(b.tag));

	output.writeUInt32BE(directory.scaler, fontOffset);
	output.writeUInt16BE(records.length, fontOffset + 4);
	const { searchRange, entrySelector, rangeShift } = sfntSearchParams(records.length);
	output.writeUInt16BE(searchRange, fontOffset + 6);
	output.writeUInt16BE(entrySelector, fontOffset + 8);
	output.writeUInt16BE(rangeShift, fontOffset + 10);

	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		const recordOffset = fontOffset + 12 + i * 16;
		output.write(record.tag, recordOffset, 4, "ascii");
		output.writeUInt32BE(record.checksum, recordOffset + 4);
		output.writeUInt32BE(record.offset, recordOffset + 8);
		output.writeUInt32BE(record.length, recordOffset + 12);
	}
}

export function addPerFontEmptyDsigToTtc(buffer) {
	if (buffer.toString("ascii", 0, 4) !== TTC_TAG) return buffer;
	const version = buffer.readUInt32BE(4);
	if (version !== TTC_V1 && version !== TTC_V2) {
		throw new Error("Expected TTC version 1 or 2 input before adding per-font DSIG tables.");
	}

	const numFonts = buffer.readUInt32BE(8);
	const dsigFieldOffset = 12 + numFonts * 4;
	const headerDsig = version === TTC_V2 ? {
		tag: buffer.toString("ascii", dsigFieldOffset, dsigFieldOffset + 4),
		length: buffer.readUInt32BE(dsigFieldOffset + 4),
		offset: buffer.readUInt32BE(dsigFieldOffset + 8)
	} : null;
	const fontOffsets = Array.from({ length: numFonts }, (_, i) => buffer.readUInt32BE(12 + i * 4));
	const directories = fontOffsets.map(offset => parseFontDirectory(buffer, offset));
	const hasAllPerFontDsig = directories.every(directory => directory.records.some(record => record.tag === "DSIG"));
	const hasAnyVorg = directories.some(directory => directory.records.some(record => record.tag === "VORG"));
	if (hasAllPerFontDsig && !hasAnyVorg) {
		const output = Buffer.from(buffer);
		for (const fontOffset of fontOffsets) patchFontChecksum(output, fontOffset);
		return output.equals(buffer) ? buffer : output;
	}

	const expansionPoints = fontOffsets
		.map((offset, index) => offset + directories[index].dirLength)
		.sort((a, b) => a - b);
	const hasHeaderDsig = headerDsig?.tag === "DSIG" && headerDsig.length > 0;
	const dsigOffset = hasHeaderDsig
		? shiftedOffset(expansionPoints, headerDsig.offset)
		: aligned4(buffer.length + expansionPoints.length * 16);
	const output = Buffer.alloc(hasHeaderDsig ? buffer.length + expansionPoints.length * 16 : dsigOffset + EMPTY_DSIG.length);
	copyWithDirectoryGaps(buffer, expansionPoints, output, hasHeaderDsig ? null : dsigOffset);

	for (let i = 0; i < numFonts; i++) {
		const newFontOffset = shiftedOffset(expansionPoints, fontOffsets[i]);
		output.writeUInt32BE(newFontOffset, 12 + i * 4);
		writeFontDirectory(output, newFontOffset, directories[i], expansionPoints, dsigOffset);
	}
	if (version === TTC_V2) {
		output.write("DSIG", dsigFieldOffset, 4, "ascii");
		output.writeUInt32BE(hasHeaderDsig ? headerDsig.length : EMPTY_DSIG.length, dsigFieldOffset + 4);
		output.writeUInt32BE(dsigOffset, dsigFieldOffset + 8);
	}

	for (let i = 0; i < numFonts; i++) {
		patchFontChecksum(output, shiftedOffset(expansionPoints, fontOffsets[i]));
	}
	return output;
}

export async function addEmptyTtcDsigToFile(file) {
	const input = await fs.promises.readFile(file);
	const output = addPerFontEmptyDsigToTtc(input);
	if (output !== input) await fs.promises.writeFile(file, output);
}
