#!/bin/bash
# Atualização diária da faixa do Instagram (sem IA). Publica só se algo mudou.
set -u
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
LOG=logs/instagram-cron.log
echo "== $(date '+%F %T')" >> "$LOG"
git pull -q --ff-only origin main >> "$LOG" 2>&1 || { echo "pull falhou" >> "$LOG"; exit 1; }
node scripts/update-instagram.mjs >> "$LOG" 2>&1 || { echo "update falhou; site intacto" >> "$LOG"; exit 1; }
if [ -z "$(git status --porcelain -- index.html fotos/instagram)" ]; then echo "sem mudanças" >> "$LOG"; exit 0; fi
git add index.html fotos/instagram
git commit -q -m "Instagram: atualização automática $(date +%F)" >> "$LOG" 2>&1
git push -q origin main >> "$LOG" 2>&1 && echo "publicado" >> "$LOG" || echo "push falhou" >> "$LOG"
