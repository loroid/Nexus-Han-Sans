import { FontIo, Ot } from "ot-builder";

if (!FontIo || !Ot) {
	throw new Error("ot-builder did not load correctly.");
}

console.log("ot-builder environment OK");
