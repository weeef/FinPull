/**
 * FinPull - Chrome Extension Popup Logic (Manifest V3)
 * 
 * Communicates ONLY with your local backend server (http://localhost:3000).
 * Never touches the Plaid Secret or makes direct calls to Plaid API.
 */

const SERVER_URL = 'http://localhost:3000';

// State
let appState = {
  isServerOnline: false,
  accounts: [],
  institutions: [],
  transactions: [],
  holdings: [],
  totalBalance: 0,
  totalInvestmentsValue: 0,
  lastUpdated: null,
  activeTab: 'accounts'
};

// DOM Elements
const el = {
  connectionStatus: document.getElementById('connection-status'),
  btnRefresh: document.getElementById('btn-refresh'),
  refreshIcon: document.getElementById('refresh-icon'),
  alertBanner: document.getElementById('alert-banner'),
  alertContent: document.getElementById('alert-content'),
  alertClose: document.getElementById('alert-close'),
  totalBalance: document.getElementById('total-balance'),
  institutionCount: document.getElementById('institution-count'),
  lastUpdated: document.getElementById('last-updated'),
  loadingSpinner: document.getElementById('loading-spinner'),
  loadingText: document.getElementById('loading-text'),
  
  // Tabs
  navTabs: document.querySelectorAll('.nav-tab'),
  tabPanes: document.querySelectorAll('.tab-pane'),
  
  // Containers
  accountsList: document.getElementById('accounts-list'),
  accountsEmpty: document.getElementById('accounts-empty'),
  transactionsList: document.getElementById('transactions-list'),
  transactionsEmpty: document.getElementById('transactions-empty'),
  txCount: document.getElementById('tx-count'),
  totalInvestmentsValue: document.getElementById('total-investments-value'),
  investmentsList: document.getElementById('investments-list'),
  investmentsEmpty: document.getElementById('investments-empty'),
  institutionsList: document.getElementById('institutions-list'),
  
  // Connect buttons
  btnConnectList: document.querySelectorAll('.btn-connect-account')
};

// ==========================================================================
// Initialization & Event Listeners
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkServerAndFetchData();
});

function setupEventListeners() {
  // Tab switching
  el.navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      switchTab(targetTab);
    });
  });

  // Refresh button
  el.btnRefresh.addEventListener('click', () => {
    refreshAllData();
  });

  // Connect bank buttons
  el.btnConnectList.forEach(btn => {
    btn.addEventListener('click', () => {
      startPlaidLinkFlow();
    });
  });

  // Alert dismiss
  el.alertClose.addEventListener('click', () => {
    hideAlert();
  });

  // Auto-refresh when user returns to popup window after connecting in tab
  window.addEventListener('focus', () => {
    if (appState.isServerOnline) {
      refreshAllData();
    }
  });
}

function switchTab(tabId) {
  appState.activeTab = tabId;
  el.navTabs.forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });
  el.tabPanes.forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${tabId}`);
  });
}

// ==========================================
// Plaid Link Flow
// ==========================================

/**
 * Open the dedicated Plaid Link window on the local server.
 * This runs with full browser capabilities (supporting OAuth redirects and storage)
 * without being restricted by the extension sandbox or popup boundaries.
 */
function startPlaidLinkFlow() {
  if (!appState.isServerOnline) {
    showAlert('Cannot connect: Local server is offline. Run "npm start" in the /server folder.', 'error');
    return;
  }

  const linkUrl = `${SERVER_URL}/link`;

  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: linkUrl });
  } else {
    window.open(linkUrl, '_blank');
  }

  showAlert('Opened Plaid Link in a new tab. Connect your account there, then return here!', 'warning');
}

/**
 * Exchange temporary public_token for permanent access_token on local server
 */
async function exchangePublicToken(publicToken, metadata) {
  showLoading('Connecting institution...');

  try {
    const response = await fetch(`${SERVER_URL}/exchange_public_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_token: publicToken,
        metadata: metadata
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to exchange public token');
    }

    showAlert(`Successfully connected to ${data.institutionName || 'bank'}!`, 'success');
    await refreshAllData();
  } catch (error) {
    console.error('Error exchanging public token:', error);
    showAlert(`Exchange error: ${error.message}`, 'error');
  } finally {
    hideLoading();
  }
}

// ==========================================================================
// Server Communication & Data Fetching
// ==========================================================================

/**
 * Check if the local backend server is running and fetch all financial data
 */
async function checkServerAndFetchData() {
  try {
    const res = await fetch(`${SERVER_URL}/health`, { method: 'GET' });
    if (res.ok) {
      const healthData = await res.json();
      appState.isServerOnline = true;
      updateServerStatus(true, `Server Online (${healthData.environment})`);
      
      if (!healthData.hasCredentials) {
        showAlert('Plaid API keys missing! Please configure server/.env with your Plaid credentials.', 'warning');
      }
      
      await refreshAllData();
    } else {
      throw new Error(`Server returned status ${res.status}`);
    }
  } catch (error) {
    appState.isServerOnline = false;
    updateServerStatus(false, 'Local Server Offline');
    showAlert('Local backend offline. Run "npm start" in /server, then click Refresh.', 'error');
    renderAccounts();
    renderTransactions();
    renderInvestments();
    renderInstitutions();
  }
}

/**
 * Refresh accounts, transactions, and investments in parallel
 */
async function refreshAllData() {
  if (!appState.isServerOnline) {
    await checkServerAndFetchData();
    return;
  }

  startRefreshAnimation();
  showLoading('Syncing financial data...');

  try {
    const [accountsRes, txRes, invRes] = await Promise.allSettled([
      fetch(`${SERVER_URL}/accounts`).then(r => r.json()),
      fetch(`${SERVER_URL}/transactions`).then(r => r.json()),
      fetch(`${SERVER_URL}/investments`).then(r => r.json())
    ]);

    // Handle Accounts
    if (accountsRes.status === 'fulfilled' && !accountsRes.value.error) {
      appState.accounts = accountsRes.value.accounts || [];
      appState.institutions = accountsRes.value.institutions || [];
      appState.totalBalance = accountsRes.value.totalBalance || 0;
      
      // Check if any institution requires reconnection
      const needsReconnect = appState.institutions.find(i => i.reconnectRequired);
      if (needsReconnect) {
        showAlert(`Login credentials for ${needsReconnect.institutionName} expired. Please reconnect in Manage tab.`, 'warning');
      }
    }

    // Handle Transactions
    if (txRes.status === 'fulfilled' && !txRes.value.error) {
      appState.transactions = txRes.value.transactions || [];
    }

    // Handle Investments
    if (invRes.status === 'fulfilled' && !invRes.value.error) {
      appState.holdings = invRes.value.holdings || [];
      appState.totalInvestmentsValue = invRes.value.totalInvestmentsValue || 0;
    }

    appState.lastUpdated = new Date();

    // Re-render UI
    renderAll();
  } catch (error) {
    console.error('Error refreshing data:', error);
    showAlert(`Refresh error: ${error.message}`, 'error');
  } finally {
    hideLoading();
    stopRefreshAnimation();
  }
}

/**
 * Disconnect an institution item
 */
async function disconnectAccount(itemId, institutionName) {
  const confirmed = confirm(`Are you sure you want to disconnect ${institutionName}?`);
  if (!confirmed) return;

  showLoading(`Disconnecting ${institutionName}...`);

  try {
    const response = await fetch(`${SERVER_URL}/disconnect_account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to disconnect');
    }

    showAlert(`Successfully removed ${institutionName}.`, 'success');
    await refreshAllData();
  } catch (error) {
    console.error('Error disconnecting account:', error);
    showAlert(`Failed to disconnect: ${error.message}`, 'error');
  } finally {
    hideLoading();
  }
}

// ==========================================================================
// UI Rendering
// ==========================================================================

function renderAll() {
  renderHeaderAndHero();
  renderAccounts();
  renderTransactions();
  renderInvestments();
  renderInstitutions();
}

function renderHeaderAndHero() {
  el.totalBalance.textContent = formatCurrency(appState.totalBalance);
  
  const bankCount = appState.institutions.length;
  el.institutionCount.textContent = `${bankCount} Bank${bankCount === 1 ? '' : 's'} Linked`;

  if (appState.lastUpdated) {
    const timeStr = appState.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.lastUpdated.textContent = `Updated at ${timeStr}`;
  } else {
    el.lastUpdated.textContent = 'Not updated yet';
  }
}

function renderAccounts() {
  el.accountsList.innerHTML = '';
  
  if (appState.accounts.length === 0) {
    el.accountsEmpty.classList.remove('hidden');
    return;
  }
  
  el.accountsEmpty.classList.add('hidden');

  appState.accounts.forEach(acc => {
    const card = document.createElement('div');
    card.className = 'account-card';

    const currentBal = formatCurrency(acc.balances.current, acc.balances.isoCurrencyCode);
    const availableBal = acc.balances.available !== null && acc.balances.available !== acc.balances.current
      ? `Avail: ${formatCurrency(acc.balances.available, acc.balances.isoCurrencyCode)}`
      : '';

    card.innerHTML = `
      <div class="account-info">
        <div class="account-name-row">
          <span class="account-name">${escapeHtml(acc.name)}</span>
          <span class="account-mask">${escapeHtml(acc.mask)}</span>
        </div>
        <div class="account-meta">
          <span>${escapeHtml(acc.institutionName)}</span>
          <span>&bull;</span>
          <span class="type-pill">${escapeHtml(acc.subtype || acc.type)}</span>
        </div>
      </div>
      <div class="account-balance-group">
        <div class="account-balance">${currentBal}</div>
        ${availableBal ? `<div class="account-balance-sub">${availableBal}</div>` : ''}
      </div>
    `;

    el.accountsList.appendChild(card);
  });
}

function renderTransactions() {
  el.transactionsList.innerHTML = '';
  el.txCount.textContent = `${appState.transactions.length} items`;

  if (appState.transactions.length === 0) {
    el.transactionsEmpty.classList.remove('hidden');
    return;
  }

  el.transactionsEmpty.classList.add('hidden');

  appState.transactions.forEach(tx => {
    const item = document.createElement('div');
    item.className = 'tx-item';

    // In Plaid API: positive amounts represent outflow/expenses, negative represent deposits/inflow
    const isExpense = tx.amount > 0;
    const formattedAmount = `${isExpense ? '-' : '+'}${formatCurrency(Math.abs(tx.amount), tx.isoCurrencyCode)}`;
    const amountClass = isExpense ? 'tx-expense' : 'tx-income';
    const txIcon = isExpense ? '🛍️' : '💰';

    item.innerHTML = `
      <div class="tx-icon-col">${txIcon}</div>
      <div class="tx-main">
        <div class="tx-merchant">${escapeHtml(tx.merchantName || tx.name)}</div>
        <div class="tx-meta">
          <span>${formatDate(tx.date)}</span>
          <span>&bull;</span>
          <span class="tx-category">${escapeHtml(tx.category)}</span>
          <span>&bull;</span>
          <span>${escapeHtml(tx.institutionName)}</span>
        </div>
      </div>
      <div class="tx-amount ${amountClass}">${formattedAmount}</div>
    `;

    el.transactionsList.appendChild(item);
  });
}

function renderInvestments() {
  el.investmentsList.innerHTML = '';
  el.totalInvestmentsValue.textContent = formatCurrency(appState.totalInvestmentsValue);

  if (appState.holdings.length === 0) {
    el.investmentsEmpty.classList.remove('hidden');
    return;
  }

  el.investmentsEmpty.classList.add('hidden');

  appState.holdings.forEach(h => {
    const item = document.createElement('div');
    item.className = 'holding-item';

    item.innerHTML = `
      <div class="holding-left">
        <span class="ticker-pill">${escapeHtml(h.tickerSymbol)}</span>
        <span class="security-name" title="${escapeHtml(h.name)}">${escapeHtml(h.name)}</span>
      </div>
      <div class="holding-right">
        <div class="holding-value">${formatCurrency(h.value, h.isoCurrencyCode)}</div>
        <div class="holding-qty">${h.quantity} shares @ ${formatCurrency(h.price)}</div>
      </div>
    `;

    el.investmentsList.appendChild(item);
  });
}

function renderInstitutions() {
  el.institutionsList.innerHTML = '';

  if (appState.institutions.length === 0) {
    el.institutionsList.innerHTML = `
      <p style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 12px 0;">
        No institutions connected yet.
      </p>
    `;
    return;
  }

  appState.institutions.forEach(inst => {
    const row = document.createElement('div');
    row.className = 'institution-row';

    const statusText = inst.reconnectRequired
      ? '<span style="color: var(--accent-amber); font-weight:600;">⚠ Needs Reconnection</span>'
      : `<span style="color: var(--accent-green);">● Connected (${inst.accountCount || 0} accounts)</span>`;

    row.innerHTML = `
      <div>
        <div class="inst-name">${escapeHtml(inst.institutionName)}</div>
        <div class="inst-status">${statusText}</div>
      </div>
      <div class="inst-actions">
        <button class="disconnect-btn" data-item-id="${inst.itemId}" data-name="${escapeHtml(inst.institutionName)}">
          Disconnect
        </button>
      </div>
    `;

    const discBtn = row.querySelector('.disconnect-btn');
    discBtn.addEventListener('click', () => {
      disconnectAccount(inst.itemId, inst.institutionName);
    });

    el.institutionsList.appendChild(row);
  });
}

// ==========================================================================
// Helper Utilities
// ==========================================================================

function updateServerStatus(isOnline, text) {
  el.connectionStatus.className = `status-badge ${isOnline ? 'status-online' : 'status-offline'}`;
  el.connectionStatus.querySelector('.status-text').textContent = text;
}

function formatCurrency(num, currency = 'USD') {
  const n = Number(num) || 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showLoading(msg) {
  el.loadingText.textContent = msg || 'Loading...';
  el.loadingSpinner.classList.remove('hidden');
}

function hideLoading() {
  el.loadingSpinner.classList.add('hidden');
}

function showAlert(msg, type = 'error') {
  el.alertContent.textContent = msg;
  el.alertBanner.className = `alert-banner ${type}`;
  el.alertBanner.classList.remove('hidden');
}

function hideAlert() {
  el.alertBanner.classList.add('hidden');
}

function startRefreshAnimation() {
  el.refreshIcon.classList.add('spin');
}

function stopRefreshAnimation() {
  el.refreshIcon.classList.remove('spin');
}
