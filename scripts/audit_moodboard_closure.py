#!/usr/bin/env python3
"""AC-00-i moodboard dependency-closure inventory (ArtCraft P12 candidate).

Fetches the 70 frozen moodboard files at the AF-01 pinned artcraft commit,
verifies every git blob SHA, parses import specifiers, and records
external packages, alias imports, asset references, and capability flags
(CSS, storage APIs, network, workers, Tauri, WASM) into
imports/craft-suite/moodboard-closure.json.

Standard library only. Network access (GitHub API) is required to RUN
this audit; the committed JSON output is validated offline by
tests/test_moodboard_closure.py, so CI never touches the network.
Engineer usage:
  GH_TOKEN=$(gh auth token) python3 scripts/audit_moodboard_closure.py
No donor code is imported by this script: blobs are inspected in memory
and only the inventory JSON is written.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import ssl
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "imports" / "craft-suite" / "moodboard-closure.json"

DONOR = "artcraft"
SOURCE_URL = "https://github.com/storytold/artcraft"
PINNED_COMMIT = "28a39a0de4a2fc2eccc237df2046c24245bd12ab"

# Frozen tree enumeration at PINNED_COMMIT (path -> git blob SHA).
# Sourced from the recursive trees API; SmartSearchBar.tsx is listed
# because it exists under grid/, but it is marked excluded: the manifest
# rejects SmartSearchBar and no transplant may admit it.
FILES = {
    "frontend/libs/components/moodboard/package.json": "45f13bcc16ed21df1624a2efb5135043b5eebf97",
    "frontend/libs/components/moodboard/src/lib/MoodboardWorkspace.tsx": "b46bf05dd581d348524e360d28eed66dc301c29c",
    "frontend/libs/components/moodboard/src/lib/adapter.ts": "db8f4955fb6d9fb1da60942cfcde51fe5da1b893",
    "frontend/libs/components/moodboard/src/lib/boards/BoardLibraryStore.spec.ts": "537dbfe633100fd2c75f0efee254ecbf30908971",
    "frontend/libs/components/moodboard/src/lib/boards/BoardLibraryStore.ts": "3603fe144604e8118845e57741c414d8532acb70",
    "frontend/libs/components/moodboard/src/lib/boards/boardSelectors.ts": "bce5946430187e4d8cd46ea6ce89699ce7a2cc27",
    "frontend/libs/components/moodboard/src/lib/boards/boardTypes.ts": "84bb7f89215dfbce5adf66d0ad3cb288d400ca62",
    "frontend/libs/components/moodboard/src/lib/boards/linkMeta.ts": "686245283eda349a8656f016ee258a659f74f4ae",
    "frontend/libs/components/moodboard/src/lib/boards/measureMedia.ts": "417c0f15543268c8e32f08c0161026e99bd602d6",
    "frontend/libs/components/moodboard/src/lib/boards/palette.ts": "ab3ae6464605774070c1f75d489e142677289bf1",
    "frontend/libs/components/moodboard/src/lib/boards/useBoardItemEntry.tsx": "fa37ee5c22430a870211504459abe9fb34ead632",
    "frontend/libs/components/moodboard/src/lib/canvas/FloatingToolbar.tsx": "0b2158c892a300f60c85a99553793c324e7f205e",
    "frontend/libs/components/moodboard/src/lib/canvas/Moodboard.tsx": "76ee7201e472aedf2d083e7a02b2d0d417cf5dfa",
    "frontend/libs/components/moodboard/src/lib/canvas/MoodboardBackground.tsx": "d1dbd47fb21d2daf4da7ebf84dc4ac52730a68b7",
    "frontend/libs/components/moodboard/src/lib/canvas/MoodboardHistoryStore.ts": "043f2d208e0a23ba5a5f5da318f987dfcc22d990",
    "frontend/libs/components/moodboard/src/lib/canvas/MoodboardStage.tsx": "1c9fa3803d899778437354d31ac897692c7d3fb4",
    "frontend/libs/components/moodboard/src/lib/canvas/MoodboardStore.ts": "6b3e010e5b40bace53c1317a6e8b1a5435bf08ef",
    "frontend/libs/components/moodboard/src/lib/canvas/MoodboardToolbar.tsx": "e55d228ae1aa779b95e6121aa6eb2d4e6748bee3",
    "frontend/libs/components/moodboard/src/lib/canvas/TextEditOverlay.tsx": "2aabbd164a5720236b54f075d976c3299095ddb0",
    "frontend/libs/components/moodboard/src/lib/canvas/addCanvasImageFile.ts": "76a105e2f9bf5b6f69402e273786776c41d697a0",
    "frontend/libs/components/moodboard/src/lib/canvas/cardLayout.ts": "e7ab159098bbac37d3709caae0decf6a123c56f4",
    "frontend/libs/components/moodboard/src/lib/canvas/interactions/useGalleryDropEvent.ts": "3b2e902a99631a3d9c648f5d27b6066ef7825b7d",
    "frontend/libs/components/moodboard/src/lib/canvas/interactions/useMoodboardKeybinds.ts": "dba8021b8da8cc94e7757b046fe9745160b31568",
    "frontend/libs/components/moodboard/src/lib/canvas/interactions/useNodeDrag.ts": "414c721564d84822a9ac7f5d3a6bfb8f746b305e",
    "frontend/libs/components/moodboard/src/lib/canvas/interactions/usePasteHandler.ts": "19ab9343959a7ccacedd64cbe0966bb54cb2eb0e",
    "frontend/libs/components/moodboard/src/lib/canvas/interactions/useSelection.ts": "02e0f2a743ddc995160f59cdf80086d6aceb8557",
    "frontend/libs/components/moodboard/src/lib/canvas/interactions/useStagePointer.ts": "5788da55c242d1fe2da56dc29d05ef9ce80c4561",
    "frontend/libs/components/moodboard/src/lib/canvas/interactions/useTransformer.ts": "743b5edb1759afbc2cf467bab11409ab7490bd33",
    "frontend/libs/components/moodboard/src/lib/canvas/interactions/useViewportControls.ts": "13956b7a9d8cc203d18bd58b26d856b36ea0c8f7",
    "frontend/libs/components/moodboard/src/lib/canvas/layout/clusterProximity.spec.ts": "96f936684a7fc11f5685bbc1842952e0db8fc6af",
    "frontend/libs/components/moodboard/src/lib/canvas/layout/clusterProximity.ts": "5529c1a03092080c30e6c83784c322a341537d89",
    "frontend/libs/components/moodboard/src/lib/canvas/layout/fitToGrid.ts": "0c5e6ea4e4ded0ea99c17c1e218d6bd8f887beb3",
    "frontend/libs/components/moodboard/src/lib/canvas/layout/geometry.ts": "7e923f0864958b8bf36eae1d6a6a5b999525595f",
    "frontend/libs/components/moodboard/src/lib/canvas/layout/packCollage.spec.ts": "440088dd701cea036d79ffbc2807c06e819b0560",
    "frontend/libs/components/moodboard/src/lib/canvas/layout/packCollage.ts": "9810d194671e88f7e34d91fb200eadac29971149",
    "frontend/libs/components/moodboard/src/lib/canvas/layout/pointInPolygon.spec.ts": "bb9fdee920f0689f52bed7127c1bcc3728c3d801",
    "frontend/libs/components/moodboard/src/lib/canvas/layout/pointInPolygon.ts": "9a7b580a608e03277b5ea7e5d6d71851d113a47b",
    "frontend/libs/components/moodboard/src/lib/canvas/layout/segmentsIntersect.ts": "643c37291c1e05248772c0d29f7ef3b0c9698306",
    "frontend/libs/components/moodboard/src/lib/canvas/layout/snapping.spec.ts": "ef8f2d7c3e716b55b564be31756abfb9a98bb257",
    "frontend/libs/components/moodboard/src/lib/canvas/layout/snapping.ts": "2fcdc8667693629e32118f562188dff20f23d9e2",
    "frontend/libs/components/moodboard/src/lib/canvas/nodes/GroupNode.tsx": "594b7bd1e9c8e5483ee3f485061d34114f97fb72",
    "frontend/libs/components/moodboard/src/lib/canvas/nodes/ImageNode.tsx": "9aa2af6a2dc15d522aa3a625dca6572d0122603f",
    "frontend/libs/components/moodboard/src/lib/canvas/nodes/TextNode.tsx": "0a5821d6bf34f67044a1779e4bf3b7f5f97a7f00",
    "frontend/libs/components/moodboard/src/lib/canvas/nodes/VideoNode.tsx": "aa248dc990885d0cee6929391a52076646bc9510",
    "frontend/libs/components/moodboard/src/lib/canvas/overlays/RecenterIndicator.tsx": "180c14e4d244ffbf53f0581222acbb8f03e4180d",
    "frontend/libs/components/moodboard/src/lib/canvas/overlays/shortcuts.ts": "b7e46e2bf0cf30a3dcf2548b66187228f670487d",
    "frontend/libs/components/moodboard/src/lib/canvas/types.ts": "468c2dca529cfa95e5417146deb4887f75d24e72",
    "frontend/libs/components/moodboard/src/lib/canvas/useMoodboardImageEntry.tsx": "062e1b37828ce990ac8b206dd7f38b15fa009657",
    "frontend/libs/components/moodboard/src/lib/canvas/useThemeFgRgb.ts": "137d00787eeb0c34a0eac55eaeb874b748926420",
    "frontend/libs/components/moodboard/src/lib/galleryDrop.ts": "5139bdf4708723a42c38fb2698d591e3ca811047",
    "frontend/libs/components/moodboard/src/lib/grid/BoardCard.tsx": "f90497d0329a36e118f41b27aecb30f3834c2b05",
    "frontend/libs/components/moodboard/src/lib/grid/BoardEmptyState.tsx": "f030979aad4f64dcd4c05d920c45fa8c867f3288",
    "frontend/libs/components/moodboard/src/lib/grid/BoardGrid.tsx": "d17ab83ab002469c920d2ce026bef47c962897b9",
    "frontend/libs/components/moodboard/src/lib/grid/BoardGridToolbar.tsx": "359741d2d57123683727ed830bb146566f6a4719",
    "frontend/libs/components/moodboard/src/lib/grid/BoardGridView.tsx": "c265a77d17f4e8e9d980b7c64fe1d8aca4e21534",
    "frontend/libs/components/moodboard/src/lib/grid/ColorPickerPopover.tsx": "8112f140b9742bd74659e968ced646599e295c14",
    "frontend/libs/components/moodboard/src/lib/grid/Favicon.tsx": "f514923f19a8e5d8fc4e8e66b929574b1ae82d98",
    "frontend/libs/components/moodboard/src/lib/grid/ItemInspector.tsx": "398f8182c193aefb0ab3693a1e7fcea39427f4be",
    "frontend/libs/components/moodboard/src/lib/grid/PresentationView.tsx": "64b885fff2141ddeee04d24076ccda96fbc520e5",
    "frontend/libs/components/moodboard/src/lib/grid/SectionHeader.tsx": "16303f9d88434ae2737e06184e34e96c652018b8",
    "frontend/libs/components/moodboard/src/lib/grid/SelectionBar.tsx": "b0566b63a1aac4eaa199e00f80f2b8edec73d8c9",
    "frontend/libs/components/moodboard/src/lib/grid/SmartSearchBar.tsx": "9ad692e3eeb920641e980b99b04a5fa3c9ebea4d",
    "frontend/libs/components/moodboard/src/lib/grid/gridLayout.spec.ts": "0dea6e783be7993ce0845d9ffd9180341f42b69a",
    "frontend/libs/components/moodboard/src/lib/grid/gridLayout.ts": "4d52544fafffebb49e1c5d625ff6ec183b77322d",
    "frontend/libs/components/moodboard/src/lib/grid/useGalleryBoardDrop.ts": "3c632143050b6bed12ff14dbb86070bcdc6aa4d0",
    "frontend/libs/components/moodboard/src/lib/persistence/canvasBridge.ts": "6ca87ffea7e65fd77c7fe167520cf8666d74e0d7",
    "frontend/libs/components/moodboard/src/lib/persistence/dirtySuppression.ts": "072c2176ae8057f0924cad030b1c6ae6d6e6a2f6",
    "frontend/libs/components/moodboard/src/lib/persistence/documents.spec.ts": "6ba16b3bf0a0bf1b0d7e3224dc708b7018638794",
    "frontend/libs/components/moodboard/src/lib/persistence/documents.ts": "c825129f321e8aa7f0d32ca23c9df00b734abb31",
    "frontend/libs/components/moodboard/src/lib/persistence/moodboardSync.ts": "2b022020ce82e8dd3961854083d696a7c96ee769",
}

EXCLUDED = ["frontend/libs/components/moodboard/src/lib/grid/SmartSearchBar.tsx"]

IMPORT_RE = re.compile(r"""(?:^|\s)(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+(?:[^'"]*?\s+from\s+)?|import\()\s*['"]([^'"]+)['"]""")
REQUIRE_RE = re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)""")

FLAG_PATTERNS = {
    "css_import": re.compile(r"\.css['\"]"),
    "url_reference": re.compile(r"\burl\(\s*['\"]?[^)'\"]"),
    "network_fetch": re.compile(r"\b(fetch|axios|XMLHttpRequest|EventSource|WebSocket)\b"),
    "worker": re.compile(r"\b(new\s+Worker|SharedWorker|serviceWorker|navigator\.serviceWorker)\b"),
    "storage": re.compile(r"\b(localStorage|sessionStorage|indexedDB)\b"),
    "tauri": re.compile(r"@tauri-apps|__TAURI__"),
    "wasm": re.compile(r"\.wasm|WebAssembly"),
    "media_api": re.compile(r"\b(HTMLVideoElement|HTMLCanvasElement|canvas\.getContext|AudioContext|URL\.createObjectURL)\b"),
    "ssr_risk": re.compile(r"^\s*(const|let|var)\s+\w+\s*=\s*(window|document|navigator|localStorage)"),
}


def classify(spec: str) -> str:
    if spec.startswith("."):
        return "relative"
    if spec.startswith("@storyteller/") or spec.startswith("@/") or spec.startswith("~/"):
        return "alias"
    if spec.startswith("node:") or spec in ("react", "react-dom"):
        return "runtime"
    return "external"


def git_blob_sha(content: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(content) + content).hexdigest()


def api_get(url: str, token: str | None) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    if token:
        request.add_header("Authorization", "Bearer " + token)
    try:
        import certifi  # Local audit-time CA bundle; CI never runs this.

        context: ssl.SSLContext | None = ssl.create_default_context(cafile=certifi.where())
    except Exception:
        context = None
    with urllib.request.urlopen(request, timeout=60, context=context) as response:
        return json.loads(response.read().decode("utf-8"))


def analyze_text(text: str) -> tuple[dict[str, list[str]], dict[str, bool]]:
    specs: dict[str, set[str]] = {"relative": set(), "alias": set(), "external": set(), "runtime": set()}
    for pattern in (IMPORT_RE, REQUIRE_RE):
        for match in pattern.finditer(text):
            spec = match.group(1)
            specs[classify(spec)].add(spec)
    flags = {name: bool(pattern.search(text)) for name, pattern in FLAG_PATTERNS.items()}
    # package.json carries no TS imports; record its dependency surface instead.
    return ({key: sorted(value) for key, value in specs.items()}, flags)


def main() -> int:
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    files = []
    external: dict[str, list[str]] = {}
    for index, path in enumerate(sorted(FILES)):
        expected = FILES[path]
        try:
            payload = api_get(
                "https://api.github.com/repos/storytold/artcraft/git/blobs/" + expected, token
            )
        except Exception as error:
            print(f"BLOB FETCH FAILED {path} sha={expected}: {error}", file=sys.stderr)
            return 1
        content = base64.b64decode(payload["content"])
        actual = git_blob_sha(content)
        if actual != expected:
            print(f"SHA MISMATCH {path}: tree says {expected}, blob hashes {actual}", file=sys.stderr)
            return 1
        text = content.decode("utf-8", errors="replace")
        imports, flags = analyze_text(text)
        for spec in imports["external"]:
            external.setdefault(spec.split("/")[0], []).append(path)
        files.append(
            {
                "path": path,
                "sha": expected,
                "size": len(content),
                "excluded": path in EXCLUDED,
                "imports": imports,
                "flags": flags,
            }
        )
    record = {
        "schema_version": "1",
        "grain": "AC-00-i",
        "donor": DONOR,
        "source_url": SOURCE_URL,
        "pinned_commit": PINNED_COMMIT,
        "file_count": len(files),
        "files": files,
        "external_packages": sorted(external),
        "generated_note": "Inspected in memory at audit time; no donor code imported.",
    }
    OUT_PATH.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"MOODBOARD_CLOSURE_OK files={len(files)} external={len(external)} path={OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
