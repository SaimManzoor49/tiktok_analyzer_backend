const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const cors = require('cors');
const app = express();

// Add stealth plugin
puppeteer.use(StealthPlugin());

// Middleware
app.use(cors());
app.use(express.json());

// Configuration
const PUPPETEER_OPTIONS = {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
    ]
};

// Browser instance management
let browser = null;

async function getBrowser() {
    if (!browser) {
        browser = await puppeteer.launch(PUPPETEER_OPTIONS);
    }
    return browser;
}

// Helper function to parse counts with "M" or "K"
function parseCount(countText) {
    if (!countText) return { value: 0, formatted: '0', raw: '0' }; // Handle empty or null values

    // Extract the numeric part and the suffix
    const suffix = countText.slice(-1); // Get the last character (M, K, or none)
    const numericPart = countText.replace(/[^0-9.]/g, ''); // Remove non-numeric characters

    let value = parseFloat(numericPart);

    // Convert based on the suffix
    if (suffix === 'M') {
        value *= 1000000; // Convert millions to actual number
    } else if (suffix === 'K') {
        value *= 1000; // Convert thousands to actual number
    }

    return {
        value: value, // Numeric value (e.g., 1500000 for 1.5M)
        formatted: countText, // Original formatted string (e.g., "1.5M")
        raw: numericPart // Raw numeric part without suffix (e.g., "1.5")
    };
}

// Enhanced scraping function with retries
async function scrapeWithRetry(url, username, retries = 3) {
    let page;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        // Set realistic headers
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9'
        });

        // Use proxy if available
        if (process.env.PROXY_SERVER) {
            await page.authenticate({
                username: process.env.PROXY_USER,
                password: process.env.PROXY_PASSWORD
            });
            await page.goto(`http://${process.env.PROXY_SERVER}`, { timeout: 60000 });
        }

        // Navigate to page
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        // Check for 404 page
        const is404 = await page.evaluate(() =>
            document.querySelector('h2')?.innerText?.includes("Couldn't find this account")
        );

        if (is404) throw new Error('Account not found');

        // Wait for critical elements
        await page.waitForSelector('[data-e2e="user-title"]', { timeout: 15000 });

        // Get page content
        const content = await page.content();
        const $ = cheerio.load(content);

        // Parse data
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

        await page.close();
        return profileData;

    } catch (error) {
        await page?.close();
        if (retries > 0) {
            console.log(`Retrying (${retries} left) for ${username}`);
            return scrapeWithRetry(url, username, retries - 1);
        }
        throw error;
    }
}

// Video scraping function
async function scrapeVideo(videoUrl, retries = 3) {
    let page;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        // Set realistic headers
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9'
        });

        // Use proxy if available
        if (process.env.PROXY_SERVER) {
            await page.authenticate({
                username: process.env.PROXY_USER,
                password: process.env.PROXY_PASSWORD
            });
            await page.goto(`http://${process.env.PROXY_SERVER}`, { timeout: 60000 });
        }

        // Navigate to video page
        await page.goto(videoUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        // Wait for critical elements
        await page.waitForSelector('[data-e2e="like-count"]', { timeout: 15000 });

        // Get page content
        const content = await page.content();
        const $ = cheerio.load(content);

        // Parse video data
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

        await page.close();
        return videoData;

    } catch (error) {
        await page?.close();
        if (retries > 0) {
            console.log(`Retrying (${retries} left) for video: ${videoUrl}`);
            return scrapeVideo(videoUrl, retries - 1);
        }
        throw error;
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
                : 'Failed to fetch profile data',
                errorObject: error || {}
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
            error: error?.message||'Failed to fetch video data',
            errorObject: error || {}
        });
    }
});

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


// const puppeteer = require('puppeteer');
// const cheerio = require('cheerio');

// let browserInstance = null;

// async function getBrowser() {
//     if (!browserInstance) {
//         browserInstance = await puppeteer.launch({
//             headless: 'new',
//             args: ['--no-sandbox', '--disable-setuid-sandbox']
//         });
//     }
//     return browserInstance;
// }

// async function scrapeProfile(username) {
//     const browser = await getBrowser();
//     const page = await browser.newPage();

//     try {
//         const profileUrl = `https://www.tiktok.com/@${username}`;
//         await page.goto(profileUrl, {
//             waitUntil: 'domcontentloaded',
//             timeout: 30000
//         });

//         // Wait for critical profile elements
//         await Promise.race([
//             page.waitForSelector('[data-e2e="user-title"]'),
//             new Promise(resolve => setTimeout(resolve, 3000))
//         ]);

//         const content = await page.content();
//         const $ = cheerio.load(content);

//         const profileData = {
//             profile_url: profileUrl,
//             username: username,
//             display_name: $('[data-e2e="user-title"]').text().trim(),
//             bio: $('[data-e2e="user-bio"]').text().trim(),
//             avatar_url: $('[data-e2e="user-avatar"] img').attr('src'),
//             is_verified: $('svg[aria-label="Verified account"]').length > 0,
//             stats: {
//                 followers: $('[data-e2e="followers-count"]').text().trim(),
//                 following: $('[data-e2e="following-count"]').text().trim(),
//                 likes: $('[data-e2e="likes-count"]').text().trim(),
//                 videos: $('[data-e2e="video-count"]').text().trim()
//             },
//             social_links: {
//                 instagram: $('a[href*="instagram.com"]').attr('href'),
//                 youtube: $('a[href*="youtube.com"]').attr('href'),
//                 twitter: $('a[href*="twitter.com"]').attr('href')
//             },
//             metadata: {
//                 user_id: $('script:contains("uniqueId")').html().match(/"uniqueId":"([^"]+)"/)?.[1],
//                 sec_uid: $('script:contains("secUid")').html().match(/"secUid":"([^"]+)"/)?.[1]
//             }
//         };

//         // Clean empty social links
//         profileData.social_links = Object.fromEntries(
//             Object.entries(profileData.social_links).filter(([_, v]) => v)
//         );

//         console.log('Full Profile Data:', profileData);
//         return profileData;
//     } catch (error) {
//         console.error('Profile scraping failed:', error);
//         throw error;
//     } finally {
//         await page.close();
//     }
// }

// // Enhanced video scraper with additional metadata
// async function scrapeVideo(videoUrl) {
//     const browser = await getBrowser();
//     const page = await browser.newPage();

//     try {
//         await page.goto(videoUrl, {
//             waitUntil: 'domcontentloaded',
//             timeout: 30000
//         });

//         // Extract JSON-LD structured data if available
//         const jsonLd = await page.$$eval('script[type="application/ld+json"]', (scripts) => {
//             try {
//                 return JSON.parse(scripts.find(s => s.textContent.includes('VideoObject'))?.textContent);
//             } catch {
//                 return null;
//             }
//         });

//         const content = await page.content();
//         const $ = cheerio.load(content);

//         const videoData = {
//             video_url: videoUrl,
//             description: $('[data-e2e="browse-video-desc"]').text().trim(),
//             created_at: jsonLd?.datePublished,
//             duration: jsonLd?.duration,
//             stats: {
//                 likes: $('[data-e2e="like-count"]').text().trim(),
//                 comments: $('[data-e2e="comment-count"]').text().trim(),
//                 shares: $('[data-e2e="share-count"]').text().trim(),
//                 views: $('[data-e2e="views-count"]').text().trim(),
//                 bookmarks: $('[data-e2e="bookmark-count"]').text().trim()
//             },
//             music: {
//                 title: $('[data-e2e="browse-music"]').text().trim(),
//                 url: $('[data-e2e="browse-music"]').attr('href')
//             },
//             hashtags: $('[data-e2e="browse-hashtag"]').map((i, el) => ({
//                 tag: $(el).text().trim(),
//                 url: $(el).attr('href')
//             })).get(),
//             author: {
//                 username: $('[data-e2e="browse-username"]').text().trim(),
//                 user_id: jsonLd?.author?.identifier
//             }
//         };

//         console.log('Full Video Data:', videoData);
//         return videoData;
//     } catch (error) {
//         console.error('Video scraping failed:', error);
//         throw error;
//     } finally {
//         await page.close();
//     }
// }

// // Cleanup handler
// process.on('SIGINT', async () => {
//     if (browserInstance) {
//         await browserInstance.close();
//     }
//     process.exit();
// });

// // Example usage
// (async () => {
//     try {
//         const profile = await scrapeProfile('tiktok');
//         const video = await scrapeVideo('https://www.tiktok.com/@monyaxa/video/6981186686579494145');
//     } catch (error) {
//         console.error('Scraping failed:', error);
//     } finally {
//         if (browserInstance) {
//             await browserInstance.close();
//         }
//     }
// })();