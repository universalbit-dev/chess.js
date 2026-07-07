[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/universalbit-dev/chess.js/microchess-pages.yml?branch=microchess&style=flat-square&label=CI%20Pipeline&logo=github)](https://github.com/universalbit-dev/chess.js/actions)
[![Node.js Version](https://img.shields.io/badge/node-v22.17.1-green?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![PM2 Process Manager](https://img.shields.io/badge/pm2-v6.0.8%20%2F%20v7.0.1-blueviolet?style=flat-square&logo=pm2&logoColor=white)](https://pm2.keymetrics.io)
## ⚡️ Preparing chess.js for microchess

> **🛠️ Before you run microchess, make sure the main chess.js library is installed!**

### 📦 Installation Steps

**Clone the repository:**
   ```bash
   git clone https://github.com/universalbit-dev/chess.js.git
   cd chess.js
   ```

**Install dependencies (this also prepares the `dist/` folder automatically):**
   ```bash
   npm install
   ```
---

> **🔑 Need an API Key?**  
> To use microchess with [JSONBin.io](https://jsonbin.io/), you’ll need a free API access key.
>
> Go to [https://jsonbin.io/api-reference/access-keys/create](https://jsonbin.io/api-reference/access-keys/create).
> Sign up or log in.
> Create an access key and copy it.
> Paste it into the `JSONBIN_ACCESS_KEY` field in your `.env` file.

**💡 Tip:** Keep your API key private—never share it in public repositories!

---
# ♟️ microchess

**microchess** is a minimal, automated chess module with standardized logging and scheduled uploads of unique chess games.  
Built for reliability, transparency, and ease of use.

---

## ✨ Why Use microchess?

- 🤖 **Automated:** Uploads unique chess games every hour
- 🛡️ **No Duplicates:** Deduplication logic, unique games are uploaded.
- 🏗️ **Production-Ready:** Clean logging, robust scheduling, and modern Node.js support.
- 🔌 **Pluggable:** Easily integrates with chess pipelines or analytics projects.
- 💡 **Open Source:** Fork, modify, or contribute as you like!

---

## 🚀 Quick Start

### 1. 📥 Enter the microchess Directory

```bash
cd chess.js/microchess
```

---

### 2. 📦 Install Dependencies
[![Node.js Version](https://img.shields.io/badge/node-v22.17.1-green?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
```bash
npm i && npm run build
```

---

### 3. ⚙️ Configure Your Environment (.env)

Edit `.env` file and fill in:
```env
# Time interval (in milliseconds) between random game generations/uploads
MICROCHESS_GENERATOR_INTERVAL=450000
MICROCHESS_UPLOAD_INTERVAL=3600000
# Your jsonbin.io API Access Key
JSONBIN_ACCESS_KEY= <== JSONBIN API Access-Key
JSONBIN_BIN_ID=     <== JSONBIN_ID
RANDOMCHESS_PATH=./randomchess.json
METADATA_PATH=./metadata.json
```

###  🏁 Run microchess

```bash
pm2 start microchess.config.js
```
This launches both the chess engine and the scheduled uploader.

---

## 🧠 How It Works

- **microchess.js** — Main logic for chess move generation and logging.
- **jsonbin_randomchess.js** — Every hour, deduplicates your chess game log and uploads new, unique games to your endpoint (e.g., jsonbin.io).
- **Metadata** — Each upload’s result and stats are saved to `metadata.json` for transparency and troubleshooting.

---

## 📝 Example Output

```
Uploader started. Uploading every 3600s...
[2025-07-26T13:42:53.103Z] Upload successful. Metadata saved to metadata.json.
```

---

## 🔧 Advanced Usage

- **Change Upload Interval:**  
  Set `MICROCHESS_GENERATOR_INTERVAL and MICROCHESS_UPLOAD_INTERVAL` in your `.env` to control how often uploads happen (in milliseconds).
  
| Interval (ms) | Interval (Time)  | Effect                                   |
|:-------------:|:----------------:|:-----------------------------------------|
| 3600000       | 1 hour           | Uploads once every hour (default)        |
| 60000         | 1 minute         | Uploads once every minute                |
| 86400000      | 24 hours (1 day) | Uploads once every day                   |
| 10000         | 10 seconds       | Uploads every 10 seconds (for testing)   |

- **Custom Data Locations:**  
  Set `RANDOMCHESS_PATH` and `METADATA_PATH` in your `.env`.
- **Forking/Contributing:**  
  Fork the repository, make your changes, and submit a pull request!

---

## ❓ FAQ

**Q: How do I know if my games were uploaded?**  
A: Check the console output and the `metadata.json` file for upload statuses and responses.

**Q: How are duplicates prevented?**  
A: microchess automatically deduplicates games before uploading. No extra action is needed.

---

## 👤 Author

[universalbit-dev](https://github.com/universalbit-dev)

---
