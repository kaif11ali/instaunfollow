# Instagram Auto Unfollow

An automated script to mass-unfollow Instagram accounts using [Puppeteer](https://pptr.dev/) and [Crawlee](https://crawlee.dev/). It supports cookie-based login (no re-authentication on repeat runs), human-like batching with randomised delays to reduce the risk of rate-limiting, and automatic 2FA / security-challenge handling.

## Requirements

- [Node.js](https://nodejs.org/) v18 or later
- Google Chrome installed at the default path (`C:\Program Files\Google\Chrome\Application\chrome.exe`)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create a `.env` file** in the project root and fill in your credentials:
   ```env
   INSTAGRAM_USERNAME=your_instagram_username
   INSTAGRAM_PASSWORD=your_instagram_password

   # Optional – defaults shown below
   MAX_UNFOLLOW_COUNT=100
   UNFOLLOW_DELAY=5000
   UNFOLLOW_BATCH_SIZE=10
   SCROLL_DELAY=3000
   ```

3. **Run the script:**
   ```bash
   npm start
   ```

The browser window will open visibly so you can monitor progress or complete any verification steps Instagram may require.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `INSTAGRAM_USERNAME` | *(required)* | Your Instagram username |
| `INSTAGRAM_PASSWORD` | *(required)* | Your Instagram password |
| `MAX_UNFOLLOW_COUNT` | `100` | Total accounts to unfollow per run |
| `UNFOLLOW_BATCH_SIZE` | `10` | Unfollows per batch before taking a human-like break |
| `UNFOLLOW_DELAY` | `5000` | Milliseconds between individual unfollows |
| `SCROLL_DELAY` | `3000` | Milliseconds to wait after scrolling to load more accounts |

## How It Works

1. **Authentication** — Loads `cookies.json` if it exists and validates the session. Falls back to username/password login if cookies are missing or expired. Cookies are saved after a successful credential login for faster future runs.
2. **2FA / Security challenges** — If Instagram redirects to a challenge page, the script pauses for up to 3 minutes so you can complete verification manually in the open browser window.
3. **Unfollowing** — Opens your following list and unfollows accounts one by one with a configurable delay. Every `UNFOLLOW_BATCH_SIZE` unfollows the script closes the dialog, navigates to your home feed or profile, does a few randomised scrolls, and waits 30–90 seconds before the next batch.
4. **Cookie refresh** — Fresh cookies are written to `cookies.json` after each successful login.

## Security

- Credentials live in `.env`, which should be added to `.gitignore` and never committed.
- `cookies.json` contains active session data — keep it out of version control as well.
- No credentials or cookies are transmitted anywhere other than Instagram.

## Disclaimer

This script is provided for educational purposes only. Automated interaction with Instagram may violate their [Terms of Use](https://help.instagram.com/581066165581870). Use at your own risk and always act responsibly.

---

## Credits

Developed and maintained by **Kaif Ali**.

If you find this project useful, consider giving it a ⭐ on GitHub!