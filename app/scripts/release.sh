#!/bin/sh
# Achmage Yogurt uses the unsigned desktop workflow.
printf "%s\n" "Use: pnpm -C app exec electron-builder --publish never. See docs/RELEASE.md." >&2
exit 1
