"""Skip unrelated CI only when every changed path is safely inside the site."""
import os
import subprocess
import sys


def requires_full_ci(paths):
    return not paths or any(
        not path.startswith(b"docs/") or path.startswith(b"docs/extractor/")
        for path in paths
    )


def main():
    event = os.environ.get("EVENT_NAME", "")
    base = os.environ.get("BASE_SHA" if event == "pull_request" else "BEFORE", "")
    head = os.environ.get("HEAD_SHA", "")
    full = True
    if event in ("push", "pull_request") and base and head and set(base) != {"0"}:
        try:
            if event == "pull_request":
                base = subprocess.check_output(
                    ["git", "merge-base", base, head], stderr=subprocess.DEVNULL
                ).decode().strip()
            paths = subprocess.check_output(
                ["git", "diff", "--no-renames", "--name-only", "-z", base, head, "--"],
                stderr=subprocess.DEVNULL,
            ).split(b"\0")
            full = requires_full_ci([path for path in paths if path])
        except (subprocess.CalledProcessError, OSError, UnicodeError):
            pass  # Unknown history must never suppress the full suite.
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        print(f"run={str(full).lower()}", file=output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
