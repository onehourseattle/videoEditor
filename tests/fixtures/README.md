# Real-media fixtures

Drop real-world media files here (iPhone `.mov`, HEVC, 10-bit, variable frame
rate, DSLR footage, long recordings…) and `tests/e2e/media-compat.mjs` will
import each one, asserting it either loads cleanly or fails with a readable
error toast — never a crash.

Files here are gitignored; keep them local.
