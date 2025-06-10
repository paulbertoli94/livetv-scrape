#!/usr/bin/env python3
import sys
import asyncio
import logging
from playwright.async_api import async_playwright

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def find_audio_via_tag(ctx):
    for tag in ("audio", "video"):
        try:
            src = await ctx.eval_on_selector(
                tag,
                "el => el.src || (el.querySelector('source')?.src || null)"
            )
            if src:
                logger.info(f"{tag.capitalize()} tag src: {src}")
                return src
        except Exception:
            pass
    return None

async def find_audio_via_flashvars(ctx):
    try:
        flashvars = await ctx.eval_on_selector(
            "embed",
            "el => el.getAttribute('flashvars')"
        )
        if flashvars:
            params = dict(p.split("=",1) for p in flashvars.split("&") if "=" in p)
            for key in ("file", "audioFile", "url"):
                if key in params:
                    logger.info(f"Found via flashvars {key}: {params[key]}")
                    return params[key]
    except Exception:
        pass
    return None

async def find_audio_via_iframes(ctx):
    frames = ctx.frames if hasattr(ctx, "frames") else ctx.child_frames
    for frame in frames:
        url = frame.url
        if not url or url in ("about:blank", getattr(ctx, "url", None)):
            continue
        logger.info(f"▶️  Scanning iframe: {url}")
        try:
            await frame.goto(url, wait_until="networkidle", timeout=30000)
        except Exception:
            pass

        # try tag & flashvars
        for fn in (find_audio_via_tag, find_audio_via_flashvars):
            src = await fn(frame)
            if src:
                return src

        # recurse into nested
        nested = await find_audio_via_iframes(frame)
        if nested:
            return nested

    return None

async def extract_audio_url(page_url: str) -> str | None:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context()

        # block images/fonts
        async def _route(route):
            req = route.request
            if req.resource_type in ("image", "font") or req.url.split("?")[0].endswith(
               (".png", ".jpg", ".jpeg", ".gif", ".svg")):
                await route.abort()
            else:
                await route.continue_()
        await ctx.route("**/*", _route)

        page = await ctx.new_page()
        captured = []

        page.on("request", lambda r: captured.append(r.url)
                if r.resource_type == "media" else None)
        ctx.on("response", lambda r: captured.append(r.url)
                if any(ext in r.url for ext in (".m3u8", ".mp3", ".aac")) else None)

        logger.info(f"🌐 Navigating to {page_url}")
        await page.goto(page_url, wait_until="networkidle", timeout=60000)

        # 1️⃣ audio/video tag
        for fn in (find_audio_via_tag, find_audio_via_flashvars):
            src = await fn(page)
            if src:
                await browser.close()
                return src

        # 2️⃣ iframes
        src = await find_audio_via_iframes(page)
        if src:
            await browser.close()
            return src

        # 3️⃣ fallback to first captured media URL
        await browser.close()
        return captured[0] if captured else None

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else input("URL: ")
    audio_url = asyncio.run(extract_audio_url(url))
    if audio_url:
        print(audio_url)
    else:
        print("❌ URL audio non trovato.")
