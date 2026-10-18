#!/usr/bin/env bash
# Publica o build no branch gh-pages (GitHub Pages: "Deploy from a branch" → gh-pages / root).
# Uso: npm run publish:pages   (roda os testes do motor, gera o build com o caminho do repositório e envia)
set -euo pipefail
cd "$(dirname "$0")/.."

repo_url="$(git remote get-url origin)"
repo_name="$(basename -s .git "$repo_url")"
base="/${repo_name}/"
sha="$(git rev-parse --short HEAD)"

npm run typecheck
npm test
BASE="$base" npx vite build

out="$(mktemp -d)"
cp -r dist/. "$out/"
touch "$out/.nojekyll"   # sem Jekyll: arquivos servidos como estão
cd "$out"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name || echo publish)" -c user.email="$(git -C "$OLDPWD" config user.email || echo publish@localhost)" \
  commit -q -m "Publica o Mundial de Clubes 64 (${sha})" ${PUBLISH_TRAILER:+-m "$PUBLISH_TRAILER"}
git push -f "$repo_url" gh-pages:gh-pages
echo "Publicado: https://$(echo "$repo_url" | sed -E 's#.*github.com[/:]([^/]+)/.*#\1#').github.io${base}"
