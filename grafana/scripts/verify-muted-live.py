"""Compatibility entrypoint: full source and runtime-muted smoke, with explicit per-run evidence."""
import smoke
if __name__ == '__main__':
    smoke.initialize()
    assert smoke.a.mode == 'live'
    smoke.run()
