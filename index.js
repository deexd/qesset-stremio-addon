// index.js
const express = require('express');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

// In-memory cache
let series = [];
let episodes = [];

// Scrape all series from qesset.net
async function scrapeAllSeries() {
    try {
        const response = await fetch('https://qesset.net/series/');
        const html = await response.text();
        const $ = cheerio.load(html);
        const seriesList = [];

        $('.series-item').each((i, el) => {
            const title = $(el).find('h3').text().trim();
            const id = $(el).find('a').attr('href').split('/').pop();
            const poster = $(el).find('img').attr('src');
            const year = $(el).find('.year').text().trim();

            seriesList.push({
                id,
                name: title,
                type: 'series',
                poster,
                year: year || null,
                genres: ['Anime'],
            });
        });

        return seriesList;
    } catch (error) {
        console.error('Scraping error:', error);
        return [];
    }
}

// Scrape episodes for a single series
async function scrapeEpisodes(seriesId) {
    try {
        const response = await fetch(`https://qesset.net/series/${seriesId}/`);
        const html = await response.text();
        const $ = cheerio.load(html);
        const episodeList = [];

        $('.episode-item').each((i, el) => {
            const title = $(el).find('h4').text().trim();
            const episodeId = $(el).find('a').attr('href').split('/').pop();
            const season = parseInt($(el).find('.season').text().replace('S', '')) || 1;
            const episode = parseInt($(el).find('.episode').text().replace('E', '')) || 1;
            const streamUrl = $(el).find('a.watch-btn').attr('href');

            episodeList.push({
                id: episodeId,
                seriesId,
                title,
                season,
                episode,
                streams: [{ url: streamUrl, title: 'qesset.net' }],
            });
        });

        return episodeList;
    } catch (error) {
        console.error(`Error scraping episodes for ${seriesId}:`, error);
        return [];
    }
}

// Stremio manifest
function getManifest() {
    return {
        id: 'com.qesset.stremio.addon',
        version: '1.0.0',
        name: 'Qesset.net',
        description: 'Anime streams from qesset.net',
        logo: 'https://qesset.net/favicon.ico',
        resources: ['catalog', 'meta', 'stream'],
        types: ['series'],
        catalogs: [
            {
                type: 'series',
                id: 'qesset_series',
                name: 'Qesset.net Series'
            }
        ]
    };
}

// Express routes
app.get('/manifest.json', (req, res) => {
    res.json(getManifest());
});

app.get('/catalog/series/qesset_series.json', async (req, res) => {
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

app.get('/meta/series/:id.json', async (req, res) => {
    const seriesId = req.params.id;
    const seriesMeta = series.find(s => s.id === seriesId);
    if (!seriesMeta) {
        return res.status(404).json({ error: 'Series not found' });
    }
    res.json({
        meta: {
            id: seriesMeta.id,
            name: seriesMeta.name,
            type: seriesMeta.type,
            poster: seriesMeta.poster,
            year: seriesMeta.year,
            genres: seriesMeta.genres
        }
    });
});

app.get('/stream/series/:id.json', async (req, res) => {
    const seriesId = req.params.id;
    if (episodes.length === 0) {
        for (const s of series) {
            const eps = await scrapeEpisodes(s.id);
            episodes.push(...eps);
        }
    }
    const episodeStreams = episodes
        .filter(e => e.seriesId === seriesId)
        .map(e => ({
            id: e.id,
            title: e.title,
            season: e.season,
            episode: e.episode,
            streams: e.streams
        }));
    res.json({ streams: episodeStreams });
});

// Start the server
app.listen(PORT, async () => {
    console.log(`Stremio addon running on port ${PORT}`);
    series = await scrapeAllSeries();
    for (const s of series) {
        const eps = await scrapeEpisodes(s.id);
        episodes.push(...eps);
    }
});