import discord


def build_linked_profile_layout(
    display_name: str,
    username: str,
    profile_image_url: str | None = None,
    *,
    verified: bool = False,
    verified_type: str | None = None,
    footer_text: str | None = None,
) -> discord.ui.LayoutView:
    view = discord.ui.LayoutView(timeout=None)

    verified_badge = ""
    if verified or str(verified_type or "").lower() in {"blue", "business", "government"}:
        verified_badge = " ☑️"

    profile_text = f"**{display_name}{verified_badge}**\n[@{username}](https://x.com/{username})"

    items: list[discord.ui.Item] = [
        discord.ui.TextDisplay("**✅ X Account Linked**"),
    ]

    if profile_image_url:
        items.append(
            discord.ui.Section(
                discord.ui.TextDisplay(profile_text),
                accessory=discord.ui.Thumbnail(
                    profile_image_url,
                    description=f"Avatar for @{username}",
                ),
            )
        )
    else:
        items.append(discord.ui.TextDisplay(profile_text))

    items.append(
        discord.ui.TextDisplay(
            "Your X identity is connected to Mindo AI. Use `/verify` in the server "
            "and upload your score screenshot to continue."
        )
    )

    if footer_text:
        items.append(discord.ui.TextDisplay(footer_text))

    row = discord.ui.ActionRow()
    row.add_item(
        discord.ui.Button(
            label="Open X Profile",
            style=discord.ButtonStyle.link,
            url=f"https://x.com/{username}",
            emoji="🔵",
        )
    )
    items.append(row)

    container = discord.ui.Container(*items, accent_color=0x1DA1F2)
    view.add_item(container)
    return view
