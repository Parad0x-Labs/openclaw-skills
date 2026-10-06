"""
Hermetic tests for magicblock_archive's receipt_anchor guard (stdlib unittest,
no network, no solders/solana install needed).

Run from the plugin dir:  python3 -m unittest discover -s tests -v

Proves anchoring targets the devnet receipt_anchor only: the retired mainnet
program (2026-07-14) is refused by URL before anything else happens, and by
genesis hash before the fee-payer key is loaded or a transaction is built.
"""

from __future__ import annotations

import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import magicblock_archive as mba  # noqa: E402

DEVNET_ANCHOR = "CPQ8Y1bdRiadxLMhrQG14Atc3E5eNJhqwPX1nXtH1Mst"
RETIRED_MAINNET_ANCHOR = "6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN"
MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"


def _fake_solana_modules(genesis_hash: str, calls: list):
    """Minimal stand-ins for solders / solana-py so _anchor_receipt can import."""

    class _Resp:
        def __init__(self, value):
            self.value = value

    class FakeClient:
        def __init__(self, url):
            calls.append(("Client", url))

        def get_genesis_hash(self):
            calls.append(("get_genesis_hash",))
            return _Resp(genesis_hash)

        def get_latest_blockhash(self):  # must never be reached on mainnet
            calls.append(("get_latest_blockhash",))
            raise AssertionError("get_latest_blockhash must not be called")

        def send_transaction(self, *a, **k):  # must never be reached on mainnet
            calls.append(("send_transaction",))
            raise AssertionError("send_transaction must not be called")

    mods = {}
    for name in [
        "solders", "solders.keypair", "solders.pubkey", "solders.transaction",
        "solders.instruction", "solders.message", "solana", "solana.rpc",
        "solana.rpc.api", "solana.rpc.types",
    ]:
        mods[name] = types.ModuleType(name)
    mods["solders.keypair"].Keypair = object
    mods["solders.pubkey"].Pubkey = object
    mods["solders.transaction"].Transaction = object
    mods["solders.instruction"].Instruction = object
    mods["solders.instruction"].AccountMeta = object
    mods["solders.message"].Message = object
    mods["solana.rpc.api"].Client = FakeClient
    mods["solana.rpc.types"].TxOpts = object
    return mods


class DeploymentConstants(unittest.TestCase):
    def test_write_target_is_devnet_and_mainnet_is_retired(self):
        self.assertEqual(mba.RECEIPT_ANCHOR_PROGRAM, DEVNET_ANCHOR)
        self.assertEqual(mba.RECEIPT_ANCHOR_MAINNET_RETIRED, RETIRED_MAINNET_ANCHOR)
        self.assertEqual(mba.RECEIPT_ANCHOR_MAINNET_RETIRED_ON, "2026-07-14")
        self.assertIn("devnet", mba.ANCHOR_RPC_DEVNET)

    def test_instruction_layout_is_42_bytes(self):
        data = mba._build_anchor_single_data(b"\xaa" * 32, 100)
        self.assertEqual(len(data), 42)
        self.assertEqual(data[0], mba.INSTRUCTION_VERSION_V1)
        self.assertEqual(data[1], mba.FLAG_HAS_BUCKET_ID)
        self.assertEqual(data[2:34], b"\xaa" * 32)
        self.assertEqual(int.from_bytes(data[34:], "little"), 100)


class ClusterGuard(unittest.TestCase):
    def test_classify_rpc_url(self):
        for url in [
            "https://solana-rpc.publicnode.com",
            "https://solana.publicnode.com",
            "https://solana.api.onfinality.io/public",
            "https://api.mainnet-beta.solana.com",
            "https://mainnet.helius-rpc.com/?api-key=x",
        ]:
            self.assertEqual(mba.classify_rpc_url(url), "mainnet", url)
        self.assertEqual(mba.classify_rpc_url("https://api.devnet.solana.com"), "devnet")
        self.assertEqual(mba.classify_rpc_url("https://api.testnet.solana.com"), "testnet")
        self.assertEqual(mba.classify_rpc_url("http://127.0.0.1:8899"), "unknown")

    def test_mainnet_url_refused_with_retired_error(self):
        with self.assertRaises(mba.RetiredProgramError) as cm:
            mba.assert_devnet_anchor_rpc("https://solana-rpc.publicnode.com")
        self.assertIn("retired 2026-07-14", str(cm.exception))
        self.assertIn(DEVNET_ANCHOR, str(cm.exception))
        mba.assert_devnet_anchor_rpc("https://api.devnet.solana.com")  # no raise

    def test_genesis_guard(self):
        mba.assert_devnet_genesis(DEVNET_GENESIS)  # no raise
        with self.assertRaises(mba.RetiredProgramError):
            mba.assert_devnet_genesis(MAINNET_GENESIS)
        with self.assertRaises(RuntimeError) as cm:
            mba.assert_devnet_genesis("localValidatorGenesis")
        self.assertIn("not devnet", str(cm.exception))


class AnchorReceiptRefusal(unittest.TestCase):
    def test_mainnet_url_refused_before_any_import_or_network(self):
        calls: list = []
        with mock.patch.dict(sys.modules, _fake_solana_modules(MAINNET_GENESIS, calls)):
            with self.assertRaises(mba.RetiredProgramError):
                mba._anchor_receipt(b"\x01" * 32, solana_rpc="https://solana-rpc.publicnode.com")
        self.assertEqual(calls, [], "no client may be created for a mainnet URL")

    def test_mainnet_genesis_refused_before_key_load_or_send(self):
        calls: list = []
        env = {k: v for k, v in os.environ.items() if k != "SOLANA_FEE_PAYER_KEY_HEX"}
        with mock.patch.dict(sys.modules, _fake_solana_modules(MAINNET_GENESIS, calls)), \
                mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaises(mba.RetiredProgramError) as cm:
                mba._anchor_receipt(b"\x01" * 32, solana_rpc="http://127.0.0.1:8899")
        self.assertIn("retired 2026-07-14", str(cm.exception))
        self.assertEqual(calls, [("Client", "http://127.0.0.1:8899"), ("get_genesis_hash",)])

    def test_devnet_genesis_passes_the_cluster_check(self):
        calls: list = []
        env = {k: v for k, v in os.environ.items() if k != "SOLANA_FEE_PAYER_KEY_HEX"}
        with mock.patch.dict(sys.modules, _fake_solana_modules(DEVNET_GENESIS, calls)), \
                mock.patch.dict(os.environ, env, clear=True):
            # Past the cluster check, the next gate is the fee-payer key.
            with self.assertRaises(EnvironmentError) as cm:
                mba._anchor_receipt(b"\x01" * 32, solana_rpc="http://127.0.0.1:8899")
        self.assertIn("SOLANA_FEE_PAYER_KEY_HEX", str(cm.exception))
        self.assertNotIn(("send_transaction",), calls)

    def test_archive_session_refuses_mainnet_anchor_before_fetching(self):
        with tempfile.TemporaryDirectory() as out, \
                mock.patch.object(mba, "fetch_session_log") as fetch:
            with self.assertRaises(mba.RetiredProgramError):
                mba.archive_session(
                    "sess1",
                    anchor=True,
                    output_dir=out,
                    solana_rpc_url="https://api.mainnet-beta.solana.com",
                )
            fetch.assert_not_called()
            self.assertEqual(os.listdir(out), [], "nothing may be written")


if __name__ == "__main__":
    unittest.main()
