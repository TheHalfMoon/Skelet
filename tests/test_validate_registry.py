import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts.validate_registry import validate

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_DIR = ROOT / "apps" / "web" / "registry"


def write_registry(tmp: Path, index: dict, items: dict[str, dict]) -> Path:
    directory = tmp / "registry"
    directory.mkdir()
    (directory / "registry.json").write_text(json.dumps(index), encoding="utf-8")
    for name, item in items.items():
        (directory / f"{name}.json").write_text(json.dumps(item), encoding="utf-8")
    return directory


def valid_index() -> dict:
    return {
        "name": "skelet-registry",
        "version": "0.1.0",
        "items": [
            {
                "name": "skelet-button",
                "type": "registry:ui",
                "title": "Skelet Button",
                "description": "A button.",
            }
        ],
    }


def valid_item() -> dict:
    return {
        "name": "skelet-button",
        "type": "registry:ui",
        "title": "Skelet Button",
        "description": "A button.",
        "dependencies": [],
        "devDependencies": [],
        "registryDependencies": [],
        "files": [{"path": "components/x.tsx", "type": "registry:ui", "content": "export const x = 1;"}],
    }


class RegistryValidatorTests(unittest.TestCase):
    def test_repository_registry_is_valid(self) -> None:
        self.assertEqual([], validate(REGISTRY_DIR))

    def test_minimal_fixture_is_valid(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = write_registry(Path(tmp), valid_index(), {"skelet-button": valid_item()})
            self.assertEqual([], validate(directory))

    def test_missing_item_document_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = write_registry(Path(tmp), valid_index(), {})
            errors = validate(directory)
            self.assertTrue(any("missing item document" in error for error in errors), errors)

    def test_empty_file_content_fails(self) -> None:
        item = valid_item()
        item["files"] = [{"path": "components/x.tsx", "type": "registry:ui", "content": ""}]
        with tempfile.TemporaryDirectory() as tmp:
            directory = write_registry(Path(tmp), valid_index(), {"skelet-button": item})
            errors = validate(directory)
            self.assertTrue(any("file entry invalid" in error for error in errors), errors)

    def test_duplicate_index_entry_fails(self) -> None:
        index = valid_index()
        index["items"] = copy.deepcopy(index["items"]) + copy.deepcopy(index["items"])
        with tempfile.TemporaryDirectory() as tmp:
            directory = write_registry(Path(tmp), index, {"skelet-button": valid_item()})
            errors = validate(directory)
            self.assertTrue(any("duplicate index entry" in error for error in errors), errors)

    def test_broken_index_json_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "registry"
            directory.mkdir()
            (directory / "registry.json").write_text("{nope", encoding="utf-8")
            errors = validate(Path(directory))
            self.assertTrue(any("index unreadable" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main()
