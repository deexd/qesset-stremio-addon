const cheerio = require('cheerio');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

// Cloudflare Worker URL (replace with yours)
const WORKER_URL = 'https://turkish-series.sara-almheiri.workers.dev/';

async function fetchFromWorker(url) {
    const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    if (!response.ok) throw new Error(`Worker Error: ${response.status}`);
    return await response.text();
}

// Scrape all series from /discover/ (handles pagination)
async function scrapeSeries(url, allSeries = []) {
    const html = await fetchFromWorker(url);
    const $ = cheerio.load(html);

    $('article.postEp').each((i, el) => {
        const title = $(el).find('.title').text().trim();
        const href = $(el).find('a').attr('href');
        const id = href?.split('/').pop().replace(/-/g, '_');

        // Extract poster from inline style
        const style = $(el).find('.imgSer').attr('style');
        const posterMatch = style?.match(/url\(['"]?(.*?)['"]?\)/);
        const poster = posterMatch ? posterMatch[1] : null;

        if (title && id) {
            allSeries.push({
                id: `qesset_${id}`,
                name: title,
                type: 'series',
                poster: poster?.startsWith('http') ? poster : `https://qesset.net${poster}`,
                genres: ['Turkish Series'],
            });
        }
    });

    // Check for next page (e.g., /discover/page/2/)
    const nextPageLink = $('a[href*="/discover/page/"]').last().attr('href');
    if (nextPageLink) {
        const nextPageUrl = new URL(nextPageLink, 'https://qesset.net').toString();
        await scrapeSeries(nextPageUrl, allSeries); // Recursively fetch next page
    }

    return allSeries;
}

// Scrape episodes for a single series
async function scrapeEpisodes(seriesId) {
    const seriesSlug = seriesId.replace('qesset_', '').replace(/_/g, '-');
    const seriesUrl = `https://qesset.net/yeni-show/${seriesSlug}/`;
    const html = await fetchFromWorker(seriesUrl);
    const $ = cheerio.load(html);
    const episodes = [];

    // Find episode links (e.g., /clarus/uzak-sehir-episode-1/)
    $('a[href*="/clarus/"]').each((i, el) => {
        const href = $(el).attr('href');
        const episodeMatch = href?.match(/\/clarus\/.*-episode-(\d+)\/$/);
        if (!episodeMatch) return;

        const episodeNumber = parseInt(episodeMatch[1]);
        const episodeId = `${seriesId}_episode_${episodeNumber}`;

        episodes.push({
            id: episodeId,
            title: `Episode ${episodeNumber}`,
            season: 1,
            episode: episodeNumber,
            released: new Date().toISOString(),
        });
    });

    return episodes;
}

// Stremio Addon Manifest
const manifest = {
    id: 'com.qesset.stremio.addon',
    version: '1.0.0',
    name: 'Qesset Turkish Series',
    description: 'Watch Turkish series from qesset.net on Stremio',
    catalogs: [
        {
            type: 'series',
            id: 'qesset_turkish_series',
            name: 'Qesset Turkish Series',
        },
    ],
    resources: ['stream', 'meta', 'catalog'],
    types: ['series'],
    idPrefixes: ['qesset_'],
};

// Stremio Addon Handler
const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === 'series' && id === 'qesset_turkish_series') {
        const series = await scrapeSeries('https://qesset.net/discover/');
        return { metas: series };
    }
    return { metas: [] };
});

builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== 'series') return { meta: null };

    const series = (await scrapeSeries('https://qesset.net/discover/')).find(s => s.id === id);
    if (!series) return { meta: null };

    return { meta: series };
});

builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== 'series') return { streams: [] };

    const episodeMatch = id.match(/qesset_(.+)_episode_(\d+)/);
    if (!episodeMatch) return { streams: [] };

    const seriesSlug = episodeMatch[1].replace(/_/g, '-');
    const episodeNumber = episodeMatch[2];
    const episodeUrl = `https://qesset.net/clarus/${seriesSlug}-episode-${episodeNumber}/`;

    // Fetch the episode page to extract video sources
    const html = await fetchFromWorker(episodeUrl);
    const $ = cheerio.load(html);
    const streams = [];

    // Extract video sources (adjust selector based on actual HTML)
    $('video source').each((i, el) => {
        const src = $(el).attr('src');
        if (src) {
            streams.push({
                url: src,
                title: `Source ${i + 1}`,
                behaviorHints: {
                    proxyHeaders: {
                        request: {
                            'Referer': 'https://qesset.net/',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        }
                    }
                },
            });
        }
    });

    // Fallback: If no <video> tags, check for iframe/embed
    if (streams.length === 0) {
        $('iframe').each((i, el) => {
            const src = $(el).attr('src');
            if (src && src.includes('youtube.com') || src.includes('vimeo.com') || src.includes('dailymotion.com')) {
                streams.push({
                    url: src,
                    title: `Embed ${i + 1}`,
                    behaviorHints: { proxyHeaders: { request: { 'Referer': 'https://qesset.net/' } } },
                });
            }
        });
    }

    return { streams };
});

// Start the addon
serveHTTP(builder.getInterface(), { port: process.env.PORT || 3000 });
