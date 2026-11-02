import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

from welcome_card import render_welcome_card


def image_bytes(color, *, mode="RGB", size=(180, 120)):
    with BytesIO() as stream:
        Image.new(mode, size, color).save(stream, format="PNG")
        return stream.getvalue()


class WelcomeCardTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.template_path = Path(self.directory.name) / "template.png"
        self.template = Image.new("RGB", (1280, 640), "#07140e")
        draw = ImageDraw.Draw(self.template)
        draw.ellipse((553, 169, 727, 343), outline="#00ed91", width=7)
        self.template.save(self.template_path)

    def render(self, name, avatar=None):
        png = render_welcome_card(name, avatar, template_path=self.template_path)
        with Image.open(BytesIO(png)) as image:
            image.load()
            return png, image.convert("RGB")

    def test_avatar_is_circular_and_art_outside_personalized_areas_is_preserved(self):
        _, card = self.render("Nikolay", image_bytes("#fe0020"))

        self.assertEqual(card.size, (1280, 640))
        self.assertEqual(card.getpixel((640, 256)), (254, 0, 32))
        self.assertEqual(card.getpixel((566, 182)), self.template.getpixel((566, 182)))
        self.assertEqual(card.getpixel((557, 256)), (0, 237, 145))
        difference = ImageChops.difference(card, self.template)
        draw = ImageDraw.Draw(difference)
        draw.rectangle((566, 182, 713, 329), fill=0)
        draw.rectangle((350, 505, 929, 560), fill=0)
        self.assertIsNone(difference.getbbox())

    def test_current_name_and_avatar_change_the_card_without_retaining_previous_member(self):
        first, first_image = self.render("Alice", image_bytes("red"))
        second, second_image = self.render("Bob", image_bytes("blue"))
        alice_again, _ = self.render("Alice", image_bytes("red"))

        self.assertNotEqual(first, second)
        self.assertEqual(first, alice_again)
        self.assertNotEqual(
            first_image.crop((350, 505, 930, 561)).tobytes(),
            second_image.crop((350, 505, 930, 561)).tobytes(),
        )
        self.assertEqual(second_image.getpixel((640, 256)), (0, 0, 255))

    def test_long_unicode_name_is_kept_inside_the_greeting_space(self):
        _, card = self.render("Николай " + "Long nickname " * 16, image_bytes("red"))
        difference = ImageChops.difference(card, self.template)
        ImageDraw.Draw(difference).rectangle((566, 182, 713, 329), fill=0)
        bounds = difference.getbbox()

        self.assertIsNotNone(bounds)
        self.assertGreaterEqual(bounds[0], 350)
        self.assertGreaterEqual(bounds[1], 505)
        self.assertLessEqual(bounds[2], 930)
        self.assertLessEqual(bounds[3], 561)

    def test_missing_or_invalid_avatar_uses_same_initials_fallback(self):
        missing, card = self.render("New Member")
        invalid, _ = self.render("New Member", b"not an image")
        other_name, _ = self.render("Another Person")

        self.assertEqual(missing, invalid)
        self.assertNotEqual(missing, other_name)
        self.assertNotEqual(card.getpixel((640, 256)), self.template.getpixel((640, 256)))

    def test_unsupported_fraktur_letters_render_as_readable_white(self):
        styled, _ = self.render("𝖂𝕳𝕴𝕿𝕰", image_bytes("red"))
        plain, _ = self.render("WHITE", image_bytes("red"))

        self.assertEqual(styled, plain)

    def test_transparent_avatar_preserves_the_underlying_template(self):
        _, card = self.render("Transparent", image_bytes((255, 0, 0, 0), mode="RGBA"))

        self.assertEqual(card.getpixel((640, 256)), self.template.getpixel((640, 256)))

    def test_missing_template_is_not_silently_hidden_by_avatar_fallback(self):
        with self.assertRaises(OSError):
            render_welcome_card("Alice", None, template_path=Path(self.directory.name) / "missing.png")


if __name__ == "__main__":
    unittest.main()
