class ZipAssetArchive {
    constructor(file, entries, projectEntry) {
        this.file = file;
        this.entries = entries;
        this.projectEntry = projectEntry;
        this.projectDirectory = projectEntry.name.includes("/")
            ? projectEntry.name.slice(0, projectEntry.name.lastIndexOf("/"))
            : "";
        this.pendingReads = new Map();
    }

    static async open(file) {
        if (!file || typeof file.slice !== "function" || typeof file.size !== "number")
            throw new Error("The selected file could not be read as a ZIP archive.");

        const tailOffset = Math.max(0, file.size - 65557);
        const tail = new DataView(await file.slice(tailOffset).arrayBuffer());
        let endOffset = -1;

        for (let offset = tail.byteLength - 22; offset >= 0; offset--) {
            if (tail.getUint32(offset, true) === 0x06054b50) {
                const commentLength = tail.getUint16(offset + 20, true);
                if (offset + 22 + commentLength === tail.byteLength) {
                    endOffset = offset;
                    break;
                }
            }
        }

        if (endOffset < 0)
            throw new Error("This file is not a valid ZIP archive.");

        const diskNumber = tail.getUint16(endOffset + 4, true);
        const directoryDisk = tail.getUint16(endOffset + 6, true);
        const entriesOnDisk = tail.getUint16(endOffset + 8, true);
        const entryCount = tail.getUint16(endOffset + 10, true);
        const directorySize = tail.getUint32(endOffset + 12, true);
        const directoryOffset = tail.getUint32(endOffset + 16, true);

        if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount)
            throw new Error("Multi-disk ZIP archives are not supported.");
        if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff)
            throw new Error("ZIP64 archives are not supported yet.");
        if (directoryOffset + directorySize > file.size)
            throw new Error("The ZIP archive has an invalid file index.");

        const directory = new DataView(
            await file.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer()
        );
        const decoder = new TextDecoder();
        const entries = new Map();
        let offset = 0;

        for (let index = 0; index < entryCount; index++) {
            if (offset + 46 > directory.byteLength || directory.getUint32(offset, true) !== 0x02014b50)
                throw new Error("The ZIP archive has a corrupted file index.");

            const flags = directory.getUint16(offset + 8, true);
            const method = directory.getUint16(offset + 10, true);
            const compressedSize = directory.getUint32(offset + 20, true);
            const uncompressedSize = directory.getUint32(offset + 24, true);
            const nameLength = directory.getUint16(offset + 28, true);
            const extraLength = directory.getUint16(offset + 30, true);
            const commentLength = directory.getUint16(offset + 32, true);
            const startDisk = directory.getUint16(offset + 34, true);
            const localOffset = directory.getUint32(offset + 42, true);
            const nameStart = offset + 46;
            const recordEnd = nameStart + nameLength + extraLength + commentLength;

            if (recordEnd > directory.byteLength)
                throw new Error("The ZIP archive has a truncated file index.");
            if (startDisk !== 0 || compressedSize === 0xffffffff ||
                uncompressedSize === 0xffffffff || localOffset === 0xffffffff)
                throw new Error("ZIP64 or multi-disk entries are not supported.");

            const name = decoder.decode(
                new Uint8Array(directory.buffer, directory.byteOffset + nameStart, nameLength)
            ).replace(/\\/g, "/").replace(/^\.\/+/, "");

            if (name && !name.endsWith("/")) {
                const normalizedName = name.toLowerCase();
                entries.set(normalizedName, {
                    name,
                    flags,
                    method,
                    compressedSize,
                    uncompressedSize,
                    localOffset
                });
            }
            offset = recordEnd;
        }

        const projectEntry =
            entries.get("assets/project.json") ||
            [...entries.values()].find(entry => /\/assets\/project\.json$/i.test(entry.name)) ||
            entries.get("project.json") ||
            [...entries.values()].find(entry => /\/project\.json$/i.test(entry.name));

        if (!projectEntry)
            throw new Error("The ZIP must contain project.json (usually inside an assets folder).");

        return new ZipAssetArchive(file, entries, projectEntry);
    }

    findAsset(fileName) {
        const candidates = [
            this.projectDirectory && `${this.projectDirectory}/${fileName}`,
            this.projectDirectory && `${this.projectDirectory}/assets/${fileName}`,
            `assets/${fileName}`,
            fileName
        ].filter(Boolean);

        for (const candidate of candidates) {
            const entry = this.entries.get(candidate.toLowerCase());
            if (entry)
                return entry;
        }

        return null;
    }

    readProject() {
        return this.readEntry(this.projectEntry);
    }

    readEntry(entry) {
        const pending = this.pendingReads.get(entry.name);
        if (pending)
            return pending;

        const read = this._readEntry(entry).finally(() => {
            this.pendingReads.delete(entry.name);
        });
        this.pendingReads.set(entry.name, read);
        return read;
    }

    async _readEntry(entry) {
        const maxEntrySize = 256 * 1024 * 1024;
        if (entry.uncompressedSize > maxEntrySize)
            throw new Error(`ZIP entry is too large to load safely: ${entry.name}`);
        if (entry.flags & 1)
            throw new Error(`Encrypted ZIP entries are not supported: ${entry.name}`);
        if (entry.method !== 0 && entry.method !== 8)
            throw new Error(`Unsupported ZIP compression method for ${entry.name}.`);

        const headerBytes = await this.file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer();
        const header = new DataView(headerBytes);
        if (header.byteLength < 30 || header.getUint32(0, true) !== 0x04034b50)
            throw new Error(`The ZIP entry has an invalid header: ${entry.name}`);

        const nameLength = header.getUint16(26, true);
        const extraLength = header.getUint16(28, true);
        const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
        const dataEnd = dataOffset + entry.compressedSize;
        if (dataEnd > this.file.size)
            throw new Error(`The ZIP entry is truncated: ${entry.name}`);

        const compressed = this.file.slice(dataOffset, dataEnd);
        let data;
        if (entry.method === 0) {
            data = new Uint8Array(await compressed.arrayBuffer());
        } else {
            if (typeof DecompressionStream !== "function")
                throw new Error("This browser does not support decompressing ZIP files.");
            try {
                const stream = compressed.stream().pipeThrough(new DecompressionStream("deflate-raw"));
                data = new Uint8Array(await new Response(stream).arrayBuffer());
            } catch (error) {
                throw new Error(`Could not decompress ${entry.name}: ${error.message}`);
            }
        }

        if (data.byteLength !== entry.uncompressedSize)
            throw new Error(`The ZIP entry has an invalid size: ${entry.name}`);
        return data;
    }
}

if (typeof module !== "undefined" && module.exports)
    module.exports = ZipAssetArchive;