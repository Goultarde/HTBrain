#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VIEWER_DIR="$SCRIPT_DIR/htb_next_viewer"
LOG_FILE="$SCRIPT_DIR/runtime/start.log"
PID_FILE="$SCRIPT_DIR/runtime/start.pid"

BACKGROUND=false
ACTION="start"
PORT=3000

usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -b, --background    Lance en arrière-plan (logs dans runtime/start.log)"
    echo "  -p, --port PORT     Port d'écoute (défaut: 3000)"
    echo "  --stop              Arrête le serveur lancé en arrière-plan"
    echo "  --status            Affiche l'état du serveur"
    echo "  --logs              Affiche les logs en temps réel"
    echo "  -h, --help          Affiche cette aide"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -b|--background) BACKGROUND=true ;;
        -p|--port)       PORT="$2"; shift ;;
        --stop)          ACTION="stop" ;;
        --status)        ACTION="status" ;;
        --logs)          ACTION="logs" ;;
        -h|--help)       usage; exit 0 ;;
        *) echo "Option inconnue: $1"; usage; exit 1 ;;
    esac
    shift
done

case "$ACTION" in
    stop)
        if [[ -f "$PID_FILE" ]]; then
            PID=$(cat "$PID_FILE")
            kill -- -"$PID" 2>/dev/null || kill "$PID" 2>/dev/null || true
            rm -f "$PID_FILE"
            echo "Serveur arrêté (PID $PID)."
        else
            echo "Aucun serveur en cours (pas de PID file)."
        fi
        exit 0
        ;;
    status)
        if [[ -f "$PID_FILE" ]]; then
            PID=$(cat "$PID_FILE")
            if kill -0 "$PID" 2>/dev/null; then
                echo "En cours (PID $PID) http://localhost:$PORT"
            else
                echo "Arrêté (PID file obsolète)."
                rm -f "$PID_FILE"
            fi
        else
            echo "Arrêté."
        fi
        exit 0
        ;;
    logs)
        if [[ -f "$LOG_FILE" ]]; then
            tail -f "$LOG_FILE"
        else
            echo "Pas de log trouvé ($LOG_FILE)."
        fi
        exit 0
        ;;
esac

# --- Setup ---
mkdir -p "$SCRIPT_DIR/runtime"

# npm install si node_modules absent
if [[ ! -d "$VIEWER_DIR/node_modules" ]]; then
    echo "[setup] node_modules absent, installation..."
    npm install --prefix "$VIEWER_DIR"
fi

# Détection Python avec undetected_chromedriver
detect_python() {
    # Python système
    for py in python3 python; do
        if command -v "$py" &>/dev/null && "$py" -c "import undetected_chromedriver" 2>/dev/null; then
            echo "$py"; return
        fi
    done
    # Venvs pipx
    for venv_py in ~/.local/share/pipx/venvs/*/bin/python3; do
        if [[ -x "$venv_py" ]] && "$venv_py" -c "import undetected_chromedriver" 2>/dev/null; then
            echo "$venv_py"; return
        fi
    done
    echo ""
}

AUTH_PYTHON="$(detect_python)"
if [[ -z "$AUTH_PYTHON" ]]; then
    echo "[setup] Python avec undetected_chromedriver introuvable."
    echo "        Installe les dépendances : pip install -r htb_next_viewer/requirements.txt"
    exit 1
fi
echo "[setup] Python: $AUTH_PYTHON"
export AUTH_PYTHON

# --- Lancement ---
cd "$VIEWER_DIR"

if $BACKGROUND; then
    nohup npm run dev -- --port "$PORT" > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Serveur lancé en arrière-plan (PID $!) http://localhost:$PORT"
    echo "Logs : ./start.sh --logs"
    echo "Arrêt : ./start.sh --stop"
else
    npm run dev -- --port "$PORT"
fi
