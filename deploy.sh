#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="/var/www/dkl-books"
SERVICE_NAME="dkl-books"
NGINX_SITE="books.dkl-lab.de"
HEALTH_URL="http://127.0.0.1:4300/api/health"
DEPLOY_LOG="${PROJECT_ROOT}/deploy.log"

mkdir -p "${PROJECT_ROOT}"
touch "${DEPLOY_LOG}"
chmod 644 "${DEPLOY_LOG}"
exec > >(tee -a "${DEPLOY_LOG}") 2>&1

on_error() {
  local exit_code=$?
  local line_number=${BASH_LINENO[0]:-unknown}
  echo
  echo "Deployment fehlgeschlagen (Exit-Code ${exit_code}, Zeile ${line_number})."
  echo "Vollständiges Protokoll: ${DEPLOY_LOG}"
  echo
  if [[ -t 0 ]]; then
    read -r -p "Enter drücken, um dieses Fenster zu schließen ..." _
  fi
  exit "${exit_code}"
}

trap on_error ERR

echo
echo "=== Deployment $(date --iso-8601=seconds) ==="

if [[ "${EUID}" -ne 0 ]]; then
  echo "Bitte als root ausführen: sudo ${PROJECT_ROOT}/deploy.sh"
  false
fi

cd "${PROJECT_ROOT}"

if [[ ! -f .env ]]; then
  echo "Fehler: ${PROJECT_ROOT}/.env fehlt."
  false
fi

if [[ ! -f package-lock.json ]]; then
  echo "Fehler: package-lock.json fehlt."
  false
fi

echo "[1/8] Abhängigkeiten installieren"
npm ci --include=dev

echo "[2/8] Prisma-Client erzeugen"
npm run prisma:generate

echo "[3/8] Datenbankmigrationen ausführen"
npm run db:migrate

echo "[4/8] Produktions-Build erstellen"
rm -rf "${PROJECT_ROOT}/dist"
npm run build

echo "[5/8] Frontend-Build prüfen"
test -f "${PROJECT_ROOT}/dist/index.html"
test -d "${PROJECT_ROOT}/dist/assets"
chmod -R a+rX "${PROJECT_ROOT}/dist"

echo "[6/8] Upload-Verzeichnis und Dienst einrichten"
install -d -o www-data -g www-data -m 750 "${PROJECT_ROOT}/uploads"
install -m 644 "${PROJECT_ROOT}/deploy/dkl-books.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"

echo "[7/8] Nginx-Konfiguration installieren und prüfen"
install -m 644 "${PROJECT_ROOT}/deploy/nginx/${NGINX_SITE}.conf" "/etc/nginx/sites-available/${NGINX_SITE}"
ln -sfn "/etc/nginx/sites-available/${NGINX_SITE}" "/etc/nginx/sites-enabled/${NGINX_SITE}"
nginx -t

echo "[8/8] Dienste neu starten"
systemctl restart "${SERVICE_NAME}.service"
systemctl reload nginx

for attempt in {1..15}; do
  if curl --fail --silent --show-error "${HEALTH_URL}" >/dev/null; then
    echo "Deployment erfolgreich: ${HEALTH_URL} ist erreichbar."
    exit 0
  fi
  sleep 1
done

echo "Fehler: API ist nach dem Neustart nicht erreichbar."
systemctl status "${SERVICE_NAME}.service" --no-pager || true
journalctl -u "${SERVICE_NAME}.service" -n 50 --no-pager || true
false
