(function () {
    const RUNNER_DATA_URL = 'runner.data';

    let assembledGameUrl = null;

    async function discoverParts(base) {
        const parts = [];
        let i = 1;
        while (true) {
            const url = `${base}.part${i}`;
            const res = await fetch(url, { method: 'HEAD' });
            if (!res.ok) break;
            parts.push(url);
            i++;
        }
        if (parts.length === 0) throw new Error(`No parts found for ${base}`);
        return parts;
    }

    async function assembleGameUnx() {
        if (assembledGameUrl) return assembledGameUrl;

        console.log('loaded Discovering game.unx parts...');
        const partUrls = await discoverParts('game.unx');
        console.log(`loaded Found ${partUrls.length} parts`);

        const responses = await Promise.all(partUrls.map((url, i) =>
            fetch(url).then(r => {
                if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
                return r.arrayBuffer().then(buf => {
                    console.log(`loaded part ${i + 1}/${partUrls.length}`);
                    return buf;
                });
            })
        ));

        const totalBytes = responses.reduce((sum, buf) => sum + buf.byteLength, 0);
        const merged = new Uint8Array(totalBytes);
        let offset = 0;
        for (const buf of responses) {
            merged.set(new Uint8Array(buf), offset);
            offset += buf.byteLength;
        }

        const blob = new Blob([merged], { type: 'application/octet-stream' });
        assembledGameUrl = URL.createObjectURL(blob);
        console.log('Success Loaded game file');
        return assembledGameUrl;
    }

    const gameUnxReady = assembleGameUnx();

    const originalFetch = window.fetch;
    window.fetch = async function (url, ...args) {
        const urlStr = typeof url === 'string' ? url : (url.url ?? '');
        if (urlStr.endsWith('game.unx')) {
            const blobUrl = await gameUnxReady;
            return originalFetch(blobUrl, ...args);
        }
        if (urlStr.endsWith('runner.data')) {
            return originalFetch(RUNNER_DATA_URL, ...args);
        }
        return originalFetch(url, ...args);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        const urlStr = typeof url === 'string' ? url : String(url);
        if (urlStr.endsWith('game.unx')) {
            const xhr = this;
            const originalSend = xhr.send.bind(xhr);
            xhr.send = async function (...sendArgs) {
                try {
                    const blobUrl = await gameUnxReady;
                    originalOpen.call(xhr, method, blobUrl, ...rest);
                    originalSend(...sendArgs);
                } catch (err) {
                    console.error('game.unx assembly failed:', err);
                }
            };
            return originalOpen.call(this, method, urlStr, ...rest);
        }
        if (urlStr.endsWith('runner.data')) {
            return originalOpen.call(this, method, RUNNER_DATA_URL, ...rest);
        }
        return originalOpen.call(this, method, url, ...rest);
    };

    let runnerScript = document.createElement('script');
    runnerScript.src = 'runner.js';
    document.body.appendChild(runnerScript);

    console.log('Part-based file interception active. Assembling game.unx...');
})();