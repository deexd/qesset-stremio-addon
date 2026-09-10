const express = require('express');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

// REPLACE THIS with your actual Cloudflare Worker URL
const WORKER_URL = 'https://turkish-series.sara-almheiri.workers.dev/';

// In-memory cache
let series = [];
let episodes = [];

/**
 * Fetches HTML from the Cloudflare Worker
 */
async function fetchFromWorker() {
    const response = await fetch(WORKER_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
}

/**
 * Scrape all Turkish series using the Worker as a proxy
 */
async function scrapeAllSeries() {
    try {
        const html = await fetchFromWorker();
        const $ = cheerio.load(html);
        const seriesList = [];

        // 2026 Selectors for qesset.net
        $('.film-list .flw-item').each((i, el) => {
            const title = $(el).find('.film-name a').attr('title') || $(el).find('.film-name a').text().trim();
            const id = $(el).find('a').attr('href').split('/').pop();
            const poster = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');

            if (title && id) {
                seriesList.push({
                    id,
                    name: title,
                    type: 'series',
                    poster: poster ? (poster.startsWith('http') ? poster : `https://qesset.net${poster}`) : null,
                    year: null, // qesset.net often puts year in a complex structure, can be added if needed
                    genres: ['Turkish Series'],
                });
            }
        });

        return seriesList;
    } catch (error) {
        console.error('Scraping error:', error.message);
        return [];
    }
}

// Stremio Manifest
function getManifest() {
    return {
        id: 'com.qesset.turkish.addon',
        version: '1.0.0',
        name: 'Qesset.net Turkish Series',
        description: 'Turkish series from qesset.net (2026) via Worker Proxy',
        logo: 'https://qesset.net/favicon.ico',
        resources: ['catalog', 'meta', 'stream'],
        types: ['series'],
        catalogs: [
            {
                type: 'series',
                id: 'qesset_turkish_series',
                name: 'Qesset.net Turkish Series'
            }
        ]
    };
}

// Express Routes
app.get('/manifest.json', (req, res) => {
    res.json(getManifest());
});

app.get('/catalog/series/qesset_turkish_series.json', async (req, res) => {
    if (series.length === 0) {
        series = await scrapeAllSeries();
    }
    res.json({
        metas: series.map(s => ({
            id: s.id,
            name: s.name,
            type: s.type,
            poster: s.poster,
            year: s.year,
            genres: s.genres
        }))
    });
});

// Start Server
app.listen(PORT, async () => {
    console.log(`Stremio addon running on port ${PORT}`);
    series = await scrapeAllSeries();
    console.log(`Scraped ${series.length} Turkish series`);
});
