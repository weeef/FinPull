/**
 * FinPull - Local Backend Server (Node.js + Express)
 * 
 * Purpose:
 * Securely communicates with Plaid API using your client_id and secret.
 * This server runs exclusively on your local machine (localhost).
 * The Chrome extension communicates ONLY with this server and never touches the Plaid Secret.
 * 
 * Storage:
 * Access tokens are stored in `.access_tokens.json` in this server directory.
 * Note: Local file storage is suitable for single-user personal use,
 * but should never be used as-is for a multi-user public production product.
 */

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid');

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const TOKENS_FILE = path.join(__dirname, '.access_tokens.json');

// Middleware
app.use(express.json());

// Configure CORS: restrict to your Chrome extension ID or localhost
const extensionId = process.env.EXTENSION_ID;
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like curl, Postman, or local scripts)
    if (!origin) return callback(null, true);

    // If EXTENSION_ID is specified in .env, restrict to that specific extension ID
    if (extensionId && origin === `chrome-extension://${extensionId}`) {
      return callback(null, true);
    }

    // If EXTENSION_ID is not yet configured, allow any chrome-extension:// origin for easy setup
    if (!extensionId && origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }

    // Allow localhost origins (e.g. for testing web pages or bridge)
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      return callback(null, true);
    }

    callback(new Error(`CORS blocked request from origin: ${origin}`));
  },
  credentials: true
}));

// ==========================================
// 1. Plaid Client Initialization
// ==========================================

const plaidEnv = process.env.PLAID_ENV || 'sandbox';

// Map environment string to PlaidEnvironments enum
const getPlaidEnvUrl = (env) => {
  switch (env.toLowerCase()) {
    case 'production':
      return PlaidEnvironments.production;
    case 'development':
      return PlaidEnvironments.development;
    case 'sandbox':
    default:
      return PlaidEnvironments.sandbox;
  }
};

const configuration = new Configuration({
  basePath: getPlaidEnvUrl(plaidEnv),
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
      'Plaid-Version': '2020-09-14',
    },
  },
});

const plaidClient = new PlaidApi(configuration);

// ==========================================
// 2. Local Token Storage Helpers
// ==========================================

/**
 * Read stored items and access tokens from .access_tokens.json
 * Format: { [itemId]: { itemId, accessToken, institutionName, institutionId, createdAt, cursor } }
 */
function readStoredTokens() {
  try {
    if (!fs.existsSync(TOKENS_FILE)) {
      fs.writeFileSync(TOKENS_FILE, JSON.stringify({ items: {} }, null, 2));
      return { items: {} };
    }
    const data = fs.readFileSync(TOKENS_FILE, 'utf8');
    return JSON.parse(data || '{"items":{}}');
  } catch (error) {
    console.error('Error reading access tokens file:', error.message);
    return { items: {} };
  }
}

/**
 * Write updated items and access tokens to .access_tokens.json
 */
function writeStoredTokens(data) {
  try {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing access tokens file:', error.message);
  }
}

// ==========================================
// 3. API Routes
// ==========================================

/**
 * Health & Status check
 */
app.get('/health', (req, res) => {
  const { items } = readStoredTokens();
  const connectedCount = Object.keys(items || {}).length;
  
  res.json({
    status: 'online',
    environment: plaidEnv,
    hasCredentials: Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET),
    connectedInstitutionsCount: connectedCount,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /create_link_token
 * 
 * Initiates the Plaid Link flow.
 * Creates a short-lived link_token on Plaid's servers, which the frontend Link SDK
 * uses to display the bank selection and login modal.
 */
app.post('/create_link_token', async (req, res) => {
  try {
    if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
      return res.status(500).json({
        error: 'Plaid credentials missing. Please configure PLAID_CLIENT_ID and PLAID_SECRET in server/.env'
      });
    }

    // Configure products to request from Plaid
    // Auth: account/routing numbers
    // Transactions: recent purchases & deposits
    // Investments: stocks, ETFs, mutual funds holdings
    const products = [Products.Auth, Products.Transactions, Products.Investments];

    const linkTokenConfig = {
      user: {
        // Unique identifier for your local user session
        client_user_id: 'finpull-personal-user',
      },
      client_name: 'FinPull Personal Dashboard',
      products: products,
      country_codes: [CountryCode.Us],
      language: 'en',
    };

    const response = await plaidClient.linkTokenCreate(linkTokenConfig);
    
    // Return link_token to the extension
    res.json({
      link_token: response.data.link_token,
      expiration: response.data.expiration
    });
  } catch (error) {
    console.error('Error creating Plaid link token:', error.response ? error.response.data : error.message);
    res.status(500).json({
      error: 'Failed to create Plaid link token',
      details: error.response ? error.response.data : error.message
    });
  }
});

/**
 * POST /exchange_public_token
 * 
 * Receives the temporary `public_token` generated by Plaid Link when you log into a bank,
 * exchanges it for a permanent `access_token`, and saves it locally in `.access_tokens.json`.
 */
app.post('/exchange_public_token', async (req, res) => {
  const { public_token, metadata } = req.body;

  if (!public_token) {
    return res.status(400).json({ error: 'Missing public_token in request body' });
  }

  try {
    // Exchange public_token for access_token and item_id
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token: public_token,
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    // Extract institution details from Link metadata if available
    const institutionName = metadata?.institution?.name || 'Bank Account';
    const institutionId = metadata?.institution?.institution_id || 'unknown';

    // Store in local .access_tokens.json
    const store = readStoredTokens();
    store.items = store.items || {};
    store.items[itemId] = {
      itemId,
      accessToken,
      institutionName,
      institutionId,
      createdAt: new Date().toISOString(),
      cursor: null // Cursor for incremental transaction sync
    };

    writeStoredTokens(store);

    console.log(`[FinPull] Successfully linked institution: ${institutionName} (Item: ${itemId})`);

    res.json({
      success: true,
      itemId,
      institutionName,
      message: `Successfully connected to ${institutionName}`
    });
  } catch (error) {
    console.error('Error exchanging public token:', error.response ? error.response.data : error.message);
    res.status(500).json({
      error: 'Failed to exchange public token with Plaid',
      details: error.response ? error.response.data : error.message
    });
  }
});

/**
 * GET /accounts
 * 
 * Fetches real-time account balances from Plaid for all connected institutions.
 * Combines them into a single summary with total balance and per-account breakdowns.
 */
app.get('/accounts', async (req, res) => {
  try {
    const store = readStoredTokens();
    const items = store.items || {};
    const itemIds = Object.keys(items);

    if (itemIds.length === 0) {
      return res.json({
        totalBalance: 0,
        accounts: [],
        institutions: [],
        message: 'No bank accounts connected yet.'
      });
    }

    const allAccounts = [];
    const institutionsList = [];
    let totalBalance = 0;

    // Fetch accounts for each linked institution
    for (const itemId of itemIds) {
      const itemData = items[itemId];
      try {
        // Plaid /accounts/balance/get retrieves real-time balances
        const response = await plaidClient.accountsBalanceGet({
          access_token: itemData.accessToken,
        });

        const accounts = response.data.accounts || [];
        
        institutionsList.push({
          itemId: itemId,
          institutionName: itemData.institutionName,
          institutionId: itemData.institutionId,
          status: 'OK',
          accountCount: accounts.length,
          connectedAt: itemData.createdAt
        });

        for (const acc of accounts) {
          const currentBalance = acc.balances?.current ?? 0;
          const availableBalance = acc.balances?.available ?? currentBalance;
          
          // Add to total balance (credit/loan accounts subtract or represent liabilities)
          if (acc.type === 'credit' || acc.type === 'loan') {
            totalBalance -= currentBalance;
          } else {
            totalBalance += currentBalance;
          }

          allAccounts.push({
            id: acc.account_id,
            itemId: itemId,
            institutionName: itemData.institutionName,
            name: acc.name,
            officialName: acc.official_name || acc.name,
            mask: acc.mask ? `•••${acc.mask}` : '••••',
            type: acc.type,         // depository, credit, loan, investment
            subtype: acc.subtype,   // checking, savings, credit card, 401k, etc.
            balances: {
              current: currentBalance,
              available: availableBalance,
              isoCurrencyCode: acc.balances?.iso_currency_code || 'USD'
            }
          });
        }
      } catch (itemError) {
        const errorData = itemError.response?.data;
        const errorCode = errorData?.error_code;

        console.error(`Error fetching balances for ${itemData.institutionName}:`, errorCode || itemError.message);

        // Surface Plaid error cleanly (e.g. ITEM_LOGIN_REQUIRED if bank credentials changed)
        institutionsList.push({
          itemId: itemId,
          institutionName: itemData.institutionName,
          institutionId: itemData.institutionId,
          status: errorCode === 'ITEM_LOGIN_REQUIRED' ? 'ITEM_LOGIN_REQUIRED' : 'ERROR',
          errorMessage: errorData?.error_message || itemError.message,
          reconnectRequired: errorCode === 'ITEM_LOGIN_REQUIRED'
        });
      }
    }

    res.json({
      totalBalance: Math.round(totalBalance * 100) / 100,
      accounts: allAccounts,
      institutions: institutionsList
    });
  } catch (error) {
    console.error('Error fetching accounts:', error.message);
    res.status(500).json({ error: 'Failed to retrieve accounts', details: error.message });
  }
});

/**
 * GET /transactions
 * 
 * Fetches recent transactions across all connected accounts using Plaid's modern
 * `/transactions/sync` API (incremental updates with cursors).
 */
app.get('/transactions', async (req, res) => {
  try {
    const store = readStoredTokens();
    const items = store.items || {};
    const itemIds = Object.keys(items);

    if (itemIds.length === 0) {
      return res.json({ transactions: [] });
    }

    let allTransactions = [];

    for (const itemId of itemIds) {
      const itemData = items[itemId];
      try {
        let cursor = itemData.cursor || null;
        let hasMore = true;
        let added = [];
        let modified = [];
        let removed = [];

        // Paginate through any new transaction sync updates
        // In personal use, 1 or 2 iterations retrieve all recent transactions
        let maxIterations = 3;
        while (hasMore && maxIterations > 0) {
          maxIterations--;
          const syncResponse = await plaidClient.transactionsSync({
            access_token: itemData.accessToken,
            cursor: cursor || undefined,
            count: 50,
          });

          const data = syncResponse.data;
          added = added.concat(data.added);
          modified = modified.concat(data.modified);
          removed = removed.concat(data.removed);
          hasMore = data.has_more;
          cursor = data.next_cursor;
        }

        // Save updated cursor for this item
        store.items[itemId].cursor = cursor;
        writeStoredTokens(store);

        // Format transactions
        for (const tx of added) {
          allTransactions.push({
            id: tx.transaction_id,
            itemId: itemId,
            institutionName: itemData.institutionName,
            accountId: tx.account_id,
            amount: tx.amount, // Note: In Plaid, positive = money spent/outflow, negative = deposit/inflow
            date: tx.date,
            authorizedDate: tx.authorized_date || tx.date,
            name: tx.name,
            merchantName: tx.merchant_name || tx.name,
            pending: tx.pending,
            category: tx.category ? tx.category.join(' > ') : (tx.personal_finance_category?.primary || 'General'),
            isoCurrencyCode: tx.iso_currency_code || 'USD'
          });
        }
      } catch (itemError) {
        console.error(`Error syncing transactions for ${itemData.institutionName}:`, itemError.response?.data || itemError.message);
      }
    }

    // Sort all transactions by date descending (newest first)
    allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Limit to latest 50
    res.json({
      count: allTransactions.length,
      transactions: allTransactions.slice(0, 50)
    });
  } catch (error) {
    console.error('Error fetching transactions:', error.message);
    res.status(500).json({ error: 'Failed to retrieve transactions', details: error.message });
  }
});

/**
 * GET /investments
 * 
 * Calls `/investments/holdings/get` for all connected institutions.
 * Gracefully ignores institutions that do not support investment products (e.g. checking-only banks).
 */
app.get('/investments', async (req, res) => {
  try {
    const store = readStoredTokens();
    const items = store.items || {};
    const itemIds = Object.keys(items);

    if (itemIds.length === 0) {
      return res.json({ holdings: [], securities: [], totalInvestmentsValue: 0 });
    }

    const allHoldings = [];
    const securitiesMap = {};
    let totalInvestmentsValue = 0;

    for (const itemId of itemIds) {
      const itemData = items[itemId];
      try {
        const response = await plaidClient.investmentsHoldingsGet({
          access_token: itemData.accessToken,
        });

        const holdings = response.data.holdings || [];
        const securities = response.data.securities || [];

        // Build quick lookup map for securities
        for (const sec of securities) {
          securitiesMap[sec.security_id] = {
            securityId: sec.security_id,
            name: sec.name,
            tickerSymbol: sec.ticker_symbol || 'N/A',
            type: sec.type,
            closePrice: sec.close_price,
            closePriceAsOf: sec.close_price_as_of,
            isoCurrencyCode: sec.iso_currency_code || 'USD'
          };
        }

        // Map holdings
        for (const h of holdings) {
          const security = securitiesMap[h.security_id] || {};
          const value = h.institution_value ?? ((h.quantity || 0) * (security.closePrice || 0));
          totalInvestmentsValue += value;

          allHoldings.push({
            holdingId: `${itemId}_${h.account_id}_${h.security_id}`,
            itemId: itemId,
            institutionName: itemData.institutionName,
            accountId: h.account_id,
            securityId: h.security_id,
            name: security.name || 'Unknown Security',
            tickerSymbol: security.tickerSymbol || 'N/A',
            type: security.type || 'Other',
            quantity: h.quantity,
            costBasis: h.cost_basis,
            price: security.closePrice || h.institution_price || 0,
            value: Math.round(value * 100) / 100,
            isoCurrencyCode: h.iso_currency_code || security.isoCurrencyCode || 'USD'
          });
        }
      } catch (itemError) {
        // If the institution does not have or support investment accounts, Plaid returns an error
        // e.g. PRODUCTS_NOT_SUPPORTED or INVALID_PRODUCT. We handle this gracefully.
        const errorCode = itemError.response?.data?.error_code;
        if (errorCode === 'PRODUCTS_NOT_SUPPORTED' || errorCode === 'INVALID_PRODUCT') {
          // Expected for banks without investment accounts
          continue;
        }
        console.warn(`Investments not available for ${itemData.institutionName}: ${errorCode || itemError.message}`);
      }
    }

    // Sort holdings by value descending
    allHoldings.sort((a, b) => (b.value || 0) - (a.value || 0));

    res.json({
      totalInvestmentsValue: Math.round(totalInvestmentsValue * 100) / 100,
      holdingsCount: allHoldings.length,
      holdings: allHoldings
    });
  } catch (error) {
    console.error('Error fetching investments:', error.message);
    res.status(500).json({ error: 'Failed to retrieve investments', details: error.message });
  }
});

/**
 * POST /disconnect_account
 * 
 * Disconnects a bank item:
 * 1. Calls Plaid `/item/remove` to revoke the access_token.
 * 2. Removes the item from local `.access_tokens.json`.
 */
app.post('/disconnect_account', async (req, res) => {
  const { itemId } = req.body;

  if (!itemId) {
    return res.status(400).json({ error: 'Missing itemId parameter' });
  }

  try {
    const store = readStoredTokens();
    const itemData = store.items?.[itemId];

    if (!itemData) {
      return res.status(404).json({ error: `Account with itemId ${itemId} not found in local storage` });
    }

    // Revoke token on Plaid's servers
    try {
      await plaidClient.itemRemove({
        access_token: itemData.accessToken,
      });
      console.log(`[FinPull] Plaid item ${itemId} revoked on Plaid.`);
    } catch (plaidErr) {
      console.warn(`[FinPull] Notice: Plaid itemRemove returned: ${plaidErr.message}`);
    }

    // Remove from local storage
    const institutionName = itemData.institutionName;
    delete store.items[itemId];
    writeStoredTokens(store);

    console.log(`[FinPull] Removed ${institutionName} (${itemId}) from local storage.`);

    res.json({
      success: true,
      removedItemId: itemId,
      institutionName,
      message: `Disconnected ${institutionName}`
    });
  } catch (error) {
    console.error('Error disconnecting account:', error.message);
    res.status(500).json({ error: 'Failed to disconnect account', details: error.message });
  }
});

// ==========================================
// 4. Standalone Plaid Link Bridge Page
// ==========================================
/**
 * Serves a dedicated web page for Plaid Link at http://localhost:3000/link
 * Can be opened in a browser tab as an alternative to the popup iframe if desired.
 */
app.get('/link', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FinPull - Connect Account (Plaid Link)</title>
  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      text-align: center;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 32px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    h1 { margin-top: 0; font-size: 24px; color: #58a6ff; }
    p { color: #8b949e; line-height: 1.5; font-size: 14px; }
    button {
      background: #238636;
      color: white;
      border: none;
      padding: 12px 24px;
      font-size: 16px;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 20px;
      transition: background 0.2s;
    }
    button:hover { background: #2ea043; }
    .status { margin-top: 16px; font-size: 14px; font-weight: 500; }
    .success { color: #3fb950; }
    .error { color: #f85149; }
  </style>
</head>
<body>
  <div class="card">
    <h1>FinPull Plaid Link</h1>
    <p>Connect your bank or investment account securely to your local FinPull dashboard.</p>
    <button id="link-btn">Connect Bank Account</button>
    <div id="status" class="status"></div>
  </div>

  <script>
    const btn = document.getElementById('link-btn');
    const statusDiv = document.getElementById('status');

    btn.addEventListener('click', async () => {
      statusDiv.textContent = 'Generating secure link token...';
      statusDiv.className = 'status';
      btn.disabled = true;

      try {
        const response = await fetch('/create_link_token', { method: 'POST' });
        const data = await response.json();

        if (!data.link_token) {
          throw new Error(data.error || 'No link token received');
        }

        const handler = Plaid.create({
          token: data.link_token,
          onSuccess: async (public_token, metadata) => {
            statusDiv.textContent = 'Exchanging token with local server...';
            try {
              const exchRes = await fetch('/exchange_public_token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ public_token, metadata })
              });
              const exchData = await exchRes.json();
              if (exchData.success) {
                statusDiv.className = 'status success';
                statusDiv.textContent = 'Connected ' + (metadata.institution ? metadata.institution.name : 'account') + ' successfully! You can close this tab and refresh the extension.';
                btn.textContent = 'Connected!';
              } else {
                throw new Error(exchData.error || 'Failed to exchange token');
              }
            } catch (err) {
              statusDiv.className = 'status error';
              statusDiv.textContent = 'Error: ' + err.message;
            }
          },
          onExit: (err, metadata) => {
            btn.disabled = false;
            if (err) {
              statusDiv.className = 'status error';
              statusDiv.textContent = 'Link exit: ' + err.message;
            } else {
              statusDiv.textContent = 'Link flow closed.';
            }
          }
        });

        handler.open();
      } catch (err) {
        statusDiv.className = 'status error';
        statusDiv.textContent = 'Error: ' + err.message;
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>
  `);
});

// ==========================================
// 5. Start Server
// ==========================================
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 FinPull Local Backend running at http://localhost:${PORT}`);
  console.log(`🔒 Plaid Environment: ${plaidEnv.toUpperCase()}`);
  console.log(`📁 Token Storage: ${TOKENS_FILE}`);
  if (extensionId) {
    console.log(`🛡️  CORS restricted to: chrome-extension://${extensionId}`);
  } else {
    console.log(`ℹ️  CORS: Accepting all chrome-extension:// origins (Local Dev Mode)`);
  }
  console.log(`======================================================\n`);
});
