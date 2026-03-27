import aiohttp


def candidate_profile_image_urls(profile_image_url: str | None) -> list[str]:
    normalized = (profile_image_url or "").strip()
    if not normalized:
        return []

    high_res = normalized.replace("_normal", "_400x400")
    if high_res == normalized:
        return [normalized]

    return [high_res, normalized]


async def download_profile_image(profile_image_url: str | None) -> tuple[bytes | None, str | None]:
    candidate_urls = candidate_profile_image_urls(profile_image_url)
    if not candidate_urls:
        return None, None

    timeout = aiohttp.ClientTimeout(total=15)
    headers = {"User-Agent": "discord-bot-profile-card/1.0"}
    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        for source_url in candidate_urls:
            try:
                async with session.get(source_url) as response:
                    if response.status >= 400:
                        continue
                    return await response.read(), response.headers.get("Content-Type")
            except aiohttp.ClientError:
                continue

    return None, None
