// Instagram Unfollow Automation Script

require("dotenv").config();
const { PuppeteerCrawler, log } = require("crawlee");
const fs   = require("fs");
const path = require("path");

// ─── Config ────────────────────────────────────────────────────────────────────
const INSTAGRAM_USERNAME  = process.env.INSTAGRAM_USERNAME;
const INSTAGRAM_PASSWORD  = process.env.INSTAGRAM_PASSWORD;
const MAX_UNFOLLOW_COUNT  = parseInt(process.env.MAX_UNFOLLOW_COUNT) || 100;
const UNFOLLOW_DELAY      = parseInt(process.env.UNFOLLOW_DELAY)     || 5000;
const SCROLL_DELAY        = parseInt(process.env.SCROLL_DELAY)       || 3000;

if (!INSTAGRAM_USERNAME || !INSTAGRAM_PASSWORD) {
  log.error("Missing INSTAGRAM_USERNAME or INSTAGRAM_PASSWORD in .env");
  process.exit(1);
}

// ─── URLs ──────────────────────────────────────────────────────────────────────
const HOME_URL      = "https://www.instagram.com/";
const LOGIN_URL     = "https://www.instagram.com/accounts/login/";
const PROFILE_URL   = `https://www.instagram.com/${INSTAGRAM_USERNAME}/`;
const FOLLOWING_URL = `https://www.instagram.com/${INSTAGRAM_USERNAME}/following/`;
const COOKIE_PATH   = path.resolve(__dirname, "..", "cookies.json");

// ─── Tiny sleep helper ─────────────────────────────────────────────────────────
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ─── Sanitize a browser-exported cookie to Puppeteer-compatible format ───────
// Browser extensions (e.g. EditThisCookie) use sameSite values like
// "no_restriction" and fields like "expirationDate" that Puppeteer rejects.
const sanitizeCookie = (c) => {
  const SAME_SITE_MAP = {
    no_restriction: "None",
    none: "None",
    lax: "Lax",
    strict: "Strict",
    unspecified: "Lax",
  };

  const out = {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || "/",
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
  };

  // Puppeteer uses `expires`; browser exports often use `expirationDate`
  const exp = c.expires ?? c.expirationDate;
  if (exp != null) out.expires = Math.floor(exp);

  // Map sameSite to a value Puppeteer accepts; drop it when null/unrecognised
  if (c.sameSite != null) {
    const mapped =
      SAME_SITE_MAP[String(c.sameSite).toLowerCase()] ??
      (["Strict", "Lax", "None"].includes(c.sameSite) ? c.sameSite : undefined);
    if (mapped) {
      out.sameSite = mapped;
      if (mapped === "None") out.secure = true; // SameSite=None requires Secure
    }
  }

  return out;
};

// ─── Cookie helpers ────────────────────────────────────────────────────────────
const loadCookies = async (page) => {
  try {
    if (!fs.existsSync(COOKIE_PATH)) return false;
    const raw = fs.readFileSync(COOKIE_PATH, "utf-8").trim();
    if (!raw) return false;
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies) || !cookies.length) return false;
    const sanitized = cookies.map(sanitizeCookie);
    await page.setCookie(...sanitized);
    log.info("Cookies loaded into browser.");
    return true;
  } catch (err) {
    log.error("loadCookies error: " + err.message);
    return false;
  }
};

const saveCookies = async (page) => {
  try {
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
    log.info("✅ Cookies saved.");
  } catch (err) {
    log.error("saveCookies error: " + err.message);
  }
};

// ─── Check if the current page is a logged-in Instagram session ────────────────
const checkLoggedIn = async (page) => {
  const url = page.url();
  // Redirected to login / signup = not logged in
  if (/\/(accounts\/login|accounts\/emailsignup)/.test(url)) return false;
  // Login form visible = not logged in
  const loginInput = await page.$('input[name="username"]');
  if (loginInput) return false;
  return true;
};

// ─── Try cookie-based login ────────────────────────────────────────────────────
const tryCookieLogin = async (page) => {
  log.info("🍪 Checking saved cookies...");
  const loaded = await loadCookies(page);
  if (!loaded) {
    log.info("No valid cookies found – will try credential login.");
    return false;
  }
  // Navigate to home and check if session is alive
  await page.goto(HOME_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await delay(2000);
  const ok = await checkLoggedIn(page);
  if (ok) {
    log.info("✅ Cookies are valid – already logged in.");
  } else {
    log.info("❌ Cookies are expired or invalid.");
  }
  return ok;
};

// ─── Login with username + password ───────────────────────────────────────────
const credentialLogin = async (page) => {
  log.info("🔐 Logging in with username and password...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await delay(2000);

  // Dismiss GDPR / cookie-consent banner (varies by region)
  try {
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).some((b) =>
          /^(accept all|accept|allow all|only essential cookies)/i.test(
            b.textContent.trim()
          )
        ),
      { timeout: 5000 }
    );
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((b) =>
        /^(accept all|accept|allow all|only essential cookies)/i.test(
          b.textContent.trim()
        )
      );
      if (b) b.click();
    });
    log.info("Dismissed cookie-consent banner.");
    await delay(1500);
  } catch (_) {
    /* no banner */
  }

  // Fill username
  await page.waitForSelector('input[name="username"]', {
    visible: true,
    timeout: 30000,
  });
  await page.click('input[name="username"]');
  await page.type('input[name="username"]', INSTAGRAM_USERNAME, { delay: 80 });
  await delay(400);

  // Fill password
  await page.waitForSelector('input[name="password"]', {
    visible: true,
    timeout: 10000,
  });
  await page.click('input[name="password"]');
  await page.type('input[name="password"]', INSTAGRAM_PASSWORD, { delay: 80 });
  await delay(400);

  // Click submit (try button[type="submit"] first, then text-match fallback)
  const submitted = await page.evaluate(() => {
    const btn =
      document.querySelector('button[type="submit"]') ||
      Array.from(document.querySelectorAll("button")).find((b) =>
        /log\s*in/i.test(b.textContent.trim())
      );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  if (!submitted) throw new Error("Login submit button not found.");

  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
  await delay(3000);

  // Handle 2FA / security challenge – wait for manual resolution
  if (/\/(challenge|two_factor|checkpoint)/.test(page.url())) {
    log.warning(
      "⚠️  Instagram requires verification. Complete it in the browser window (timeout: 3 min)."
    );
    await page.waitForFunction(
      () =>
        !/\/(challenge|two_factor|checkpoint)/.test(window.location.href),
      { timeout: 180000 }
    );
    await delay(2000);
  }

  if (page.url().includes("/accounts/login")) {
    throw new Error(
      "Credential login failed – check username/password or account may be locked."
    );
  }

  // Dismiss up to two "Not Now" prompts (Save login info / Notifications)
  for (let i = 0; i < 2; i++) {
    try {
      await page.waitForFunction(
        () =>
          Array.from(document.querySelectorAll("button")).some((b) =>
            /not\s*now/i.test(b.textContent)
          ),
        { timeout: 5000 }
      );
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll("button")).find((b) =>
          /not\s*now/i.test(b.textContent)
        );
        if (b) b.click();
      });
      log.info(`Dismissed prompt #${i + 1}.`);
      await delay(1000);
    } catch (_) {
      break;
    }
  }

  await saveCookies(page);
  log.info("✅ Credential login successful. Cookies saved.");
};

// ─── Shared auth state (prevents UNFOLLOW running when AUTH failed) ──────────
let authSucceeded = false;

// ─── Main crawler ──────────────────────────────────────────────────────────────
(async () => {
  const crawler = new PuppeteerCrawler({
    maxConcurrency: 1,
    // Each unfollow takes ~5 s; 100 unfollows = ~500 s. Add headroom for setup.
    // MAX_UNFOLLOW_COUNT * UNFOLLOW_DELAY is the minimum; double it for safety.
    requestHandlerTimeoutSecs: Math.max(300, MAX_UNFOLLOW_COUNT * (UNFOLLOW_DELAY / 1000) * 2),
    launchContext: {
      launchOptions: {
        headless: false,
        defaultViewport: null,
        args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"],
      },
    },

    requestHandler: async ({ page, request }) => {
      log.info(`▶  ${request.userData.label}`);

      // ══════════════════════════════════════════════════════════════════════════
      // AUTH PHASE – cookie check first, credential fallback
      // ══════════════════════════════════════════════════════════════════════════
      if (request.userData.label === "AUTH") {
        const cookieOk = await tryCookieLogin(page);
        if (!cookieOk) {
          await credentialLogin(page);
        }
        // Confirm we landed somewhere reasonable after auth
        await page.goto(PROFILE_URL, { waitUntil: "networkidle2", timeout: 30000 });
        await delay(2000);
        authSucceeded = true;
        log.info("✅ Auth phase complete.");
      }

      // ══════════════════════════════════════════════════════════════════════════
      // UNFOLLOW PHASE
      // ══════════════════════════════════════════════════════════════════════════
      if (request.userData.label === "UNFOLLOW") {
        if (!authSucceeded) {
          log.error("❌ AUTH phase did not succeed – skipping unfollow.");
          return;
        }
        log.info("Opening following list…");

        // Always start from the profile page and use a native Puppeteer click.
        // page.evaluate(() => el.click()) doesn't fire real pointer events and
        // React ignores it – page.click() simulates a full mouse event sequence.
        await page.goto(PROFILE_URL, { waitUntil: "networkidle2", timeout: 30000 });
        await delay(2000);

        // The "following" count on Instagram's profile page is a clickable
        // element whose visible text is "<number> following".
        // Use page.click() (native mouse events) so React's event handlers fire.
        const followingLinkSel = `a[href*="${INSTAGRAM_USERNAME}/following"]`;
        let dialogOpened = false;

        // Attempt 1 – native click on the following link
        try {
          await page.waitForSelector(followingLinkSel, { visible: true, timeout: 8000 });
          await page.click(followingLinkSel);
          log.info("Clicked 'following' link. Waiting for dialog…");
          await page.waitForSelector('div[role="dialog"]', { visible: true, timeout: 20000 });
          dialogOpened = true;
        } catch (e1) {
          log.info(`Direct link click failed (${e1.message}). Trying text-based fallback…`);
        }

        // Attempt 2 – find any link/button whose text contains a number followed by "following"
        if (!dialogOpened) {
          try {
            await page.evaluate(() => {
              const el = Array.from(document.querySelectorAll("a, button, span"))
                .find((n) => /\d+\s*following/i.test(n.textContent.trim()));
              const clickable =
                el?.tagName === "A" || el?.tagName === "BUTTON"
                  ? el
                  : el?.closest("a, button");
              if (clickable) clickable.click();
            });
            await page.waitForSelector('div[role="dialog"]', { visible: true, timeout: 20000 });
            dialogOpened = true;
          } catch (e2) {
            log.info(`Text fallback failed (${e2.message}).`);
          }
        }

        if (!dialogOpened) {
          await page.screenshot({ path: "dialog_fail.png" });
          throw new Error("Following dialog did not open. Screenshot saved to dialog_fail.png");
        }

        log.info("✅ Following dialog is open. Starting unfollow loop…");
        await delay(2000);

        let unfollowedCount = 0;
        const unfollowedUsers = new Set();
        let noProgressStreak = 0; // safety guard against infinite loops

        while (unfollowedCount < MAX_UNFOLLOW_COUNT) {
          try {
            // Make sure the dialog is still present
            const dialogExists = await page.$('div[role="dialog"]');
            if (!dialogExists) {
              log.warning("Dialog closed unexpectedly.");
              break;
            }

            // Find and click the first "Following" button in the dialog
            const found = await page.evaluate(() => {
              const dialog = document.querySelector('div[role="dialog"]');
              if (!dialog) return null;

              // Match button whose full text is exactly "Following"
              const btn = Array.from(dialog.querySelectorAll("button")).find(
                (b) => b.textContent.trim() === "Following"
              );
              if (!btn) return null;

              // Best-effort username extraction from the same list row
              const row =
                btn.closest("li") ||
                btn.closest('[role="listitem"]') ||
                btn.parentElement?.parentElement;
              const link = row?.querySelector("a[href]");
              const username = link
                ? link.getAttribute("href").replace(/\//g, "").trim()
                : null;

              btn.click();
              return { username };
            });

            if (!found) {
              // No "Following" button visible – scroll down to load more
              log.info('No "Following" buttons visible – scrolling…');
              const scrolled = await page.evaluate(() => {
                const dialog = document.querySelector('div[role="dialog"]');
                if (!dialog) return false;
                // Find the first scrollable descendant
                const inner = [...dialog.querySelectorAll("*")].find(
                  (el) =>
                    el.scrollHeight > el.clientHeight + 100 &&
                    getComputedStyle(el).overflowY !== "hidden" &&
                    getComputedStyle(el).overflowY !== "visible"
                );
                const target = inner || dialog;
                const before = target.scrollTop;
                target.scrollTop += 500;
                return target.scrollTop > before;
              });

              if (!scrolled) {
                noProgressStreak++;
                if (noProgressStreak >= 3) {
                  log.info("⚠️  No more users to unfollow.");
                  break;
                }
              } else {
                noProgressStreak = 0;
              }
              await delay(SCROLL_DELAY);
              continue;
            }

            // Wait for the "Unfollow" confirmation button and click it
            try {
              await page.waitForFunction(
                () =>
                  Array.from(
                    document.querySelectorAll("button, [role='button']")
                  ).some((b) => b.textContent.trim() === "Unfollow"),
                { timeout: 8000 }
              );
              await page.evaluate(() => {
                const btn = Array.from(
                  document.querySelectorAll("button, [role='button']")
                ).find((b) => b.textContent.trim() === "Unfollow");
                if (btn) btn.click();
              });

              unfollowedCount++;
              unfollowedUsers.add(found.username || `user_${unfollowedCount}`);
              noProgressStreak = 0;
              log.info(
                `✅ Unfollowed #${unfollowedCount}${
                  found.username ? ": @" + found.username : ""
                }`
              );
              await delay(UNFOLLOW_DELAY);
            } catch (confirmErr) {
              log.warning("Confirm dialog not found: " + confirmErr.message);
              await page.keyboard.press("Escape");
              await delay(1000);
            }
          } catch (loopErr) {
            log.error("Loop error: " + loopErr.message);
            await page.screenshot({ path: `err_${Date.now()}.png` });
            break;
          }
        }

        log.info(`\n🏁 Done. Unfollowed ${unfollowedCount} users.`);
        if (unfollowedUsers.size) {
          log.info("Users: " + [...unfollowedUsers].join(", "));
        }
      }
    },

    failedRequestHandler: async ({ request, error }) => {
      log.error(`Failed: ${request.url} – ${error.message}`);
    },
  });

  await crawler.addRequests([
    { url: HOME_URL,    userData: { label: "AUTH"     } },
    { url: PROFILE_URL, userData: { label: "UNFOLLOW" } },
  ]);

  await crawler.run();
})();

