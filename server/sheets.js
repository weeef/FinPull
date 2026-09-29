/**
 * FinPull - Google Sheets Sync Engine (Node.js)
 * 
 * Supports both:
 * 1. Google Apps Script Webhook (zero GCP credentials, 1-click script deployment)
 * 2. Google Cloud Service Account API (official Google Sheets v4 API)
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CONFIG_FILE = path.join(__dirname, '.sheets_config.json');
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'service_account.json');
const TEMPLATE_SCRIPT_FILE = path.join(__dirname, 'google_apps_script.js');

/**
 * Default configuration structure
 */
const DEFAULT_CONFIG = {
  activeMethod: 'webhook', // 'webhook' or 'service_account'
  webhookUrl: '',
  serviceAccount: {
    spreadsheetId: '',
    clientEmail: '',
    hasKeyFile: false,
  },
  cellMappings: [],
  snapshot: {
    enabled: true,
    sheetName: 'FinPull_Balances',
    mode: 'replace', // 'replace' or 'append'
  },
  autoPushOnRefresh: false,
  lastPushedAt: null,
  lastPushSummary: null,
};

/**
 * Read sheets configuration from .sheets_config.json
 */
function readConfig() {
  try {
    let config = { ...DEFAULT_CONFIG };
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      config = { ...DEFAULT_CONFIG, ...JSON.parse(data || '{}') };
    }

    // Check service account file status
    if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
      try {
        const saData = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, 'utf8'));
        config.serviceAccount.hasKeyFile = true;
        config.serviceAccount.clientEmail = saData.client_email || '';
      } catch (e) {
        config.serviceAccount.hasKeyFile = false;
      }
    } else {
      config.serviceAccount.hasKeyFile = false;
    }

    return config;
  } catch (error) {
    console.error('[Sheets] Error reading config:', error.message);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write updated configuration
 */
function writeConfig(newConfig) {
  try {
    const current = readConfig();
    const merged = { ...current, ...newConfig };
    // Do not overwrite clientEmail or hasKeyFile with raw client input directly if not intended
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return readConfig();
  } catch (error) {
    console.error('[Sheets] Error writing config:', error.message);
    throw error;
  }
}

/**
 * Read the Apps Script template code
 */
function getTemplateScript() {
  try {
    if (fs.existsSync(TEMPLATE_SCRIPT_FILE)) {
      return fs.readFileSync(TEMPLATE_SCRIPT_FILE, 'utf8');
    }
  } catch (e) {}
  return '// Template not found';
}

/**
 * Extract clean spreadsheet ID from either a raw ID or full Google Sheets URL
 * Example: https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0
 */
function extractSpreadsheetId(input) {
  if (!input) return '';
  const trimmed = String(input).trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

/**
 * ============================================================================
 * METHOD 1: Google Apps Script Webhook
 * ============================================================================
 */

/**
 * Test Webhook connection with a ping action
 */
async function testWebhook(webhookUrl) {
  if (!webhookUrl || !webhookUrl.startsWith('http')) {
    throw new Error('Please enter a valid Webhook URL (must start with https://script.google.com/)');
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'ping' }),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Webhook returned HTTP status ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error('Webhook returned invalid non-JSON response. Ensure your Apps Script is deployed as a Web app with access set to "Anyone".');
  }

  if (data.status === 'error') {
    throw new Error(data.message || 'Webhook reported an error');
  }

  return {
    success: true,
    spreadsheetTitle: data.spreadsheetTitle || 'Google Sheet',
    sheets: data.sheets || [],
    message: data.message || `Successfully connected to ${data.spreadsheetTitle || 'Google Sheet'}!`,
  };
}

/**
 * Push data to Google Apps Script Webhook
 */
async function pushToWebhook(webhookUrl, payload) {
  if (!webhookUrl) {
    throw new Error('No Webhook URL configured');
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Webhook request failed with status ${response.status}`);
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error('Failed to parse Webhook response. Ensure Apps Script is published with "Who has access: Anyone".');
  }

  if (data.status === 'error') {
    throw new Error(data.message || 'Webhook execution failed');
  }

  return data;
}

/**
 * ============================================================================
 * METHOD 2: Google Cloud Service Account (Google Sheets API v4)
 * ============================================================================
 */

function getServiceAccountClient() {
  if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) {
    throw new Error('service_account.json not found on local server. Upload your credentials in Google Sheets settings.');
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * Test Service Account connection by fetching spreadsheet metadata
 */
async function testServiceAccount(spreadsheetInput) {
  const spreadsheetId = extractSpreadsheetId(spreadsheetInput);
  if (!spreadsheetId) {
    throw new Error('Please enter a valid Google Spreadsheet ID or URL');
  }

  const sheets = getServiceAccountClient();
  const response = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetList = (response.data.sheets || []).map(s => s.properties.title);

  return {
    success: true,
    spreadsheetTitle: response.data.properties?.title || 'Google Sheet',
    sheets: sheetList,
    message: `Connected to "${response.data.properties?.title}" successfully!`,
  };
}

/**
 * Push data using Google Sheets API v4
 */
async function pushToServiceAccount(spreadsheetInput, payload) {
  const spreadsheetId = extractSpreadsheetId(spreadsheetInput);
  if (!spreadsheetId) {
    throw new Error('Missing spreadsheet ID');
  }

  const sheets = getServiceAccountClient();
  let cellsUpdated = 0;
  let snapshotUpdated = false;

  // 1. Cell Updates
  if (payload.cellUpdates && payload.cellUpdates.length > 0) {
    const data = payload.cellUpdates.map(u => {
      const range = u.sheet ? `'${u.sheet}'!${u.cell}` : u.cell;
      return {
        range,
        values: [[u.value]],
      };
    });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data,
      },
    });
    cellsUpdated = data.length;
  }

  // 2. Snapshot Table
  if (payload.snapshot && payload.snapshot.enabled && Array.isArray(payload.snapshot.accounts)) {
    const targetSheetName = payload.snapshot.sheetName || 'FinPull_Balances';
    const mode = payload.snapshot.mode || 'replace';
    const accounts = payload.snapshot.accounts;
    const nowStr = new Date().toLocaleString();

    // Check if sheet exists, if not, create it
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheets = (meta.data.sheets || []).map(s => s.properties.title);
    
    if (!existingSheets.includes(targetSheetName)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: targetSheetName },
              },
            },
          ],
        },
      });
    }

    if (mode === 'replace') {
      // Clear sheet
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `'${targetSheetName}'!A1:Z100`,
      });

      const header = [
        ['Institution', 'Account Name', 'Mask', 'Type', 'Subtype', 'Current Balance', 'Available Balance', 'Currency', 'Last Updated'],
      ];

      const rows = accounts.map(acc => [
        acc.institution || '',
        acc.name || '',
        acc.mask || '',
        acc.type || '',
        acc.subtype || '',
        Number(acc.currentBalance) || 0,
        acc.availableBalance !== null && acc.availableBalance !== undefined ? Number(acc.availableBalance) : (Number(acc.currentBalance) || 0),
        acc.currency || 'USD',
        nowStr,
      ]);

      const totalRow = [
        ['Total Net Balance', Number(payload.snapshot.totalNetBalance) || 0],
      ];

      const allRows = [...header, ...rows, ['', ''], ...totalRow];

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${targetSheetName}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: allRows,
        },
      });

      snapshotUpdated = true;
    } else if (mode === 'append') {
      // Append mode
      const appendRows = accounts.map(acc => [
        nowStr,
        acc.institution || '',
        acc.name || '',
        acc.mask || '',
        acc.type || '',
        acc.subtype || '',
        Number(acc.currentBalance) || 0,
        acc.availableBalance !== null && acc.availableBalance !== undefined ? Number(acc.availableBalance) : (Number(acc.currentBalance) || 0),
        acc.currency || 'USD',
        Number(payload.snapshot.totalNetBalance) || 0,
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${targetSheetName}'!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: appendRows,
        },
      });

      snapshotUpdated = true;
    }
  }

  return {
    status: 'success',
    cellsUpdated,
    snapshotUpdated,
    timestamp: new Date().toISOString(),
  };
}

/**
 * ============================================================================
 * HIGH-LEVEL SYNC DISPATCHER
 * ============================================================================
 */

/**
 * Build the payload for sync from configuration and live accounts data
 */
function buildSyncPayload(config, accountsData, investmentsData) {
  const accounts = accountsData?.accounts || [];
  const totalBalance = accountsData?.totalBalance ?? 0;
  const totalInvestments = investmentsData?.totalInvestmentsValue ?? 0;

  // Build account lookup map
  const accountMap = {};
  accounts.forEach(acc => {
    accountMap[acc.id] = acc;
  });

  // Resolve cell updates
  const cellUpdates = [];
  (config.cellMappings || []).forEach(mapping => {
    if (!mapping.targetCell) return;

    let valueToPush = null;
    let label = mapping.sourceLabel || '';

    if (mapping.sourceId === 'TOTAL_NET_BALANCE') {
      valueToPush = totalBalance;
      label = 'Total Net Balance';
    } else if (mapping.sourceId === 'TOTAL_INVESTMENTS_VALUE') {
      valueToPush = totalInvestments;
      label = 'Total Portfolio Value';
    } else {
      const acc = accountMap[mapping.sourceId];
      if (acc) {
        label = `${acc.institutionName} - ${acc.name}`;
        if (mapping.balanceType === 'available' && acc.balances?.available !== null) {
          valueToPush = acc.balances.available;
        } else {
          valueToPush = acc.balances?.current ?? 0;
        }
      }
    }

    if (valueToPush !== null) {
      cellUpdates.push({
        sheet: mapping.targetSheet || '',
        cell: mapping.targetCell,
        value: valueToPush,
        accountName: label,
      });
    }
  });

  // Build snapshot payload
  const snapshotAccounts = accounts.map(acc => ({
    id: acc.id,
    institution: acc.institutionName,
    name: acc.name,
    mask: acc.mask,
    type: acc.type,
    subtype: acc.subtype,
    currentBalance: acc.balances?.current ?? 0,
    availableBalance: acc.balances?.available ?? acc.balances?.current ?? 0,
    currency: acc.balances?.isoCurrencyCode || 'USD',
  }));

  const snapshotConfig = {
    enabled: Boolean(config.snapshot?.enabled),
    sheetName: config.snapshot?.sheetName || 'FinPull_Balances',
    mode: config.snapshot?.mode || 'replace',
    accounts: snapshotAccounts,
    totalNetBalance: totalBalance,
    totalInvestments: totalInvestments,
  };

  return {
    action: 'push',
    cellUpdates,
    snapshot: snapshotConfig,
  };
}

/**
 * Execute push to Google Sheets using the active configuration method
 */
async function executePush(config, accountsData, investmentsData) {
  const method = config.activeMethod || 'webhook';
  const payload = buildSyncPayload(config, accountsData, investmentsData);

  let result;
  if (method === 'service_account') {
    const spreadsheetId = extractSpreadsheetId(config.serviceAccount?.spreadsheetId);
    if (!spreadsheetId) {
      throw new Error('Spreadsheet ID or URL is required for Google Cloud Service Account method');
    }
    result = await pushToServiceAccount(spreadsheetId, payload);
  } else {
    // Webhook method
    if (!config.webhookUrl) {
      throw new Error('Google Apps Script Webhook URL is missing. Set it up in the Google Sheets tab.');
    }
    result = await pushToWebhook(config.webhookUrl, payload);
  }

  // Update last push metadata in config
  const summary = `Updated ${payload.cellUpdates.length} cell(s)${config.snapshot?.enabled ? ' and account snapshot table' : ''}`;
  const now = new Date().toISOString();
  
  writeConfig({
    lastPushedAt: now,
    lastPushSummary: summary,
  });

  return {
    success: true,
    message: `Successfully pushed to Google Sheet! (${summary})`,
    details: {
      cellsCount: payload.cellUpdates.length,
      snapshotUpdated: Boolean(config.snapshot?.enabled),
      method,
      timestamp: now,
    },
  };
}

module.exports = {
  readConfig,
  writeConfig,
  getTemplateScript,
  extractSpreadsheetId,
  testWebhook,
  pushToWebhook,
  testServiceAccount,
  pushToServiceAccount,
  executePush,
  SERVICE_ACCOUNT_FILE,
};
