#!/usr/bin/env bash
set -euo pipefail

UUID="PR-Butler@kronleuchter"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
EXTENSIONS_DIR="${XDG_DATA_HOME:-"$HOME/.local/share"}/gnome-shell/extensions"
INSTALL_DIR="$EXTENSIONS_DIR/$UUID"

if ! command -v glib-compile-schemas >/dev/null 2>&1; then
	printf 'Error: glib-compile-schemas is required (install the GLib utilities).\n' >&2
	exit 1
fi

mkdir -p "$INSTALL_DIR"
INSTALL_DIR_REAL="$(cd -- "$INSTALL_DIR" && pwd -P)"

if [[ "$SOURCE_DIR" != "$INSTALL_DIR_REAL" ]]; then
	tar -C "$SOURCE_DIR" --exclude=.git -cf - . | tar -C "$INSTALL_DIR" -xf -
fi

glib-compile-schemas "$INSTALL_DIR/schemas"
printf 'Installed %s to %s\n' "$UUID" "$INSTALL_DIR"

if command -v gnome-extensions >/dev/null 2>&1; then
	if gnome-extensions enable "$UUID"; then
		printf 'Enabled %s\n' "$UUID"
	else
		printf 'Could not enable it automatically. Run: gnome-extensions enable %s\n' "$UUID" >&2
	fi
else
	printf 'Enable it with: gnome-extensions enable %s\n' "$UUID"
fi
