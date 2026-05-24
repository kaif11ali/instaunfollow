// Instagram Unfollow Automation Script

require('dotenv').config();
const { PuppeteerCrawler, log } = require("crawlee");
const fs = require("fs");
const path = require("path");

// Environment variables
const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME;
const INSTAGRAM_PASSWORD = process.env.INSTAGRAM_PASSWORD;
const MAX_UNFOLLOW_COUNT = parseInt(process.env.MAX_UNFOLLOW_COUNT) || 100;
const UNFOLLOW_DELAY = parseInt(process.env.UNFOLLOW_DELAY) || 5000;
const SCROLL_DELAY = parseInt(process.env.SCROLL_DELAY) || 3000;

// Validate environment variables
if (!INSTAGRAM_USERNAME || !INSTAGRAM_PASSWORD) {
  log.error("Missing required environment variables: INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD");
  process.exit(1);
}

// URLs
const LOGIN_URL = "https://www.instagram.com/accounts/login/";
const FOLLOWING_URL = `https://www.instagram.com/${INSTAGRAM_USERNAME}/following/`;
const COOKIE_PATH = path.resolve(__dirname, "..", "cookies.json");

// Helper: Load cookies
const loadCookies = async (page) => {
  try {
    if (fs.existsSync(COOKIE_PATH)) {
      const data = fs.readFileSync(COOKIE_PATH, "utf-8");
      if (data.trim()) {
        const cookies = JSON.parse(data);
        await page.setCookie(...cookies);
        log.info("✅ Cookies loaded successfully!");
        return true;
      }
    }
  } catch (err) {
    log.error("Error loading cookies: " + err.message);
  }
  return false;
};

// Helper: Save cookies
const saveCookies = async (page) => {
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
  log.info("✅ Cookies saved successfully!");
};

(async () => {
  const crawler = new PuppeteerCrawler({
    maxConcurrency: 1,
    launchContext: {
      launchOptions: {
        headless: false,
        args: ["--start-maximized"],
      },
    },

    requestHandler: async ({ page, request }) => {
      log.info(`Processing URL: ${request.url}`);

      // ---------------- LOGIN PHASE ----------------
      if (request.userData.label === "LOGIN") {
        const cookiesLoaded = await loadCookies(page);

        if (!cookiesLoaded) {
          log.info("🔐 Logging in manually...");
          await page.goto(LOGIN_URL, { waitUntil: "networkidle2" });

          // Dismiss cookie/consent dialog that Instagram shows in some regions
          try {
            await page.waitForFunction(
              () => Array.from(document.querySelectorAll('button'))
                         .some(b => /accept|allow|cookie/i.test(b.textContent)),
              { timeout: 5000 }
            );
            await page.evaluate(() => {
              const btn = Array.from(document.querySelectorAll('button'))
                .find(b => /accept|allow/i.test(b.textContent));
              if (btn) btn.click();
            });
            log.info("Dismissed cookie consent dialog.");
            await new Promise(res => setTimeout(res, 1500));
          } catch (_) { /* no consent dialog, continue */ }

          await page.waitForSelector('input[name="username"]', { visible: true, timeout: 60000 });
          await page.type('input[name="username"]', INSTAGRAM_USERNAME, { delay: 100 });

          await page.waitForSelector('input[name="password"]', { visible: true });
          await page.type('input[name="password"]', INSTAGRAM_PASSWORD, { delay: 100 });

          await page.waitForSelector('button[type="submit"]', { visible: true });
          await page.click('button[type="submit"]');

          await page.waitForNavigation({ waitUntil: "networkidle2" });

          // Dismiss "Save your login info?" prompt if it appears
          try {
            await page.waitForSelector('button', { visible: true, timeout: 5000 });
            const dismissed = await page.evaluate(() => {
              const btn = Array.from(document.querySelectorAll('button'))
                .find(b => b.textContent.trim() === 'Not Now' || b.textContent.trim() === 'Not now');
              if (btn) { btn.click(); return true; }
              return false;
            });
            if (dismissed) log.info("Dismissed 'Save login info' prompt.");
          } catch (_) { /* prompt not shown, continue */ }

          // Dismiss "Turn on notifications?" prompt if it appears
          try {
            await page.waitForSelector('button', { visible: true, timeout: 5000 });
            const dismissed = await page.evaluate(() => {
              const btn = Array.from(document.querySelectorAll('button'))
                .find(b => b.textContent.trim() === 'Not Now' || b.textContent.trim() === 'Not now');
              if (btn) { btn.click(); return true; }
              return false;
            });
            if (dismissed) log.info("Dismissed 'Notifications' prompt.");
          } catch (_) { /* prompt not shown, continue */ }

          await saveCookies(page);
        } else {
          log.info("✅ Cookies found. Navigating to Following page...");
          await page.goto(FOLLOWING_URL, { waitUntil: "networkidle2" });
        }
      }

      // ---------------- UNFOLLOW PHASE ----------------
      if (request.userData.label === "UNFOLLOW") {
        log.info("🚀 Starting unfollow process...");

        await page.waitForSelector('a[href*="/following"]', { visible: true });
        await page.click('a[href*="/following"]');

        await page.waitForSelector('div[role="dialog"]', { visible: true });

        let unfollowedCount = 0;
        const unfollowedUsers = new Set();

        while (unfollowedCount < MAX_UNFOLLOW_COUNT) {
          try {
            log.info("🔍 Searching for 'Following' buttons...");

            // Instagram uses class-based or dynamic structure for buttons
            await page.waitForSelector('div[role="dialog"] button', { timeout: 20000 });
            const buttons = await page.$$('div[role="dialog"] button');

            log.info(`Found ${buttons.length} buttons.`);

            if (!buttons.length) {
              log.info("⚠️ No more users found to unfollow.");
              break;
            }

            for (const button of buttons) {
              if (unfollowedCount >= MAX_UNFOLLOW_COUNT) break;

              const isButtonAttached = await page.evaluate(el => el.isConnected, button);
              if (!isButtonAttached) {
                log.warn("Button is detached. Skipping...");
                continue;
              }

              const buttonText = await page.evaluate(el => el.textContent.trim(), button);

              if (buttonText !== "Following") continue;

              // Try to grab the username from a sibling link for accurate tracking
              const username = await page.evaluate(el => {
                const row = el.closest('li') || el.parentElement;
                const link = row && row.querySelector('a[href]');
                return link ? link.getAttribute('href').replace(/\//g, '') : null;
              }, button);

              log.info(`Unfollowing user #${unfollowedCount + 1}${username ? ': @' + username : ''}`);

              try {
                await button.click(); // Click the "Following" button
                log.info("Clicked 'Following' button, waiting for confirm dialog...");

                // Wait for the "Unfollow" confirmation button to appear (class-agnostic)
                await page.waitForFunction(
                  () => Array.from(document.querySelectorAll('button'))
                             .some(b => b.textContent.trim() === 'Unfollow'),
                  { timeout: 5000 }
                );
                await page.evaluate(() => {
                  const btn = Array.from(document.querySelectorAll('button'))
                                   .find(b => b.textContent.trim() === 'Unfollow');
                  if (btn) btn.click();
                });
                log.info("✅ Confirmed unfollow.");
              } catch (err) {
                log.error("Error during unfollow action: " + err.message);
                await page.screenshot({ path: 'error_screenshot.png' });
                log.info("📸 Screenshot saved to error_screenshot.png");
                continue;
              }

              unfollowedCount++;
              unfollowedUsers.add(username || `user_${unfollowedCount}`);
              log.info(`Unfollowed ${unfollowedCount} users.`);

              // Delay before next
              await new Promise(res => setTimeout(res, UNFOLLOW_DELAY));
            }

            log.info("📜 Scrolling to load more users...");
            await page.evaluate(() => {
              const dialog = document.querySelector('div[role="dialog"]');
              if (!dialog) return;
              // Dynamically find the scrollable container inside the dialog
              const scrollable = Array.from(dialog.querySelectorAll('div'))
                .find(el => el.scrollHeight > el.clientHeight + 50);
              (scrollable || dialog).scrollBy(0, 400);
            });

            await new Promise(res => setTimeout(res, SCROLL_DELAY));
          } catch (error) {
            log.error("❌ Error during unfollow loop: " + error.message);
            break;
          }
        }

        log.info(`✅ Finished! Total unfollowed: ${unfollowedCount}`);
      }
    },

    failedRequestHandler: async ({ request, error }) => {
      log.error(`Request ${request.url} failed: ${error.message}`);
    },
  });

  // Add tasks
  await crawler.addRequests([
    { url: LOGIN_URL, userData: { label: "LOGIN" } },
    { url: FOLLOWING_URL, userData: { label: "UNFOLLOW" } },
  ]);

  await crawler.run();
})();
