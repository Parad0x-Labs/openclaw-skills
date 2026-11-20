#!/usr/bin/env python3
"""make_cctx must apply its text tuning, never silently drop it, and never
emit frames that stock zstd decoders refuse."""
import io

import pytest
import zstandard as zstd

from common_zstd import MAX_PORTABLE_WINDOW_LOG, make_cctx


def _sample(n: int) -> bytes:
    line = b'<page><title>Sample %d</title><text>Some wiki text here.</text></page>\n'
    out = bytearray()
    i = 0
    while len(out) < n:
        out += line % i
        i += 1
    return bytes(out[:n])


def test_text_window_follows_source_size_with_threads():
    # Regression: threads=-1 next to compression_params raised inside a bare
    # except, so the tuned window was silently replaced by the level default.
    raw = _sample(1 << 23)
    plain = zstd.ZstdCompressor(level=9, threads=-1).compress(raw)
    cctx = make_cctx(level=9, threads=-1, text_like=True, source_size=len(raw))
    blob = cctx.compress(raw)
    # Level 9 alone uses a smaller window; the tuned path must widen it to the input.
    assert zstd.get_frame_parameters(plain).window_size < 1 << 23
    assert zstd.get_frame_parameters(blob).window_size == 1 << 23
    assert zstd.ZstdDecompressor().decompress(blob) == raw


def test_window_never_exceeds_default_decoder_limit():
    raw = _sample(1 << 20)
    cctx = make_cctx(level=19, threads=-1, text_like=True, source_size=1 << 30)
    blob = cctx.compress(raw)
    assert zstd.get_frame_parameters(blob).window_size <= 1 << MAX_PORTABLE_WINDOW_LOG
    with zstd.ZstdDecompressor().stream_reader(io.BytesIO(blob)) as reader:
        assert reader.read() == raw


def test_oversized_explicit_window_is_refused():
    with pytest.raises(ValueError):
        make_cctx(level=19, window_log=MAX_PORTABLE_WINDOW_LOG + 1)
