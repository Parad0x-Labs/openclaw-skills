#!/usr/bin/env python3
"""
Shared zstd compressor factory for Liquefy runtime engines.

Centralizes threading/content-size defaults so engine-vs-benchmark comparisons
aren't skewed by inconsistent compressor settings.
"""

from __future__ import annotations

import math
import os
from typing import Optional

import zstandard as zstd


# Largest window any stock zstd decoder accepts without extra flags
# (ZSTD_WINDOWLOG_LIMIT_DEFAULT). Liquefy's own decoders use default
# ZstdDecompressor() stream readers, and so does `zstd -d`: a bigger window
# produces archives they refuse ("Frame requires too much memory").
MAX_PORTABLE_WINDOW_LOG = 27
MIN_WINDOW_LOG = 10


def _adaptive_window_log(source_size: Optional[int]) -> Optional[int]:
    """Window log sized to the input, capped at the portable decoder limit.

    Returns None when the size is unknown, so the level's own window is used.
    """
    if not source_size or source_size <= 0:
        return None
    wl = int(math.ceil(math.log2(max(1, int(source_size)))))
    return max(20, min(MAX_PORTABLE_WINDOW_LOG, wl))


def make_cctx(
    *,
    level: int = 19,
    threads: Optional[int] = -1,
    write_content_size: bool = True,
    write_checksum: bool = False,
    write_dict_id: bool = False,
    text_like: bool = False,
    enable_ldm: Optional[bool] = None,
    window_log: Optional[int] = None,
    source_size: Optional[int] = None,
):
    """
    Build a zstd compressor with consistent defaults.

    - `threads=-1` means "all cores" and is the baseline parity default.
    - Text-like streams at level >= 9 get a window sized to `source_size`
      (capped at 2^27) when the caller knows it.
    - Long-distance matching only when `enable_ldm=True`.

    python-zstandard refuses `threads` (or `level`) next to
    `compression_params`, so every setting goes into the params object.
    Invalid settings raise instead of silently falling back to a plain
    compressor.
    """
    eff_threads = -1 if threads in (None, 0) else int(threads)
    disable_ldm = os.getenv("LIQUEFY_DISABLE_LDM", "").strip() == "1"

    # Long-distance matching only on explicit request. Measured 2026-11-20:
    # forcing it for text at level 9 made small repetitive JSON 40% larger,
    # and at levels 19/22 it changed nothing on enwik8/enwik9. libzstd already
    # turns it on by itself for btopt+ strategies with a 128 MiB window.
    want_ldm = bool(enable_ldm) if enable_ldm is not None else False
    if disable_ldm:
        want_ldm = False

    if window_log is not None:
        wl: Optional[int] = int(window_log)
        if not MIN_WINDOW_LOG <= wl <= MAX_PORTABLE_WINDOW_LOG:
            raise ValueError(
                f"window_log {wl} outside {MIN_WINDOW_LOG}..{MAX_PORTABLE_WINDOW_LOG} "
                "(larger windows are not decodable by default zstd decoders)"
            )
    elif text_like and int(level) >= 9:
        # Text at ratio levels: let matches reach across the whole input.
        wl = _adaptive_window_log(source_size)
    else:
        wl = None

    if not want_ldm and wl is None:
        return zstd.ZstdCompressor(
            level=int(level),
            threads=eff_threads,
            write_content_size=write_content_size,
            write_checksum=write_checksum,
            write_dict_id=write_dict_id,
        )

    tuned = {"enable_ldm": want_ldm}
    if wl is not None:
        tuned["window_log"] = wl
    params = zstd.ZstdCompressionParameters.from_level(
        int(level),
        source_size=int(source_size) if source_size else 0,
        threads=eff_threads,
        write_content_size=write_content_size,
        write_checksum=write_checksum,
        write_dict_id=write_dict_id,
        **tuned,
    )
    return zstd.ZstdCompressor(compression_params=params)
