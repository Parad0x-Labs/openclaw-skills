"""
Hermetic tests for magicblock_archive (stdlib unittest, no network, no
solders/solana install needed).

Run from the plugin dir:  python3 -m unittest discover -s tests -v

Proves receipt anchoring refuses cleanly: the module has no default
receipt_anchor program, so archive_session(anchor=True) raises ReceiptAnchorUnavailableError
before the session is fetched or anything is written, and the module names no
anchor target. The session commitment and the instruction encoder still work
locally.
"""

from __future__ import annotations

import hashlib
import os
import re
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import magicblock_archive as mba  # noqa: E402

RETIRED_MAINNET_ANCHOR = "6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN"
UNAVAILABLE = "receipt anchoring is not done by this skill and no default anchor program is configured"
DEVNET_ANCHOR = "HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs"
# SHA-256 of the withdrawn devnet receipt_anchor id (held hashed, never named).
WITHDRAWN_ANCHOR_SHA256 = "b851c1d6562bf9e70e2033a2db83d21fc5b249eab440a751d5638b285a4596c0"


class DeploymentConstants(unittest.TestCase):
    def test_no_anchor_target_and_mainnet_is_retired(self):
        for name in ("RECEIPT_ANCHOR_PROGRAM", "ANCHOR_RPC_DEVNET", "SOLANA_ANCHOR_RPC", "_anchor_receipt"):
            self.assertFalse(hasattr(mba, name), f"{name} must not exist")
        self.assertEqual(mba.RECEIPT_ANCHOR_MAINNET_RETIRED, RETIRED_MAINNET_ANCHOR)
        self.assertEqual(mba.RECEIPT_ANCHOR_MAINNET_RETIRED_ON, "2026-07-14")

    def test_module_source_names_no_withdrawn_id(self):
        src = Path(mba.__file__).read_text(encoding="utf-8")
        for token in re.findall(r"[1-9A-HJ-NP-Za-km-z]{32,44}", src):
            self.assertNotEqual(hashlib.sha256(token.encode()).hexdigest(), WITHDRAWN_ANCHOR_SHA256)

    def test_unavailable_error_wording(self):
        self.assertIn(UNAVAILABLE, mba.RECEIPT_ANCHOR_UNAVAILABLE_ERROR)
        self.assertIn(DEVNET_ANCHOR, mba.RECEIPT_ANCHOR_UNAVAILABLE_ERROR)
        self.assertIn("pass it explicitly", mba.RECEIPT_ANCHOR_UNAVAILABLE_ERROR)
        self.assertTrue(issubclass(mba.ReceiptAnchorUnavailableError, RuntimeError))

    def test_instruction_layout_is_42_bytes(self):
        data = mba._build_anchor_single_data(b"\xaa" * 32, 100)
        self.assertEqual(len(data), 42)
        self.assertEqual(data[0], mba.INSTRUCTION_VERSION_V1)
        self.assertEqual(data[1], mba.FLAG_HAS_BUCKET_ID)
        self.assertEqual(data[2:34], b"\xaa" * 32)
        self.assertEqual(int.from_bytes(data[34:], "little"), 100)

    def test_session_commitment_is_local_and_reproducible(self):
        c = mba.session_commitment("sess1", "ab" * 32)
        self.assertEqual(len(c), 32)
        self.assertEqual(
            c, hashlib.sha256(f"openclaw-vault:session:sess1:sha256:{'ab' * 32}".encode()).digest()
        )


class AnchorRefusal(unittest.TestCase):
    def test_archive_session_refuses_anchor_before_fetching_or_writing(self):
        with tempfile.TemporaryDirectory() as out, \
                mock.patch.object(mba, "fetch_session_log") as fetch:
            with self.assertRaises(mba.ReceiptAnchorUnavailableError) as cm:
                mba.archive_session("sess1", anchor=True, output_dir=out)
            fetch.assert_not_called()
            self.assertEqual(os.listdir(out), [], "nothing may be written")
        self.assertIn(UNAVAILABLE, str(cm.exception))

    def test_archive_session_has_no_rpc_parameter(self):
        with self.assertRaises(TypeError):
            mba.archive_session("sess1", anchor=True, solana_rpc_url="https://api.devnet.solana.com")

    def test_archive_without_anchor_returns_commitment(self):
        fake_zstd = types.ModuleType("zstandard")

        class _C:
            def __init__(self, level):
                pass

            def compress(self, b):
                return b"Z" + b

        fake_zstd.ZstdCompressor = _C
        log = [{"slot": 1, "signature": "s", "action_type": "tx", "accounts": [], "data_hex": ""}]
        with tempfile.TemporaryDirectory() as out, \
                mock.patch.dict(sys.modules, {"zstandard": fake_zstd}), \
                mock.patch.object(mba, "fetch_session_log", return_value=log):
            r = mba.archive_session("sess1", anchor=False, output_dir=out)
            self.assertTrue(Path(r["archive_path"]).exists())
        self.assertEqual(r["action_count"], 1)
        self.assertEqual(r["session_commitment"], mba.session_commitment("sess1", r["archive_hash"]).hex())
        self.assertNotIn("solana_tx", r)


if __name__ == "__main__":
    unittest.main()
