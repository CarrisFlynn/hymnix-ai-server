"""Platform and architecture facts for ARM-aware assets."""
from __future__ import annotations

import platform
import sys

ARCH_ALIASES = {
    "amd64": "x86_64", "x86_64": "x86_64", "x64": "x86_64",
    "arm64": "arm64", "aarch64": "arm64",
    "x86": "x86", "i386": "x86", "i686": "x86",
}


def normalize_arch(machine=None) -> str | None:
    value = platform.machine() if machine is None else machine
    try:
        return ARCH_ALIASES.get(str(value).strip().lower())
    except Exception:
        return None


def platform_key(system=None) -> str:
    value = sys.platform if system is None else system
    try:
        value = str(value).strip().lower()
    except Exception:
        return "other"
    if value.startswith("win"):
        return "windows"
    if value.startswith("linux"):
        return "linux"
    if value.startswith("darwin"):
        return "darwin"
    return "other"


def cloudflared_binary_name(system=None) -> str:
    return "cloudflared.exe" if platform_key(system) == "windows" else "cloudflared"


def cloudflared_asset(system=None, machine=None) -> dict:
    plat = platform_key(system)
    arch = normalize_arch(machine)
    names = {
        ("windows", "x86_64"): ("cloudflared-windows-amd64.exe", False),
        ("windows", "arm64"): ("cloudflared-windows-arm64.exe", False),
        ("linux", "x86_64"): ("cloudflared-linux-amd64", False),
        ("linux", "arm64"): ("cloudflared-linux-arm64", False),
        ("darwin", "x86_64"): ("cloudflared-darwin-amd64.tgz", True),
        ("darwin", "arm64"): ("cloudflared-darwin-arm64.tgz", True),
    }
    item = names.get((plat, arch))
    if item is None:
        return {"ok": False, "platform": plat, "arch": arch, "filename": "", "url": "", "archive": False,
                "error": f"unsupported_platform: {plat}/{arch or machine}"}
    filename, archive = item
    return {"ok": True, "platform": plat, "arch": arch, "filename": filename,
            "url": "https://github.com/cloudflare/cloudflared/releases/latest/download/" + filename,
            "archive": archive, "error": ""}


def looks_like_binary(head: bytes, system=None) -> bool:
    data = head[:2] if isinstance(head, bytes) else b""
    plat = platform_key(system)
    if plat == "windows":
        return data == b"MZ"
    if plat in ("linux", "darwin"):
        return (isinstance(head, bytes) and head.startswith(b"\x7fELF")) or data == b"\x1f\x8b"
    return False


def platform_matrix() -> list[dict]:
    return [
        {"platform": "windows", "arch": "x86_64", "tier": 1, "status": "supported", "notes": "primary"},
        {"platform": "windows", "arch": "arm64", "tier": 2, "status": "experimental", "notes": "ARM64 build"},
        {"platform": "linux", "arch": "x86_64", "tier": 2, "status": "community", "notes": "community support"},
        {"platform": "linux", "arch": "arm64", "tier": 2, "status": "experimental", "notes": "ARM64 build"},
        {"platform": "darwin", "arch": "arm64", "tier": 3, "status": "feasibility", "notes": "feasibility only"},
        {"platform": "darwin", "arch": "x86_64", "tier": 3, "status": "feasibility", "notes": "feasibility only"},
    ]


def _selftest() -> None:
    assert normalize_arch(" AMD64 ") == "x86_64"
    assert normalize_arch("AARCH64") == "arm64"
    expected = [("windows", "x86_64"), ("windows", "arm64"), ("linux", "x86_64"),
                ("linux", "arm64"), ("darwin", "x86_64"), ("darwin", "arm64")]
    for system, machine in expected:
        result = cloudflared_asset(system, machine)
        assert result["ok"] and result["filename"] and result["url"].endswith(result["filename"])
    assert not cloudflared_asset("other", "mips")["ok"]
    assert looks_like_binary(b"MZpayload", "win32")
    assert looks_like_binary(b"\x7fELFpayload", "linux")
    assert looks_like_binary(b"\x1f\x8bpayload", "darwin")


if __name__ == "__main__":
    _selftest()
    print("SELFTEST OK")
