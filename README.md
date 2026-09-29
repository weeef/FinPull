# FinPull 🏦

A secure, personal-use Chrome Extension (Manifest V3) that connects to your bank and investment accounts via [Plaid](https://plaid.com), displaying real-time balances, recent transactions, and portfolio holdings right in your browser toolbar.

---

## 🔒 Security Architecture

Plaid API credentials consist of a `client_id` and a sensitive `secret`. **Financial API secrets must never be embedded inside a browser extension** (where anyone or any dev tool could extract them).

FinPull uses a two-part architecture designed for single-user local use:

```
┌─────────────────────────────────────────────────────────────┐
│                       Your Machine                          │
│                                                             │
│  ┌────────────────────────┐       ┌──────────────────────┐  │       ┌──────────────┐
│  │    Chrome Extension    │       │     Local Server     │  │       │  Plaid API   │
│  │     (Manifest V3)      │◄─────►│   (Node + Express)   │◄─┼──────►│  (Sandbox /  │
│  │   extension/popup.html │ HTTP  │   server/server.js   │  │ HTTPS │  Production) │
│  └────────────────────────┘       └──────────┬───────────┘  │       └──────────────┘
│                                              │              │
│                                   ┌──────────▼───────────┐  │
│                                   │ .access_tokens.json  │  │
│                                   │     (gitignored)     │  │
│                                   └──────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

1. **Local Backend Server (`/server`)**: The only component that holds your `PLAID_SECRET`. It runs locally on `http://localhost:3000` and talks to Plaid's API.
2. **Chrome Extension (`/extension`)**: Talks *only* to your local server over localhost. It never receives or stores your API secret.
3. **Local Token Store (`.access_tokens.json`)**: Stores item tokens locally on your machine. This file and `.env` are strictly excluded in `.gitignore`.

---

## 📋 Prerequisites

- **Node.js**: v18.0.0 or newer ([Download Node.js](https://nodejs.org/))
- **Google Chrome**: Version 100+ (supports Manifest V3)
- **Plaid Account**: Free developer account ([Sign Up](https://dashboard.plaid.com/signup))

---

## 🚀 Step-by-Step Setup Guide

### Step 1: Get Your Free Plaid API Keys

1. Sign up for a free developer account at [dashboard.plaid.com/signup](https://dashboard.plaid.com/signup).
2. Once logged in, navigate to **Team Settings** → **[Keys](https://dashboard.plaid.com/team/keys)**.
3. Copy your:
   - **`client_id`**
   - **`sandbox` secret** (a long alphanumeric string)

---

### Step 2: Install & Start the Local Backend Server

1. Open your terminal and navigate to the `server/` directory:
   ```bash
   cd server
   ```

2. Install the minimal dependencies (`express`, `plaid`, `dotenv`, `cors`):
   ```bash
   npm install
   ```

3. Create your `.env` configuration file from the template:
   - **Windows (PowerShell)**:
     ```powershell
     Copy-Item .env.example .env
     ```
   - **macOS / Linux**:
     ```bash
     cp .env.example .env
     ```

4. Open `server/.env` in your text editor and fill in your Plaid credentials:
   ```env
   PLAID_CLIENT_ID=your_plaid_client_id_here
   PLAID_SECRET=your_plaid_sandbox_secret_here
   PLAID_ENV=sandbox
   PORT=3000
   ```

5. Start the backend server:
   ```bash
   npm start
   ```

   You should see:
   ```text
   ======================================================
   🚀 FinPull Local Backend running at http://localhost:3000
   🔒 Plaid Environment: SANDBOX
   📁 Token Storage: .../server/.access_tokens.json
   ======================================================
   ```

---

### Step 3: Load the Extension in Google Chrome

1. Open Google Chrome and navigate to `chrome://extensions` in the address bar.
2. In the top right corner, enable **Developer mode** (toggle switch).
3. Click the **Load unpacked** button in the top left corner.
4. Select the `extension/` folder inside this project directory (`d:\FinPull\extension`).
5. The **FinPull - Personal Financial Dashboard** extension will appear in your extensions list!
6. *(Optional Security Step)*: Note the 32-character **ID** shown under your extension card (e.g. `abcdefghijklmnopqrstuvwxyz123456`). You can paste this into `server/.env` under `EXTENSION_ID=your_id` to strictly limit CORS to your extension only.
7. Click the Chrome Extensions puzzle icon in your browser toolbar and **pin FinPull** for quick access.

---

### Step 4: Connect a Test Bank (Sandbox Mode)

1. Click the **FinPull** icon in your Chrome toolbar to open the popup.
2. You will see a status badge indicating `Server Online (sandbox)`.
3. Click **Connect an Account** (or **+ Connect Bank** in the Manage tab).
4. The Plaid Link modal will open. Select any sample bank (e.g., *Chase*, *Bank of America*, *First Platypus Bank*, etc.).
5. Use Plaid's official sandbox test credentials:

| Field | Sandbox Test Value | Description |
| :--- | :--- | :--- |
| **Username** | `user_good` | Standard user with multiple test accounts |
| **Password** | `pass_good` | Valid password for sandbox |
| **SMS / MFA Code** | `1234` or `123456` | Any 4-to-6 digit code works |

> [!NOTE]
> **All data in Sandbox is simulated!** The account numbers, balances ($100 to $40,000+), and transactions you see in Sandbox mode are fake data automatically generated by Plaid for testing purposes.

6. Once connected, the popup will automatically refresh to show:
   - **Total Net Balance** across all linked depository and credit accounts.
   - **Accounts Tab**: Breakdown of Checking, Savings, Credit Cards, and Investment accounts.
   - **Transactions Tab**: Recent transactions synchronized via Plaid's `/transactions/sync` API.
   - **Investments Tab**: Holdings, ticker symbols, quantities, and market values (if an investment institution was connected).
   - **Manage Tab**: List of connected institutions with options to disconnect or link additional banks.

---

### Advanced Sandbox Test Scenarios

Plaid provides special sandbox usernames to test different states:

- **`user_good`**: Success path with standard checking, savings, credit, and investment accounts.
- **`user_custom`**: Allows you to customize mock balances and transaction count.
- **`user_relink`**: Simulates an institution requiring re-authentication. FinPull will display a clear `ITEM_LOGIN_REQUIRED` warning rather than crashing.

---

## 🌐 Moving to Real Bank Accounts (Development Tier)

Once you have verified that the extension and backend work smoothly in Sandbox mode, you can connect your real financial institutions:

1. **Request Development Access**:
   - Go to your [Plaid Dashboard](https://dashboard.plaid.com/).
   - Plaid provides a free **Development** tier that allows you to connect up to 100 real live bank accounts.
   - Under **Team Settings** → **Keys**, locate your **Development Secret**.

2. **Update `server/.env`**:
   ```env
   PLAID_CLIENT_ID=your_client_id
   PLAID_SECRET=your_development_secret
   PLAID_ENV=development
   ```

3. **Restart the Server**:
   ```bash
   # In the /server directory:
   npm start
   ```

4. Open the extension popup, click **Connect Bank**, and log in using your real bank credentials via Plaid's secure OAuth flow.

---

---

## 📊 Google Sheets Budget Sync

FinPull allows you to push real-time account balances, credit balances, and investment totals straight into your personal Google Sheet budget with **1 click**.

### 🎯 Key Capabilities
1. **Flexible Budget Cell Mapping**:
   - Map any connected bank account (or Net Balance) directly to specific cells in your existing budget layout (e.g. `Chase Checking ➔ Budget!B5`, `Amex Card ➔ Budget!C12`, `Total Net Balance ➔ Summary!D2`).
   - Choose whether to push **Current Balance** or **Available Balance**.
2. **Account Snapshot Table**:
   - Automatically maintains a clean, formatted balance table in a dedicated tab (`FinPull_Balances`).
   - Supports **Overwrite Mode** (keeps a single live dashboard table) or **Append Mode** (creates a timestamped historical net worth log over time).
3. **1-Click Quick Push**:
   - Click the green `⚡ Push Numbers to Google Sheet` button in the **Sheets** tab or the quick push icon in the header at any time.
   - Option to automatically push to Google Sheets whenever balances refresh.

---

### ⚙️ Connection Setup

FinPull supports two connection methods:

#### Method A: Google Apps Script Webhook (Recommended — 1-Minute Setup)
*No Google Cloud project or API credentials required!*

1. Open your Google Sheet budget.
2. In the top menu, go to **Extensions** → **Apps Script**.
3. Copy the script from [`server/google_apps_script.js`](file:///d:/FinPull/server/google_apps_script.js) (or click **"📋 Copy Apps Script Code"** in the FinPull extension popup).
4. Paste it into the editor, replacing any default code, and click Save (💾).
5. Click **Deploy** (top right) → **New deployment**.
6. Click the gear icon next to "Select type" and choose **Web app**:
   - **Description**: `FinPull Sync`
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
7. Click **Deploy**, authorize permissions, and copy the **Web app URL** (`https://script.google.com/macros/s/.../exec`).
8. Paste this URL into FinPull's **Sheets** tab and click **Test Connection**!

#### Method B: Google Cloud Service Account API
*For users who prefer official Google Sheets v4 API service accounts:*

1. In the Google Cloud Console, enable the **Google Sheets API**.
2. Create a Service Account and download its JSON key file.
3. Open your Google Sheet and share it with the service account's email as **Editor**.
4. In FinPull's **Sheets** tab, select **Service Account API**, enter your Spreadsheet ID or URL, and paste the JSON key (saved locally to `server/service_account.json`).
5. Click **Test Connection**.

---

## 🛠️ Project Structure

```
FinPull/
├── .gitignore                      # Excludes .env, .access_tokens.json, .sheets_config.json, service_account.json
├── README.md                       # Documentation & instructions
│
├── server/                         # Node.js + Express backend
│   ├── package.json                # Dependencies: express, plaid, googleapis, dotenv, cors
│   ├── server.js                   # API routes and token management
│   ├── sheets.js                   # Google Sheets sync engine (Webhook + Service Account)
│   ├── google_apps_script.js       # Ready-to-deploy Google Apps Script template
│   ├── .env.example                # Environment variable template
│   └── .access_tokens.json.example # Schema example of local token storage
│
└── extension/                      # Chrome Extension (Manifest V3)
    ├── manifest.json               # MV3 manifest with sandbox & permissions
    ├── popup.html                  # Extension popup interface with Google Sheets tab
    ├── popup.css                   # Dark FinTech design system & sheets styling
    ├── popup.js                    # UI logic, data sync & Google Sheets dispatcher
    ├── sandbox.html                # MV3 Sandboxed page for Plaid Link SDK
    ├── sandbox.js                  # Bridge between Plaid Link and popup.js
    └── icons/                      # Extension icons (16px, 48px, 128px)
```

---

## 📡 API Endpoints (Local Server)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Server status, environment, and connected institution count |
| `POST` | `/create_link_token` | Calls Plaid `/link/token/create` to initiate Link UI |
| `POST` | `/exchange_public_token` | Exchanges Link `public_token` for permanent `access_token` |
| `GET` | `/accounts` | Retrieves balances across all connected institutions |
| `GET` | `/transactions` | Synchronizes recent transactions via `/transactions/sync` |
| `GET` | `/investments` | Fetches securities & holdings via `/investments/holdings/get` |
| `POST` | `/disconnect_account` | Revokes token on Plaid and deletes from local store |
| `GET` | `/link` | Dedicated standalone browser page for Plaid Link |
| `GET` | `/sheets/config` | Retrieves Google Sheets sync configuration & cell mappings |
| `POST` | `/sheets/config` | Saves Google Sheets sync configuration & cell mappings |
| `GET` | `/sheets/template_script`| Retrieves Google Apps Script webhook template code |
| `POST` | `/sheets/service_account_key` | Saves uploaded service_account.json key |
| `POST` | `/sheets/test` | Tests connection to Google Sheets (Webhook or Service Account) |
| `POST` | `/sheets/push` | Gathers latest balances and pushes numbers to Google Sheets |

---

## 🔍 Troubleshooting

- **Extension shows "Local Server Offline"**:
  Ensure you ran `npm start` inside the `server/` directory and that `http://localhost:3000/health` returns `{ "status": "online" }`.
- **"Plaid API keys missing" warning**:
  Make sure you copied `server/.env.example` to `server/.env` and supplied valid `PLAID_CLIENT_ID` and `PLAID_SECRET`.
- **CORS Error**:
  If you specified `EXTENSION_ID` in `server/.env`, verify that it matches the ID listed in `chrome://extensions`. Alternatively, leave `EXTENSION_ID` empty in `.env` to allow local extension requests automatically.

---

## 📜 License

MIT License. Designed for personal single-user financial tracking.
