/**
 * FinPull - Chrome Extension Packaging Script
 * 
 * Packages the extension folder into a clean, store-ready ZIP archive:
 * 'finpull-chrome-extension.zip'
 * 
 * Verifies:
 * - Manifest V3 compliance
 * - Icon assets and popup files
 * - Store package root structure (manifest.json at the root of ZIP)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXTENSION_DIR = path.resolve(__dirname, 'extension');
const OUTPUT_ZIP = path.resolve(__dirname, 'finpull-chrome-extension.zip');
const MANIFEST_PATH = path.join(EXTENSION_DIR, 'manifest.json');

console.log('📦 FinPull Chrome Extension Packager');
console.log('====================================');

// 1. Verify extension directory exists
if (!fs.existsSync(EXTENSION_DIR)) {
  console.error('❌ Error: Extension directory not found at:', EXTENSION_DIR);
  process.exit(1);
}

// 2. Validate manifest.json
if (!fs.existsSync(MANIFEST_PATH)) {
  console.error('❌ Error: manifest.json not found at:', MANIFEST_PATH);
  process.exit(1);
}

let manifest;
try {
  const content = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  manifest = JSON.parse(content);
  console.log(`✅ Valid manifest.json found (v${manifest.version})`);
} catch (err) {
  console.error('❌ Error parsing manifest.json:', err.message);
  process.exit(1);
}

// Manifest checks
if (manifest.manifest_version !== 3) {
  console.error('❌ Warning: Expected manifest_version 3, got:', manifest.manifest_version);
}
if (!manifest.description || manifest.description.length > 132) {
  console.warn(`⚠️ Note: Description length is ${manifest.description?.length || 0} chars (recommended <= 132).`);
}

// 3. Verify required files exist
const requiredFiles = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'popup.js',
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png'
];

let missing = false;
for (const relFile of requiredFiles) {
  const fullPath = path.join(EXTENSION_DIR, relFile);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Missing required file: ${relFile}`);
    missing = true;
  }
}
if (missing) {
  process.exit(1);
}
console.log('✅ All essential extension files and icons verified.');

// 4. Remove previous zip if exists
if (fs.existsSync(OUTPUT_ZIP)) {
  try {
    fs.unlinkSync(OUTPUT_ZIP);
    console.log('🗑️  Removed previous zip archive.');
  } catch (err) {
    console.error('❌ Error deleting previous zip:', err.message);
    process.exit(1);
  }
}

// 5. Compress directory into root-level ZIP
console.log(`🗜️  Compressing '${path.basename(EXTENSION_DIR)}/' into '${path.basename(OUTPUT_ZIP)}'...`);

try {
  if (process.platform === 'win32') {
    // Windows PowerShell System.IO.Compression
    const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${EXTENSION_DIR.replace(/'/g, "''")}', '${OUTPUT_ZIP.replace(/'/g, "''")}')"`;
    execSync(psCmd, { stdio: 'inherit' });
  } else {
    // Unix / macOS zip utility
    execSync(`cd "${EXTENSION_DIR}" && zip -r "${OUTPUT_ZIP}" ./*`, { stdio: 'inherit' });
  }
} catch (err) {
  console.error('❌ Compression failed:', err.message);
  process.exit(1);
}

// 6. Verify output zip
if (fs.existsSync(OUTPUT_ZIP)) {
  const stats = fs.statSync(OUTPUT_ZIP);
  const kbSize = (stats.size / 1024).toFixed(1);
  console.log('====================================');
  console.log(`🎉 SUCCESS! Created store-ready zip:`);
  console.log(`📁 File: ${OUTPUT_ZIP}`);
  console.log(`⚖️  Size: ${kbSize} KB`);
  console.log('\n📦 Package Contents (root of zip):');
  
  if (process.platform === 'win32') {
    try {
      const listCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [System.IO.Compression.ZipFile]::OpenRead('${OUTPUT_ZIP.replace(/'/g, "''")}'); foreach ($entry in $z.Entries) { Write-Host ('   - ' + $entry.FullName + ' (' + [math]::Round($entry.Length / 1024, 1) + ' KB)') }; $z.Dispose()"`;
      execSync(listCmd, { stdio: 'inherit' });
    } catch {
      // Non-critical listing failure
    }
  }

  console.log('\nReady for Google Chrome Extension Web Store upload!');
} else {
  console.error('❌ Error: Zip file was not generated.');
  process.exit(1);
}
