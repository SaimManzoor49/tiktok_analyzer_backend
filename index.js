const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const cors = require('cors');
const chromium = require('@sparticuz/chromium');
const app = express();

// Add stealth plugin and use defaults 
puppeteer.use(StealthPlugin());

// Middleware
app.use(cors());
app.use(express.json());

// Browser instance management for Vercel
async function getBrowser() {
    return puppeteer.launch({
        args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
    });
}

// Helper function to parse counts with "M" or "K"
function parseCount(countText) {
    if (!countText) return { value: 0, formatted: '0', raw: '0' };

    const suffix = countText.slice(-1);
    const numericPart = countText.replace(/[^0-9.]/g, '');

    let value = parseFloat(numericPart);

    if (suffix === 'M') {
        value *= 1000000;
    } else if (suffix === 'K') {
        value *= 1000;
    }

    return {
        value: value,
        formatted: countText,
        raw: numericPart
    };
}

// Enhanced scraping function with retries
async function scrapeWithRetry(url, username, retries = 3) {
    let browser = null;
    let page = null;
    try {
        browser = await getBrowser();
        page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9'
        });

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        const is404 = await page.evaluate(() =>
            document.querySelector('h2')?.innerText?.includes("Couldn't find this account")
        );

        if (is404) throw new Error('Account not found');

        await page.waitForSelector('[data-e2e="user-title"]', { timeout: 15000 });

        const content = await page.content();
        const $ = cheerio.load(content);

        const profileData = {
            username: $('[data-e2e="user-title"]').text().trim(),
            nickname: $('[data-e2e="user-subtitle"]').text().trim(),
            bio: $('[data-e2e="user-bio"]').text().trim(),
            avatar: $('[data-e2e="user-avatar"] img').attr('src'),
            isVerified: !!$('[data-e2e="verified-icon"]').length,
            followers: parseCount($('[data-e2e="followers-count"]').text().trim()),
            following: parseCount($('[data-e2e="following-count"]').text().trim()),
            likes: parseCount($('[data-e2e="likes-count"]').text().trim()),
            videoCount: parseCount($('[data-e2e="video-count"]').text().trim())
        };

        return profileData;

    } catch (error) {
        if (retries > 0) {
            console.log(`Retrying (${retries} left) for ${username}`);
            return scrapeWithRetry(url, username, retries - 1);
        }
        throw error;
    } finally {
        if (page) await page.close();
        if (browser) await browser.close();
    }
}

// Video scraping function
async function scrapeVideo(videoUrl, retries = 3) {
    let browser = null;
    let page = null;
    try {
        browser = await getBrowser();
        page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9'
        });

        await page.goto(videoUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await page.waitForSelector('[data-e2e="like-count"]', { timeout: 15000 });

        const content = await page.content();
        const $ = cheerio.load(content);

        const videoData = {
            description: $('[data-e2e="browse-video-desc"]').text().trim(),
            likes: parseCount($('[data-e2e="like-count"]').text().trim()),
            comments: parseCount($('[data-e2e="comment-count"]').text().trim()),
            shares: parseCount($('[data-e2e="share-count"]').text().trim()),
            views: parseCount($('[data-e2e="views-count"]').text().trim()),
            music: {
                title: $('[data-e2e="browse-music"]').text().trim(),
                author: $('[data-e2e="browse-music-author"]').text().trim(),
                url: $('[data-e2e="browse-music"]').attr('href')
            },
            author: {
                username: $('[data-e2e="browser-nickname"]').text().trim(),
                avatar: $('[data-e2e="browser-avatar"] img').attr('src')
            }
        };

        return videoData;

    } catch (error) {
        if (retries > 0) {
            console.log(`Retrying (${retries} left) for video: ${videoUrl}`);
            return scrapeVideo(videoUrl, retries - 1);
        }
        throw error;
    } finally {
        if (page) await page.close();
        if (browser) await browser.close();
    }
}

// Profile endpoint
app.get('/api/profile/:username', async (req, res) => {
    const { username } = req.params;
    const url = `https://www.tiktok.com/@${username}`;

    try {
        const profileData = await scrapeWithRetry(url, username);
        res.json({
            success: true,
            data: profileData
        });
    } catch (error) {
        console.error('Profile Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message.includes('Account not found')
                ? 'Account not found'
                : 'Failed to fetch profile data'
        });
    }
});

// Video endpoint
app.get('/api/video', async (req, res) => {
    const { url } = req.query;

    if (!url || !url.includes('tiktok.com')) {
        return res.status(400).json({ success: false, error: 'Invalid TikTok video URL' });
    }

    try {
        const videoData = await scrapeVideo(url);
        res.json({
            success: true,
            data: videoData
        });
    } catch (error) {
        console.error('Video Error:', error?.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch video data'
        });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.send('TikTok Scraper API');
});

// Server setup
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Cleanup
process.on('SIGINT', async () => {
    console.log('Closing browser...');
    if (browser) await browser.close();
    process.exit();
});

