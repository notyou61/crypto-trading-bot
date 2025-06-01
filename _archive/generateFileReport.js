// generateFileReport.js
import { promises as fs } from 'fs';
import { join } from 'path';

// Configuration
const REPO_PATH = 'C:\\Users\\SteveS\\Documents\\crypto-trading-bot';
const OUTPUT_CSV = join(REPO_PATH, 'file_report.csv');

// Recursive function to get all files
async function getAllFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await getAllFiles(fullPath);
      files.push(...subFiles);
    } else {
      const stats = await fs.stat(fullPath);
      files.push({
        name: entry.name,
        path: fullPath,
        sizeBytes: stats.size,
        modified: stats.mtime.toISOString(),
      });
    }
  }
  return files;
}

// Generate CSV report
async function generateReport() {
  try {
    console.log(`🔍 Scanning repository at ${REPO_PATH}`);
    const files = await getAllFiles(REPO_PATH);

    if (files.length === 0) {
      console.log('⚠️ No files found in the repository.');
      return;
    }

    // Create CSV header
    const csvHeader = 'File Name,Full Path,Size (Bytes),Last Modified\n';
    // Create CSV rows
    const csvRows = files
      .map((file) => `"${file.name.replace(/"/g, '""')}","${file.path.replace(/"/g, '""')}",${file.sizeBytes},"${file.modified}"`)
      .join('\n');

    // Write CSV file
    await fs.writeFile(OUTPUT_CSV, csvHeader + csvRows);
    console.log(`📝 Report generated at ${OUTPUT_CSV} (${files.length} files)`);
  } catch (error) {
    console.error(`❌ Error generating report: ${error.message}`);
  }
}

generateReport();