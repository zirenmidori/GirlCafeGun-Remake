"""Manual download links must preserve signed immutable pack routes."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import make_download_page as page


class DownloadPageTests(unittest.TestCase):
    def pack(self, url="https://release.example/0.1.0/data-000.zip", identifier="data-000"):
        return {"id": identifier, "url": url, "size": 1048576}

    def test_unchanged_data_reuses_earlier_release_path(self):
        packs = [self.pack()]
        self.assertEqual(page.pack_links("0.1.1", packs), ["../0.1.0/data-000.zip"])
        self.assertIn('href="../0.1.0/data-000.zip"', page.render("0.1.1", "GCG-Offline-v0.1.1.apk", 100, packs, 200))
        self.assertEqual(page.pack_links("0.1.0", packs), ["data-000.zip"])

    def test_changed_and_unchanged_packs_can_be_mixed(self):
        packs = [self.pack(), self.pack("https://release.example/0.1.1/data-001.zip", "data-001")]
        self.assertEqual(page.pack_links("0.1.1", packs), ["../0.1.0/data-000.zip", "data-001.zip"])
        html = page.render("0.1.1", "GCG-Offline-v0.1.1.apk", 100, packs, 200)
        self.assertIn('href="../0.1.0/data-000.zip"', html)
        self.assertIn('href="data-001.zip"', html)

    def test_unsafe_or_mismatched_routes_rejected(self):
        for url in [
            "http://release.example/0.1.0/data-000.zip",
            "https://user:password@release.example/0.1.0/data-000.zip",
            "https://release.example/../data-000.zip",
            "https://release.example/0.1.0/../data-000.zip",
            "https://release.example/0.1.0/data-001.zip",
            "https://release.example/0.1.0/data-000.zip?token=secret",
            "https://release.example/0.1.0/data-000.zip#fragment",
            "https://release.example/0.1.0/%64ata-000.zip",
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                page.pack_links("0.1.1", [self.pack(url)])

    def test_duplicate_and_cross_origin_packs_rejected(self):
        with self.assertRaises(ValueError):
            page.pack_links("0.1.1", [self.pack(), self.pack()])
        with self.assertRaises(ValueError):
            page.pack_links("0.1.1", [self.pack(), self.pack("https://other.example/0.1.0/data-001.zip", "data-001")])


if __name__ == "__main__":
    unittest.main()
