// Replace the existing <script> block that sets gameUnxUrl / runnerDataUrl
// and the fetch/XHR interceptors with this script.

(function () {
    const PART_URLS = [
        'game.unx.part1',
        'game.unx.part2',
        'game.unx.part3',
    ];
    const RUNNER_DATA_URL = 'runner.data';

    // Fetch and concatenate the 3 parts into a single Blob URL.
    // The promise resolves once, then the cached URL is reused for any
    // subsequent requests (XHR retry, etc.).
    let assembledGameUrl = null;

    async function assembleGameUnx() {
        if (assembledGameUrl) return assembledGameUrl;

        console.log('loaded Fetching game.unx parts...');

        const responses = await Promise.all(PART_URLS.map((url, i) =>
            fetch(url).then(r => {
                if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
                return r.arrayBuffer().then(buf => {
                    console.log(`loaded part ${i + 1}/${PART_URLS.length}`);
                    return buf;
                });
            })
        ));

        // Concatenate all ArrayBuffers into one
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

    // Kick off assembly immediately so it's ready before the engine asks for it
    const gameUnxReady = assembleGameUnx();

    // --- Intercept fetch ---
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

    // --- Intercept XHR ---
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        const urlStr = typeof url === 'string' ? url : String(url);

        if (urlStr.endsWith('game.unx')) {
            // XHR doesn't support async in open(), so we patch send() instead
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
            // Call open with a placeholder so the XHR object is initialised;
            // send() will re-open with the real blob URL.
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