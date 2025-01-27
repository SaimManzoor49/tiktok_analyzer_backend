// index.js
var express = require("express");
var puppeteer = require("puppeteer-extra");
var StealthPlugin = require("puppeteer-extra-plugin-stealth");
var cheerio = require("cheerio");
var cors = require("cors");
var chromium = require("@sparticuz/chromium");
puppeteer.use(StealthPlugin());
var app = express();
app.use(cors());
app.use(express.json());
async function getBrowser() {
  return puppeteer.launch({
    args: [
      ...chromium.args,
      "--hide-scrollbars",
      "--disable-web-security",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--lang=en-US,en"
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: "new",
    ignoreHTTPSErrors: true
  });
}
function parseCount(countText) {
  if (!countText) return { value: 0, formatted: "0", raw: "0" };
  const suffix = countText.slice(-1);
  const numericPart = countText.replace(/[^0-9.]/g, "");
  let value = parseFloat(numericPart);
  if (suffix === "M") {
    value *= 1e6;
  } else if (suffix === "K") {
    value *= 1e3;
  }
  return {
    value,
    formatted: countText,
    raw: numericPart
  };
}
async function scrapeWithRetry(url, username, retries = 3) {
  let browser2 = null;
  let page = null;
  try {
    browser2 = await getBrowser();
    page = await browser2.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36");
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9"
    });
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 6e4
    });
    const is404 = await page.evaluate(
      () => {
        var _a, _b;
        return (_b = (_a = document.querySelector("h2")) == null ? void 0 : _a.innerText) == null ? void 0 : _b.includes("Couldn't find this account");
      }
    );
    if (is404) throw new Error("Account not found");
    await page.waitForSelector('[data-e2e="user-title"]', { timeout: 15e3 });
    const content = await page.content();
    const $ = cheerio.load(content);
    const profileData = {
      username: $('[data-e2e="user-title"]').text().trim(),
      nickname: $('[data-e2e="user-subtitle"]').text().trim(),
      bio: $('[data-e2e="user-bio"]').text().trim(),
      avatar: $('[data-e2e="user-avatar"] img').attr("src"),
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
    if (browser2) await browser2.close();
  }
}
async function scrapeVideo(videoUrl, retries = 3) {
  let browser2 = null;
  let page = null;
  try {
    browser2 = await getBrowser();
    page = await browser2.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36");
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9"
    });
    await page.goto(videoUrl, {
      waitUntil: "domcontentloaded",
      timeout: 6e4
    });
    await page.waitForSelector('[data-e2e="like-count"]', { timeout: 15e3 });
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
        url: $('[data-e2e="browse-music"]').attr("href")
      },
      author: {
        username: $('[data-e2e="browser-nickname"]').text().trim(),
        avatar: $('[data-e2e="browser-avatar"] img').attr("src")
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
    if (browser2) await browser2.close();
  }
}
app.get("/api/profile/:username", async (req, res) => {
  const { username } = req.params;
  const url = `https://www.tiktok.com/@${username}`;
  try {
    const profileData = await scrapeWithRetry(url, username);
    res.json({
      success: true,
      data: profileData
    });
  } catch (error) {
    console.error("Profile Error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message.includes("Account not found") ? "Account not found" : "Failed to fetch profile data"
    });
  }
});
app.get("/api/video", async (req, res) => {
  const { url } = req.query;
  if (!url || !url.includes("tiktok.com")) {
    return res.status(400).json({ success: false, error: "Invalid TikTok video URL" });
  }
  try {
    const videoData = await scrapeVideo(url);
    res.json({
      success: true,
      data: videoData
    });
  } catch (error) {
    console.error("Video Error:", error == null ? void 0 : error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch video data"
    });
  }
});
app.get("/", (req, res) => {
  res.send("TikTok Scraper API");
});
var PORT = process.env.PORT || 8e3;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
process.on("SIGINT", async () => {
  console.log("Closing browser...");
  if (browser) await browser.close();
  process.exit();
});
