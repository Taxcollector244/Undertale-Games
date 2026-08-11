(function () {
    const RUNNER_DATA_URL = 'runner.data';
    const GAME_UNX_PARTS = 9; // change this number as needed

    let assembledGameUrl = null;

    function getParts(base, count) {
        const parts = [];
        for (let i = 1; i <= count; i++) {
            parts.push(`${base}.part${i}`);
        }
        return parts;
    }

    async function assembleGameUnx() {
        if (assembledGameUrl) return assembledGameUrl;

        const partUrls = getParts('game.unx', GAME_UNX_PARTS);
        console.log(`loaded Fetching ${partUrls.length} game.unx parts...`);

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