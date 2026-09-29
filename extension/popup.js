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
  activeTab: 'accounts',
  
  // Google Sheets Sync State
  sheetsConfig: {
    activeMethod: 'webhook',
    webhookUrl: '',
    serviceAccount: {
      spreadsheetId: '',
      clientEmail: '',
      hasKeyFile: false
    },
    cellMappings: [],
    snapshot: {
      enabled: true,
      sheetName: 'FinPull_Balances',
      mode: 'replace'
    },
    autoPushOnRefresh: false,
    lastPushedAt: null,
    lastPushSummary: null
  },
  isPushingSheets: false,
  templateScript: ''
};

// DOM Elements
const el = {
  connectionStatus: document.getElementById('connection-status'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnQuickPush: document.getElementById('btn-quick-push'),
  refreshIcon: document.getElementById('refresh-icon'),
  alertBanner: document.getElementById('alert-banner'),
  alertContent: document.getElementById('alert-content'),
  alertClose: document.getElementById('alert-close'),
  totalBalance: document.getElementById('total-balance'),
  institutionCount: document.getElementById('institution-count'),
  lastUpdated: document.getElementById('last-updated'),
  sheetSyncPill: document.getElementById('sheet-sync-pill'),
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
  btnConnectList: document.querySelectorAll('.btn-connect-account'),

  // Google Sheets Tab Elements
  sheetsBadge: document.getElementById('sheets-connection-badge'),
  btnOpenSheet: document.getElementById('btn-open-sheet'),
  sheetsSyncStatusMsg: document.getElementById('sheets-sync-status-msg'),
  btnPushSheets: document.getElementById('btn-push-sheets'),
  pushBtnSpinner: document.getElementById('push-btn-spinner'),
  pushBtnIcon: document.getElementById('push-btn-icon'),
  pushBtnText: document.getElementById('push-btn-text'),
  methodToggleBtns: document.querySelectorAll('.method-toggle-btn'),
  methodPanelWebhook: document.getElementById('method-panel-webhook'),
  methodPanelSa: document.getElementById('method-panel-service-account'),
  sheetsWebhookUrl: document.getElementById('sheets-webhook-url'),
  btnCopyScript: document.getElementById('btn-copy-script'),
  copyScriptText: document.getElementById('copy-script-text'),
  sheetsSpreadsheetId: document.getElementById('sheets-spreadsheet-id'),
  saStatusInfo: document.getElementById('sa-status-info'),
  saStatusText: document.getElementById('sa-status-text'),
  sheetsSaKeyInput: document.getElementById('sheets-sa-key-input'),
  btnSaveSaKey: document.getElementById('btn-save-sa-key'),
  btnTestSheetsConn: document.getElementById('btn-test-sheets-conn'),
  btnSaveSheetsConfig: document.getElementById('btn-save-sheets-config'),
  cellMappingsList: document.getElementById('cell-mappings-list'),
  cellMappingsEmpty: document.getElementById('cell-mappings-empty'),
  mappingBadgeCount: document.getElementById('mapping-badge-count'),
  mapAccountSelect: document.getElementById('map-account-select'),
  mapBalanceType: document.getElementById('map-balance-type'),
  mapTargetSheet: document.getElementById('map-target-sheet'),
  mapTargetCell: document.getElementById('map-target-cell'),
  btnAddMapping: document.getElementById('btn-add-mapping'),
  snapshotEnabled: document.getElementById('snapshot-enabled'),
  snapshotSheetName: document.getElementById('snapshot-sheet-name'),
  snapshotMode: document.getElementById('snapshot-mode'),
  sheetsAutoPush: document.getElementById('sheets-auto-push')
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

  // Quick Push to Sheets button in header
  if (el.btnQuickPush) {
    el.btnQuickPush.addEventListener('click', () => {
      if (!isSheetsConfigured()) {
        switchTab('sheets');
        showAlert('Please configure your Google Sheet settings first.', 'warning');
      } else {
        pushToGoogleSheets();
      }
    });
  }

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

  // Auto-refresh when user returns to popup window
  window.addEventListener('focus', () => {
    if (appState.isServerOnline) {
      refreshAllData();
    }
  });

  // --- Google Sheets Event Listeners ---
  if (el.btnPushSheets) {
    el.btnPushSheets.addEventListener('click', () => {
      pushToGoogleSheets();
    });
  }

  if (el.btnOpenSheet) {
    el.btnOpenSheet.addEventListener('click', () => {
      openGoogleSheetTab();
    });
  }

  // Method toggle (Webhook vs Service Account)
  el.methodToggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const method = btn.dataset.method;
      switchMethod(method);
    });
  });

  // Copy Apps Script code button
  if (el.btnCopyScript) {
    el.btnCopyScript.addEventListener('click', () => {
      copyAppsScriptToClipboard();
    });
  }

  // Save Service Account Key
  if (el.btnSaveSaKey) {
    el.btnSaveSaKey.addEventListener('click', () => {
      saveServiceAccountKey();
    });
  }

  // Test Sheets Connection
  if (el.btnTestSheetsConn) {
    el.btnTestSheetsConn.addEventListener('click', () => {
      testSheetsConnection();
    });
  }

  // Save Sheets Config
  if (el.btnSaveSheetsConfig) {
    el.btnSaveSheetsConfig.addEventListener('click', () => {
      saveSheetsConfig(true);
    });
  }

  // Add Cell Mapping
  if (el.btnAddMapping) {
    el.btnAddMapping.addEventListener('click', () => {
      addCellMapping();
    });
  }

  // Auto Push Checkbox
  if (el.sheetsAutoPush) {
    el.sheetsAutoPush.addEventListener('change', (e) => {
      appState.sheetsConfig.autoPushOnRefresh = e.target.checked;
      saveSheetsConfig(false);
    });
  }

  // Snapshot Enabled Checkbox
  if (el.snapshotEnabled) {
    el.snapshotEnabled.addEventListener('change', (e) => {
      appState.sheetsConfig.snapshot.enabled = e.target.checked;
      const optionsPanel = document.getElementById('snapshot-options-panel');
      if (optionsPanel) {
        optionsPanel.style.opacity = e.target.checked ? '1' : '0.4';
      }
      saveSheetsConfig(false);
    });
  }
}

function switchTab(tabId) {
  appState.activeTab = tabId;
  el.navTabs.forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });
  el.tabPanes.forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${tabId}`);
  });

  if (tabId === 'sheets') {
    populateMappingAccountDropdown();
    renderCellMappings();
  }
}

// ==========================================
// Plaid Link Flow
// ==========================================

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

// ==========================================================================
// Server Communication & Data Fetching
// ==========================================================================

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
      
      await loadSheetsConfig();
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
    renderSheetsTab();
  }
}

async function refreshAllData() {
  if (!appState.isServerOnline) {
    await checkServerAndFetchData();
    return;
  }

  startRefreshAnimation();
  showLoading('Syncing financial data...');

  try {
    const [accountsRes, txRes, invRes, sheetsRes] = await Promise.allSettled([
      fetch(`${SERVER_URL}/accounts`).then(r => r.json()),
      fetch(`${SERVER_URL}/transactions`).then(r => r.json()),
      fetch(`${SERVER_URL}/investments`).then(r => r.json()),
      fetch(`${SERVER_URL}/sheets/config`).then(r => r.json())
    ]);

    // Handle Accounts
    if (accountsRes.status === 'fulfilled' && !accountsRes.value.error) {
      appState.accounts = accountsRes.value.accounts || [];
      appState.institutions = accountsRes.value.institutions || [];
      appState.totalBalance = accountsRes.value.totalBalance || 0;
      
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

    // Handle Sheets Config
    if (sheetsRes.status === 'fulfilled' && !sheetsRes.value.error) {
      appState.sheetsConfig = { ...appState.sheetsConfig, ...sheetsRes.value };
    }

    appState.lastUpdated = new Date();

    // Re-render UI
    renderAll();

    // Auto-push to sheets if configured and enabled
    if (appState.sheetsConfig.autoPushOnRefresh && isSheetsConfigured()) {
      pushToGoogleSheets(true);
    }
  } catch (error) {
    console.error('Error refreshing data:', error);
    showAlert(`Refresh error: ${error.message}`, 'error');
  } finally {
    hideLoading();
    stopRefreshAnimation();
  }
}

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
// Google Sheets Integration Logic
// ==========================================================================

async function loadSheetsConfig() {
  try {
    const res = await fetch(`${SERVER_URL}/sheets/config`);
    if (res.ok) {
      const config = await res.json();
      appState.sheetsConfig = { ...appState.sheetsConfig, ...config };
      renderSheetsTab();
    }
  } catch (err) {
    console.warn('[Sheets] Could not load config:', err.message);
  }
}

function isSheetsConfigured() {
  const cfg = appState.sheetsConfig;
  if (cfg.activeMethod === 'service_account') {
    return Boolean(cfg.serviceAccount?.spreadsheetId && cfg.serviceAccount?.hasKeyFile);
  }
  return Boolean(cfg.webhookUrl && cfg.webhookUrl.startsWith('http'));
}

function switchMethod(method) {
  appState.sheetsConfig.activeMethod = method;
  el.methodToggleBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.method === method);
  });

  if (method === 'webhook') {
    el.methodPanelWebhook.classList.remove('hidden');
    el.methodPanelSa.classList.add('hidden');
  } else {
    el.methodPanelWebhook.classList.add('hidden');
    el.methodPanelSa.classList.remove('hidden');
  }

  updateSheetsStatusBadge();
}

function renderSheetsTab() {
  const cfg = appState.sheetsConfig;
  switchMethod(cfg.activeMethod || 'webhook');

  // Fill Webhook fields
  if (el.sheetsWebhookUrl) el.sheetsWebhookUrl.value = cfg.webhookUrl || '';

  // Fill Service Account fields
  if (el.sheetsSpreadsheetId) el.sheetsSpreadsheetId.value = cfg.serviceAccount?.spreadsheetId || '';
  if (el.saStatusText) {
    if (cfg.serviceAccount?.hasKeyFile && cfg.serviceAccount?.clientEmail) {
      el.saStatusText.innerHTML = `✅ Key active: <code style="color:#93c5fd;">${escapeHtml(cfg.serviceAccount.clientEmail)}</code><br><span style="font-size:10px; color:#9ca3af;">(Ensure your Google Sheet is shared with this email as Editor)</span>`;
    } else {
      el.saStatusText.textContent = '⚠️ No service_account.json key configured yet.';
    }
  }

  // Snapshot fields
  if (el.snapshotEnabled) el.snapshotEnabled.checked = Boolean(cfg.snapshot?.enabled);
  if (el.snapshotSheetName) el.snapshotSheetName.value = cfg.snapshot?.sheetName || 'FinPull_Balances';
  if (el.snapshotMode) el.snapshotMode.value = cfg.snapshot?.mode || 'replace';
  if (el.sheetsAutoPush) el.sheetsAutoPush.checked = Boolean(cfg.autoPushOnRefresh);

  updateSheetsStatusBadge();
  populateMappingAccountDropdown();
  renderCellMappings();
}

function updateSheetsStatusBadge() {
  const configured = isSheetsConfigured();
  const cfg = appState.sheetsConfig;

  if (configured) {
    el.sheetsBadge.className = 'sheets-badge badge-connected';
    el.sheetsBadge.textContent = cfg.activeMethod === 'service_account' ? 'Service Account Ready' : 'Webhook Ready';
    
    if (cfg.lastPushedAt) {
      const timeStr = new Date(cfg.lastPushedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      el.sheetsSyncStatusMsg.textContent = `Last pushed at ${timeStr}. ${cfg.lastPushSummary || ''}`;
      el.sheetSyncPill.classList.remove('hidden');
      el.sheetSyncPill.textContent = `Sheet: ${timeStr}`;
    } else {
      el.sheetsSyncStatusMsg.textContent = 'Ready to push live numbers to your Google Sheet.';
      el.sheetSyncPill.classList.remove('hidden');
      el.sheetSyncPill.textContent = 'Sheet: Ready';
    }

    if (el.btnOpenSheet) {
      el.btnOpenSheet.disabled = !getSpreadsheetUrl();
    }
  } else {
    el.sheetsBadge.className = 'sheets-badge badge-unconfigured';
    el.sheetsBadge.textContent = 'Setup Required';
    el.sheetsSyncStatusMsg.textContent = cfg.activeMethod === 'webhook' 
      ? 'Paste your Google Apps Script Web App URL below to begin pushing numbers.' 
      : 'Enter your Spreadsheet ID and upload your Service Account JSON key.';
    el.sheetSyncPill.classList.add('hidden');
    if (el.btnOpenSheet) el.btnOpenSheet.disabled = true;
  }
}

function getSpreadsheetUrl() {
  const cfg = appState.sheetsConfig;
  if (cfg.serviceAccount?.spreadsheetId) {
    const id = cfg.serviceAccount.spreadsheetId;
    return id.startsWith('http') ? id : `https://docs.google.com/spreadsheets/d/${id}/edit`;
  }
  return null;
}

function openGoogleSheetTab() {
  const url = getSpreadsheetUrl();
  if (url) {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
  } else {
    showAlert('No Google Sheet URL available. Open it directly in your browser.', 'info');
  }
}

async function copyAppsScriptToClipboard() {
  try {
    let scriptCode = appState.templateScript;
    if (!scriptCode) {
      const res = await fetch(`${SERVER_URL}/sheets/template_script`);
      if (res.ok) {
        const data = await res.json();
        scriptCode = data.script;
        appState.templateScript = scriptCode;
      }
    }

    if (!scriptCode) {
      throw new Error('Script template not found');
    }

    await navigator.clipboard.writeText(scriptCode);
    el.copyScriptText.textContent = 'Copied to Clipboard! 🎉';
    setTimeout(() => {
      el.copyScriptText.textContent = 'Copy Apps Script Code';
    }, 2500);
  } catch (err) {
    console.error('Clipboard copy error:', err);
    showAlert('Could not copy automatically. You can copy it from server/google_apps_script.js.', 'warning');
  }
}

async function saveServiceAccountKey() {
  const rawKey = el.sheetsSaKeyInput.value.trim();
  if (!rawKey) {
    showAlert('Please paste your service_account.json key content into the box.', 'warning');
    return;
  }

  showLoading('Saving service account key...');
  try {
    const res = await fetch(`${SERVER_URL}/sheets/service_account_key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyData: rawKey })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to save key');
    }

    showAlert(`Service account key saved for ${data.clientEmail}!`, 'success');
    el.sheetsSaKeyInput.value = '';
    await loadSheetsConfig();
  } catch (err) {
    showAlert(`Key error: ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
}

async function saveSheetsConfig(showToast = false) {
  const cfg = {
    activeMethod: appState.sheetsConfig.activeMethod,
    webhookUrl: el.sheetsWebhookUrl.value.trim(),
    serviceAccount: {
      ...appState.sheetsConfig.serviceAccount,
      spreadsheetId: el.sheetsSpreadsheetId.value.trim()
    },
    cellMappings: appState.sheetsConfig.cellMappings,
    snapshot: {
      enabled: el.snapshotEnabled.checked,
      sheetName: el.snapshotSheetName.value.trim() || 'FinPull_Balances',
      mode: el.snapshotMode.value
    },
    autoPushOnRefresh: el.sheetsAutoPush.checked
  };

  try {
    const res = await fetch(`${SERVER_URL}/sheets/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    });
    const data = await res.json();
    if (res.ok && data.success) {
      appState.sheetsConfig = data.config;
      updateSheetsStatusBadge();
      if (showToast) {
        showAlert('Google Sheets configuration saved successfully!', 'success');
      }
    }
  } catch (err) {
    console.error('Error saving config:', err);
    if (showToast) showAlert(`Failed to save config: ${err.message}`, 'error');
  }
}

async function testSheetsConnection() {
  await saveSheetsConfig(false);

  const cfg = appState.sheetsConfig;
  showLoading('Testing Google Sheets connection...');

  try {
    const res = await fetch(`${SERVER_URL}/sheets/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: cfg.activeMethod,
        webhookUrl: cfg.webhookUrl,
        spreadsheetId: cfg.serviceAccount?.spreadsheetId
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Connection failed');
    }

    const title = data.spreadsheetTitle || 'Google Sheet';
    showAlert(`🎉 Verified! Connected to "${title}" successfully.`, 'success');
    updateSheetsStatusBadge();
  } catch (err) {
    console.error('Test error:', err);
    showAlert(`Connection test failed: ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
}

function populateMappingAccountDropdown() {
  const select = el.mapAccountSelect;
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = `
    <option value="">-- Select Source Account --</option>
    <option value="TOTAL_NET_BALANCE">💰 Total Net Balance (${formatCurrency(appState.totalBalance)})</option>
    <option value="TOTAL_INVESTMENTS_VALUE">📈 Total Investments (${formatCurrency(appState.totalInvestmentsValue)})</option>
  `;

  if (appState.accounts.length > 0) {
    const optGroup = document.createElement('optgroup');
    optGroup.label = 'Bank & Credit Accounts';

    appState.accounts.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = `${acc.institutionName} - ${acc.name} (${acc.mask}) [${formatCurrency(acc.balances.current)}]`;
      optGroup.appendChild(opt);
    });

    select.appendChild(optGroup);
  }

  select.value = currentVal;
}

function renderCellMappings() {
  const container = el.cellMappingsList;
  const emptyState = el.cellMappingsEmpty;
  const badgeCount = el.mappingBadgeCount;
  const mappings = appState.sheetsConfig.cellMappings || [];

  badgeCount.textContent = `${mappings.length} mapped`;
  container.innerHTML = '';

  if (mappings.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  mappings.forEach(m => {
    const card = document.createElement('div');
    card.className = 'mapping-card';

    // Calculate live value preview
    let liveVal = 0;
    if (m.sourceId === 'TOTAL_NET_BALANCE') {
      liveVal = appState.totalBalance;
    } else if (m.sourceId === 'TOTAL_INVESTMENTS_VALUE') {
      liveVal = appState.totalInvestmentsValue;
    } else {
      const acc = appState.accounts.find(a => a.id === m.sourceId);
      if (acc) {
        liveVal = m.balanceType === 'available' ? (acc.balances.available ?? acc.balances.current) : acc.balances.current;
      }
    }

    const targetDisplay = m.targetSheet ? `${escapeHtml(m.targetSheet)}!${escapeHtml(m.targetCell)}` : escapeHtml(m.targetCell);

    card.innerHTML = `
      <div class="mapping-source-col">
        <span class="mapping-source-name">${escapeHtml(m.sourceLabel)}</span>
        <span class="mapping-source-val">${m.balanceType === 'available' ? 'Avail' : 'Current'}: ${formatCurrency(liveVal)}</span>
      </div>
      <div class="mapping-arrow-col">➔</div>
      <div class="mapping-target-col">
        <span class="mapping-cell-pill">${targetDisplay}</span>
        <button class="btn-del-mapping" data-id="${m.id}" title="Remove mapping">&times;</button>
      </div>
    `;

    card.querySelector('.btn-del-mapping').addEventListener('click', () => {
      deleteCellMapping(m.id);
    });

    container.appendChild(card);
  });
}

function addCellMapping() {
  const accountId = el.mapAccountSelect.value;
  const balanceType = el.mapBalanceType.value;
  const targetSheet = el.mapTargetSheet.value.trim();
  const targetCell = el.mapTargetCell.value.trim().toUpperCase();

  if (!accountId) {
    showAlert('Please select an account or balance to map.', 'warning');
    return;
  }
  if (!targetCell) {
    showAlert('Please enter a target cell (e.g. B5 or C12).', 'warning');
    return;
  }

  // Derive source label
  let sourceLabel = '';
  if (accountId === 'TOTAL_NET_BALANCE') {
    sourceLabel = 'Total Net Balance';
  } else if (accountId === 'TOTAL_INVESTMENTS_VALUE') {
    sourceLabel = 'Total Investments';
  } else {
    const acc = appState.accounts.find(a => a.id === accountId);
    sourceLabel = acc ? `${acc.institutionName} - ${acc.name} (${acc.mask})` : 'Account';
  }

  const newMapping = {
    id: 'map_' + Date.now(),
    sourceId: accountId,
    sourceLabel: sourceLabel,
    balanceType: balanceType,
    targetSheet: targetSheet,
    targetCell: targetCell
  };

  appState.sheetsConfig.cellMappings = appState.sheetsConfig.cellMappings || [];
  appState.sheetsConfig.cellMappings.push(newMapping);

  // Clear input
  el.mapTargetCell.value = '';

  renderCellMappings();
  saveSheetsConfig(false);
  showAlert(`Mapped "${sourceLabel}" to ${targetSheet ? targetSheet + '!' : ''}${targetCell}!`, 'success');
}

function deleteCellMapping(id) {
  appState.sheetsConfig.cellMappings = (appState.sheetsConfig.cellMappings || []).filter(m => m.id !== id);
  renderCellMappings();
  saveSheetsConfig(false);
}

/**
 * Pushes live balances to Google Sheet
 */
async function pushToGoogleSheets(isBackground = false) {
  if (appState.isPushingSheets) return;

  if (!isSheetsConfigured()) {
    switchTab('sheets');
    showAlert('Please configure your Google Sheet settings first.', 'warning');
    return;
  }

  appState.isPushingSheets = true;
  setPushLoadingState(true);

  if (!isBackground) {
    showLoading('Pushing bank balances to Google Sheet...');
  }

  try {
    const payload = {
      accountsData: {
        totalBalance: appState.totalBalance,
        accounts: appState.accounts
      },
      investmentsData: {
        totalInvestmentsValue: appState.totalInvestmentsValue,
        holdings: appState.holdings
      }
    };

    const res = await fetch(`${SERVER_URL}/sheets/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to push to Google Sheet');
    }

    const now = new Date();
    appState.sheetsConfig.lastPushedAt = now.toISOString();
    appState.sheetsConfig.lastPushSummary = data.message;
    updateSheetsStatusBadge();

    const count = data.details?.cellsCount || 0;
    const msg = `🎉 Pushed ${count} cell balance${count === 1 ? '' : 's'}${data.details?.snapshotUpdated ? ' & snapshot table' : ''} to Google Sheet!`;
    showAlert(msg, 'success');
  } catch (err) {
    console.error('Push error:', err);
    showAlert(`Google Sheets push failed: ${err.message}`, 'error');
  } finally {
    appState.isPushingSheets = false;
    setPushLoadingState(false);
    if (!isBackground) hideLoading();
  }
}

function setPushLoadingState(isLoading) {
  if (el.pushBtnSpinner) {
    el.pushBtnSpinner.classList.toggle('hidden', !isLoading);
  }
  if (el.pushBtnIcon) {
    el.pushBtnIcon.classList.toggle('hidden', isLoading);
  }
  if (el.pushBtnText) {
    el.pushBtnText.textContent = isLoading ? 'Pushing to Sheet...' : 'Push Numbers to Google Sheet';
  }
  if (el.btnPushSheets) {
    el.btnPushSheets.disabled = isLoading;
  }
  if (el.btnQuickPush) {
    el.btnQuickPush.classList.toggle('spin', isLoading);
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
  renderSheetsTab();
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
