const express = require('express');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

// Worker URL
const WORKER_URL = 'https://turkish-series.sara-almheiri.workers.dev/';

// In-memory cache
let series = {};
let lastFetched = 0;
const CACHE_DURATION = 3600000; // 1 Hour

// Check if cache is still valid
function isCacheValid() {
    return (Date.now() - lastFetched) < CACHE_DURATION;
}

// Fetch from Worker
async function fetchFromWorker(url) {
    // Append URL to Worker URL if it contains a path
    const fullUrl = url.startsWith('http') ? url : WORKER_URL + url;
    const response = await fetch(fullUrl);
    if (!response.ok) throw new Error(`Worker Error: HTTP ${response.status}`);
    return await response.text();
}

// Scrape
async function scrape(url, catalogId) {
    const html = await fetchFromWorker(url);
    const $ = cheerio.load(html);
    const seriesList = [];

    // Using discover list selectors
    $('.film-list .flw-item').each((i, el) => {
        const title = $(el).find('.film-name a').attr('title') || $(el).find('.film-name a').text().trim();
        const id = $(el).find('a').attr('href')?.split('/').pop();
        const poster = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');

        if (title && id) {
            seriesList.push({
                id,
                name: title,
                type: 'series',
                poster: poster?.startsWith('http') ? poster : `https://qesset.net${poster}`,
                genres: ['Turkish Series'],
            });
        }
    });

    return seriesList;
}

// Stremio Manifest
function getManifest() {
    return {
        id: 'com.qesset.turkish.discover',
        version: '1.0.0',
        name: 'Qesset.net Discover',
        description: 'Turkish Series (Discover, Latest, Finished, Movies)',
        logo: 'https://qesset.net/favicon.ico',
        resources: ['catalog'],
        types: ['series'],
        catalogs: [
            {
                type: 'series',
                id: 'qesset_turkish_series',
                name: 'Qesset.net All Series'
            },
            {
                type: 'series',
                id: 'qesset_latest',
                name: 'Qesset.net Latest Episodes'
            },
            {
                type: 'series',
                id: 'qesset_finished',
                name: 'Qesset.net Finished Series'
            },
            {
                type: 'series',
                id: 'qesset_movies',
                name: 'Qesset.net New Movies'
            }
        ]
    };
}

// Routes
app.get('/manifest.json', (req, res) => res.json(getManifest()));

app.get('/catalog/series/:catalogId.json', async (req, res) => {
    const catalogId = req.params.catalogId;
    const urls = {
        'qesset_turkish_series': 'https://qesset.net/discover/',
        'qesset_latest': 'https://qesset.net/son-bolumler/',
        'qesset_finished': 'https://qesset.net/category/alarshif/',
        'qesset_movies': 'https://qesset.net/category/yeni-filmler/'
    };

    const url = urls[catalogId];

    // Check cache
    if (series[catalogId] && isCacheValid()) {
        return res.json({ metas: series[catalogId] });
    }

    try {
        const data = await scrape(url, catalogId);
        series[catalogId] = data;
        lastFetched = Date.now();
        res.json({ metas: data });
    } catch (error) {
        res.status(500).json({ metas: [], error: error.message });
    }
});

// Start server
app.listen(PORT, async () => {
    console.log(`Addon running on port ${PORT}`);
    // Initial fetch
    series['qesset_turkish_series'] = await scrape('https://qesset.net/discover/', 'qesset_turkish_series');
    lastFetched = Date.now();
    console.log(`Initial fetch complete.`);
});
