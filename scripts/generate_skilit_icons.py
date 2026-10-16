#!/usr/bin/env python3
"""Skilit-owned, Iconify-compatible SVG symbol set.

All paths are new first-party geometric glyphs. The manifest's SVG
bodies can be validated/imported through packages/assets/src/iconset.ts,
and its matching path data is rendered safely as React SVG paths.
"""
import json
from pathlib import Path

ICONS = {
    "overview": ["M3.5 3.5h7v7h-7z", "M13.5 3.5h7v7h-7z", "M3.5 13.5h7v7h-7z", "M13.5 13.5h7v7h-7z"],
    "gallery": ["M4 5h16v14H4z", "M4 14l4.5-4.5 5 5L16 12l4 4", "M15.5 8h.01"],
    "lens": ["M5 9V5h4", "M15 5h4v4", "M19 15v4h-4", "M9 19H5v-4", "M9 12h6", "M12 9v6"],
    "flows": ["M4 5h6v6H4z", "M14 13h6v6h-6z", "M10 8h3a3 3 0 0 1 3 3v2", "M13.5 10.5 16 13l2.5-2.5"],
    "patterns": ["M12 2.5 21.5 12 12 21.5 2.5 12z", "M12 7.5 16.5 12 12 16.5 7.5 12z"],
    "boards": ["M4 4h16v16H4z", "M10 4v16", "M4 12h6", "M14 8h3", "M14 12h3", "M14 16h2"],
    "arrow-up-right": ["M7 17 17 7", "M8 7h9v9"],
    "arrow-right": ["M4 12h16", "m13 5 7 7-7 7"],
    "compass": ["M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19z", "m15.5 8.5-2 5-5 2 2-5z"],
    "sparkles": ["m12 2 1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6z", "M19 17v4", "M17 19h4"],
    "shield": ["M12 2 20 5v6c0 5-3.5 8-8 11-4.5-3-8-6-8-11V5z", "m8 11 2.5 2.5L16 8"],
    "layers": ["m12 3 9 5-9 5-9-5z", "m3 12 9 5 9-5", "m3 16 9 5 9-5"],
    "terminal": ["M3 5h18v14H3z", "m7 10 3 3-3 3", "M12 16h5"],
    "activity": ["M3 12h4l3-7 4 14 3-7h4"],
    "check-circle": ["M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19z", "m7.5 12 3 3L17 9"],
    "grid-plus": ["M4 4h7v7H4z", "M15 5v6", "M12 8h6", "M4 15h7v7H4z", "M15 15h7v7h-7z"],
    "search": ["M10.8 4a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6z", "m16 16 4 4"],
    "book": ["M4 5.5C7 4 10 4 12 6c2-2 5-2 8-.5V19c-3-1.5-6-1.5-8 .5-2-2-5-2-8-.5z", "M12 6v13.5"],
}
repo = Path(__file__).resolve().parents[1]
target = repo / "apps/web/registry/skilit-ui-icons.json"
document = {
    "prefix": "skilit",
    "width": 24,
    "height": 24,
    "info": {
        "name": "Skilit first-party interface glyphs",
        "author": "Skilit",
        "license": {"title": "Repository license"}
    },
    "icons": {
        name: {
            "body": "".join('<path d="' + path + '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>' for path in paths),
            "paths": paths
        }
        for name, paths in ICONS.items()
    },
}
target.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
print(f"Generated {len(ICONS)} Skilit UI icons for the existing icon-set importer")
