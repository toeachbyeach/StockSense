const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, 'data', 'scraper.log');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

function log(message, level = 'INFO') {
  const now = new Date();
  const localTs = now.toLocaleString();
  const isoTs = now.toISOString();
  const timestamp = `${localTs} (${isoTs})`;
  const logLine = `[${timestamp}] [${level}] ${message}`;
  
  // Log to console
  if (level === 'ERROR') {
    console.error(logLine);
  } else {
    console.log(logLine);
  }
  
  // Append to file
  try {
    fs.appendFileSync(logFilePath, logLine + '\n');
    
    // Rotate logs if too large (keep last ~500 lines to prevent bloat)
    const stats = fs.statSync(logFilePath);
    if (stats.size > 1024 * 1024) { // 1MB
      const contents = fs.readFileSync(logFilePath, 'utf8').split('\n');
      const tail = contents.slice(-500).join('\n');
      fs.writeFileSync(logFilePath, tail + '\n');
    }
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

module.exports = log;
