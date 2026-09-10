const express = require('express');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

// Worker URL
const WORKER_URL = 'https://turkish-series.sara-almheiri.workers.dev/';

// ==========================================
// CACHING CONFIGURATION
// ==========================================
const CACHE_DURATION = 3600000; // 1 Hour in milliseconds
let series = []; // In-memory storage
let lastFetched = 0; // Timestamp of last fetch

// Check if cache is still valid
function isCacheValid() {
    return (Date.now() - lastFetched) < CACHE_DURATION;
}

// Fetch from Worker
async function fetchFromWorker() {
    const response = await fetch(WORKER_URL);
    if (!response.ok) throw new Error(`Worker Error: HTTP ${response.status}`);
    return await response.text();
}

// Scrape
async function scrapeAllSeries() {
    const html = await fetchFromWorker();
    const $ = cheerio.load(html);
    const seriesList = [];

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
        id: 'com.qesset.turkish.cached',
        version: '1.0.0',
        name: 'Qesset.net Cached',
        description: 'Turkish Series with Rate Limit Protection',
        logo: 'https://qesset.net/favicon.ico',
        resources: ['catalog'],
        types: ['series'],
        catalogs: [{
            type: 'series',
            id: 'qesset_turkish_series',
            name: 'Qesset.net Turkish Series'
        }]
    };
}

// Routes
app.get('/manifest.json', (req, res) => res.json(getManifest()));

app.get('/catalog/series/qesset_turkish_series.json', async (req, res) => {
    // 1. Check if we have valid cached data
    if (series.length > 0 && isCacheValid()) {
        console.log(`Serving cached data (Fetched ${new Date(lastFetched).toLocaleTimeString()})`);
        return res.json({ metas: series });
    }

    // 2. If cache is invalid, fetch fresh data
    console.log('Cache expired or empty. Fetching fresh data...');
    try {
        series = await scrapeAllSeries();
        lastFetched = Date.now();
        console.log(`Fetched ${series.length} series. Cache expires in 1 hour.`);
        res.json({ metas: series });
    } catch (error) {
        console.error('Cache miss and fetch failed:', error.message);
        res.status(500).json({ metas: [], error: error.message });
    }
});

// Start server
app.listen(PORT, async () => {
    console.log(`Addon running on port ${PORT}`);
    // Initial fetch on startup
    series = await scrapeAllSeries();
    lastFetched = Date.now();
    console.log(`Initial scrape complete. ${series.length} series cached.`);
});
