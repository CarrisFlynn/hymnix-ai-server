"""Headless Hymnix gateway entry point for the Electron client."""
import os
import traceback

if __name__ == "__main__":
    control_dir = os.environ.get("HYMNIX_DESKTOP_CONTROL_DIR")
    try:
        from gateway_core import main
        main(control_dir=control_dir)
    except Exception:
        if control_dir:
            try:
                with open(os.path.join(control_dir, "error.log"), "w", encoding="utf-8") as handle:
                    traceback.print_exc(file=handle)
            except OSError:
                pass
            # With a windowed PyInstaller bootloader, an uncaught exception opens a dialog.
            raise SystemExit(1)
        raise
