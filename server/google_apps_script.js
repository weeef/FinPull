/**
 * ============================================================================
 * FinPull - Google Sheets Sync Webhook Script
 * ============================================================================
 * 
 * This Apps Script allows FinPull to push your real-time bank account numbers,
 * credit balances, and net worth directly into your Google Sheet budget.
 * 
 * --- 1-MINUTE SETUP INSTRUCTIONS ---
 * 1. Open your Google Sheet budget (or create a new Google Sheet).
 * 2. In the top menu, click: Extensions > Apps Script.
 * 3. Delete any code in the editor, and paste this entire script.
 * 4. Click the Save icon (💾).
 * 5. Click the blue "Deploy" button (top-right) > "New deployment".
 * 6. Click the gear icon next to "Select type" and choose "Web app".
 * 7. Set configuration:
 *    - Description: "FinPull Sync"
 *    - Execute as: "Me" (your Google account)
 *    - Who has access: "Anyone"
 * 8. Click "Deploy".
 * 9. Click "Authorize access", sign in with your Google account, and click
 *    "Advanced" > "Go to FinPull Sync (unsafe)" > "Allow".
 * 10. Copy the "Web app URL" (starts with https://script.google.com/macros/s/...)
 * 11. Paste this URL into FinPull's Google Sheets tab and click "Test Connection"!
 * ============================================================================
 */

function doPost(e) {
  try {
    var rawData = e.postData ? e.postData.contents : null;
    if (!rawData) {
      return ContentService.createTextOutput(JSON.stringify({ 
        status: 'error', 
        message: 'No payload received in POST body' 
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var payload = JSON.parse(rawData);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. Health / Connection Ping Check
    if (payload.action === 'ping') {
      var sheetNames = ss.getSheets().map(function(s) { return s.getName(); });
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        spreadsheetTitle: ss.getName(),
        sheets: sheetNames,
        message: 'Connected to "' + ss.getName() + '" successfully!'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var results = {
      status: 'success',
      spreadsheetTitle: ss.getName(),
      cellsUpdated: 0,
      snapshotUpdated: false,
      timestamp: new Date().toISOString()
    };

    // 2. Flexible Cell Updates (Budget Cell Mappings)
    if (payload.cellUpdates && Array.isArray(payload.cellUpdates) && payload.cellUpdates.length > 0) {
      payload.cellUpdates.forEach(function(update) {
        if (!update.cell) return;

        var targetSheet;
        if (update.sheet && String(update.sheet).trim() !== '') {
          targetSheet = ss.getSheetByName(String(update.sheet).trim());
          if (!targetSheet) {
            targetSheet = ss.insertSheet(String(update.sheet).trim());
          }
        } else {
          targetSheet = ss.getActiveSheet() || ss.getSheets()[0];
        }

        if (targetSheet) {
          var cleanCell = String(update.cell).trim().toUpperCase();
          var range = targetSheet.getRange(cleanCell);
          var val = update.value;

          // If numeric, write as number
          if (typeof val === 'number') {
            range.setValue(val);
          } else if (!isNaN(Number(val)) && val !== '' && val !== null) {
            range.setValue(Number(val));
          } else {
            range.setValue(val);
          }
          results.cellsUpdated++;
        }
      });
    }

    // 3. Balance Snapshot Table
    if (payload.snapshot && payload.snapshot.enabled && Array.isArray(payload.snapshot.accounts)) {
      var sheetName = payload.snapshot.sheetName || 'FinPull_Balances';
      var snapshotSheet = ss.getSheetByName(sheetName);
      if (!snapshotSheet) {
        snapshotSheet = ss.insertSheet(sheetName);
      }

      var mode = payload.snapshot.mode || 'replace'; // 'replace' or 'append'
      var accounts = payload.snapshot.accounts;
      var now = new Date();
      var dateStr = Utilities.formatDate(now, Session.getScriptTimeZone() || 'GMT', 'yyyy-MM-dd HH:mm:ss');

      if (mode === 'replace') {
        // Clear old content
        snapshotSheet.clear();

        // Header
        var header = [
          ['Institution', 'Account Name', 'Mask', 'Type', 'Subtype', 'Current Balance', 'Available Balance', 'Currency', 'Last Updated']
        ];
        snapshotSheet.getRange(1, 1, 1, header[0].length).setValues(header);
        
        // Header Styling
        var headerRange = snapshotSheet.getRange(1, 1, 1, header[0].length);
        headerRange.setFontWeight('bold');
        headerRange.setBackground('#0f172a');
        headerRange.setFontColor('#f8fafc');

        var rows = accounts.map(function(acc) {
          var curVal = Number(acc.currentBalance) || 0;
          var availVal = (acc.availableBalance !== null && acc.availableBalance !== undefined) 
            ? Number(acc.availableBalance) 
            : curVal;
          return [
            acc.institution || '',
            acc.name || '',
            acc.mask || '',
            acc.type || '',
            acc.subtype || '',
            curVal,
            availVal,
            acc.currency || 'USD',
            dateStr
          ];
        });

        if (rows.length > 0) {
          snapshotSheet.getRange(2, 1, rows.length, header[0].length).setValues(rows);
          // Format Current & Available balance columns as currency
          snapshotSheet.getRange(2, 6, rows.length, 2).setNumberFormat('$#,##0.00');
        }

        // Summary Net Balance Row
        var summaryRowIndex = rows.length + 3;
        snapshotSheet.getRange(summaryRowIndex, 1, 1, 2).setValues([
          ['Total Net Balance', Number(payload.snapshot.totalNetBalance) || 0]
        ]);
        var summaryRange = snapshotSheet.getRange(summaryRowIndex, 1, 1, 2);
        summaryRange.setFontWeight('bold');
        summaryRange.setBackground('#e2e8f0');
        snapshotSheet.getRange(summaryRowIndex, 2).setNumberFormat('$#,##0.00');

        // Auto-fit column widths
        for (var i = 1; i <= header[0].length; i++) {
          snapshotSheet.autoResizeColumn(i);
        }

        results.snapshotUpdated = true;
      } else if (mode === 'append') {
        // Append mode: Keep a running historical log of balances
        if (snapshotSheet.getLastRow() === 0) {
          var header = [
            ['Timestamp', 'Institution', 'Account Name', 'Mask', 'Type', 'Subtype', 'Current Balance', 'Available Balance', 'Currency', 'Total Net Balance']
          ];
          var headerRange = snapshotSheet.getRange(1, 1, 1, header[0].length);
          headerRange.setValues(header);
          headerRange.setFontWeight('bold');
          headerRange.setBackground('#0f172a');
          headerRange.setFontColor('#f8fafc');
        }

        var appendRows = accounts.map(function(acc) {
          var curVal = Number(acc.currentBalance) || 0;
          var availVal = (acc.availableBalance !== null && acc.availableBalance !== undefined) 
            ? Number(acc.availableBalance) 
            : curVal;
          return [
            dateStr,
            acc.institution || '',
            acc.name || '',
            acc.mask || '',
            acc.type || '',
            acc.subtype || '',
            curVal,
            availVal,
            acc.currency || 'USD',
            Number(payload.snapshot.totalNetBalance) || 0
          ];
        });

        if (appendRows.length > 0) {
          var startRow = snapshotSheet.getLastRow() + 1;
          snapshotSheet.getRange(startRow, 1, appendRows.length, 10).setValues(appendRows);
          snapshotSheet.getRange(startRow, 7, appendRows.length, 2).setNumberFormat('$#,##0.00');
          snapshotSheet.getRange(startRow, 10, appendRows.length, 1).setNumberFormat('$#,##0.00');
        }

        results.snapshotUpdated = true;
      }
    }

    return ContentService.createTextOutput(JSON.stringify(results))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'online',
    service: 'FinPull Google Sheets Sync Webhook',
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}
