#!/usr/bin/env bash
# BabyLog: creates the Siri / Back Tap shortcuts for both parents and signs them. macOS 12+ only.
#
#   curl -fsSL "$SITE/shortcuts/sign.sh" -o /tmp/babylog-sign.sh
#   BABYLOG_SITE="$SITE" bash /tmp/babylog-sign.sh
#
# $SITE is the address the app is installed from (without a trailing slash).
# The setup code (server address + secret key) is typed in here and is only written into the
# shortcut files on this Mac, which you then send to the two phones. It is never published.
set -euo pipefail

SITE="${BABYLOG_SITE:-}"
OUT="${BABYLOG_OUT:-$HOME/Desktop/BabyLog-shortcuts}"
SIGN="${BABYLOG_SIGN_CMD:-shortcuts}"
PLUTIL="${BABYLOG_PLUTIL_CMD:-plutil}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ -n "$SITE" ] || die 'BABYLOG_SITE is not set. Use the command from the instructions (it includes the app address).'
SITE="${SITE%/}"
if [ "$(uname -s)" != Darwin ] && [ -z "${BABYLOG_ALLOW_NON_MAC:-}" ]; then
  die 'This must be run on a Mac: Apple only signs shortcuts there.'
fi
command -v "$SIGN" >/dev/null 2>&1 || die 'The "shortcuts" command was not found. It needs macOS 12 (Monterey) or later.'
command -v "$PLUTIL" >/dev/null 2>&1 || die 'The "plutil" command was not found.'
command -v curl >/dev/null 2>&1 || die 'curl was not found.'

# 1. the setup code
code="${BABYLOG_CODE:-}"
if [ -z "$code" ]; then
  printf 'Paste the setup code (it starts with BL1) and press Enter. Nothing is shown while you paste: '
  read -rs code < /dev/tty
  echo
fi
code="$(printf '%s' "$code" | tr -d ' \t\r\n')"
case "$code" in BL1.*) ;; *) die 'The code must start with BL1.' ;; esac
b64="$(printf '%s' "${code#BL1.}" | tr '_-' '/+')"
pad=$(( (4 - ${#b64} % 4) % 4 ))
while [ "$pad" -gt 0 ]; do b64="${b64}="; pad=$((pad - 1)); done
json="$(printf '%s' "$b64" | { base64 -D 2>/dev/null || base64 -d; })" || die 'Could not read the code. Copy it again in full.'
URL="$(printf '%s' "$json" | sed -n 's/.*"u":"\([^"]*\)".*/\1/p')"
KEY="$(printf '%s' "$json" | sed -n 's/.*"k":"\([^"]*\)".*/\1/p')"
[ -n "$URL" ] && [ -n "$KEY" ] || die 'The code is malformed. Copy it again in full.'
case "$URL" in
  */dev|*/dev/)
    # The editor's private test address: it cannot work from phones. A real web app address is needed.
    EXEC="${BABYLOG_EXEC_URL:-}"
    if [ -z "$EXEC" ]; then
      printf 'The code contains the private test address (ends in /dev), which cannot work from a phone.\n'
      printf 'Paste the Web app address (Deploy > Manage deployments, ends in /exec) and press Enter: '
      read -r EXEC < /dev/tty || die 'No address given. Run rotateKey in the script editor to get a corrected code, or set BABYLOG_EXEC_URL.'
    fi
    EXEC="$(printf '%s' "$EXEC" | tr -d ' \t\r\n')"
    case "$EXEC" in
      https://*/exec|http://127.0.0.1*) URL="$EXEC" ;;
      *) die 'The address must start with https:// and end with /exec.' ;;
    esac
    ;;
esac

# 2. ask the server for the two parent names (this also proves that the code works)
reply="$(curl -fsS -L -X POST -H 'Content-Type: text/plain' --data "{\"key\":\"$KEY\",\"action\":\"settings\"}" "$URL")" \
  || die 'Could not reach the server. Check the internet connection and the code.'
case "$reply" in *'"ok":true'*) ;; *) die 'The server did not accept the code (wrong key, or the server was not set up yet).' ;; esac
names="$(printf '%s' "$reply" | sed -n 's/.*"parents":\["\([^"]*\)","\([^"]*\)"\].*/\1\
\2/p')"
P1="$(printf '%s\n' "$names" | sed -n 1p)"
P2="$(printf '%s\n' "$names" | sed -n 2p)"
[ -n "$P1" ] && [ -n "$P2" ] || die 'Could not read the parent names from the server. Open the app once and set them in Settings.'
case "$P1$P2" in *\\*) die 'A parent name contains a backslash. Rename it in the app Settings and try again.' ;; esac

# 3. download the templates
curl -fsS "$SITE/shortcuts/index.txt" -o "$TMP/index.txt" || die "Could not download the shortcut list from $SITE"
while IFS="$(printf '\t')" read -r file _name; do
  [ -n "$file" ] || continue
  curl -fsS "$SITE/shortcuts/templates/$file" -o "$TMP/$file" || die "Could not download $file"
done < "$TMP/index.txt"

# 4. fill in, convert and sign, once per parent
xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
sed_escape() { sed -e 's/[\\&|]/\\&/g'; }
fill() { printf '%s' "$1" | xml_escape | sed_escape; }

count=0
for ME in "$P1" "$P2"; do
  folder="$OUT/$(printf '%s' "$ME" | tr '/:' '--')"
  mkdir -p "$folder"
  u="$(fill "$URL")"; k="$(fill "$KEY")"; m="$(fill "$ME")"
  while IFS="$(printf '\t')" read -r file name; do
    [ -n "$file" ] || continue
    sed -e "s|@@URL@@|$u|g" -e "s|@@KEY@@|$k|g" -e "s|@@ME@@|$m|g" "$TMP/$file" > "$TMP/work.plist"
    if grep -q '@@' "$TMP/work.plist"; then die "A placeholder was left in $file."; fi
    "$PLUTIL" -convert binary1 "$TMP/work.plist"
    "$SIGN" sign --mode anyone --input "$TMP/work.plist" --output "$folder/$name.shortcut"
    count=$((count + 1))
  done < "$TMP/index.txt"
done

printf '\nDone: %s signed shortcuts in %s\n' "$count" "$OUT"
printf 'Send each parent their own folder to their own phone (AirDrop), open every file and tap "Add Shortcut".\n'
printf 'Afterwards delete the folder %s (it contains the secret key).\n' "$OUT"
if command -v open >/dev/null 2>&1 && [ -z "${BABYLOG_NO_OPEN:-}" ]; then open "$OUT" || true; fi
