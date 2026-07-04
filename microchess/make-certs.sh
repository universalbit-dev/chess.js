#!/usr/bin/env bash

# Exit immediately if any command fails
set -e

CERT_DIR="./certs"
KEY_FILE="$CERT_DIR/server.key"
CRT_FILE="$CERT_DIR/server.crt"

# Create certs directory if it doesn't exist
if [ ! -d "$CERT_DIR" ]; then
  mkdir "$CERT_DIR"
  echo "[SSL Build] Created certs directory."
fi

# Check if certificates already exist to prevent overwriting
if [ -f "$KEY_FILE" ] && [ -f "$CRT_FILE" ]; then
  echo "[SSL Build] Certificates already exist. Skipping generation."
  exit 0
fi

echo "[SSL Build] Generating local self-signed SSL certificates..."

# Generate self-signed RSA key pairs cleanly without user prompts
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$KEY_FILE" \
  -out "$CRT_FILE" \
  -subj "/C=US/ST=State/L=City/O=MicroChess/OU=Dev/CN=localhost" 2>/dev/null

# Restrict file permissions for structural safety
chmod 600 "$KEY_FILE"
chmod 644 "$CRT_FILE"

echo "[SSL Build] Success! SSL assets compiled inside $CERT_DIR/"
