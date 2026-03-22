const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
require('dotenv').config({ path: '../.env' });
const { prisma } = require('../utils/db');

async function importData(filePath, symbol, timeframe) {
  const ext = path.extname(filePath).toLowerCase();
  let data = [];

  console.log(`Loading dataset from ${filePath}...`);

  if (ext === '.json') {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    data = JSON.parse(fileContent);
    await insertData(data, symbol, timeframe);
  } else if (ext === '.csv') {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        data.push(row);
      })
      .on('end', async () => {
        await insertData(data, symbol, timeframe);
      });
  } else {
    console.error("Unsupported file format. Please provide a .json or .csv file.");
    process.exit(1);
  }
}

async function insertData(data, symbol, timeframe) {
  console.log(`Found ${data.length} records. Starting import...`);
  let imported = 0;

  for (const row of data) {
    try {
      // Find the timestamp key
      const keys = Object.keys(row);
      let timestampRaw = row.timestamp || row.time || row.date || row.Date || row.Timestamp || null;
      if (!timestampRaw) {
         if (row[""]) {
             timestampRaw = row[""];
         } else {
             timestampRaw = row[keys[0]]; // fallback to first column
         }
      }

      const timestamp = new Date(Number(timestampRaw) || timestampRaw);
      
      if (isNaN(timestamp.getTime())) {
          console.log(`Skipping row with invalid date: ${timestampRaw}`);
          continue; // Skip invalid dates
      }

      await prisma.testCandle.upsert({
        where: {
          symbol_timeframe_timestamp: {
            symbol: symbol,
            timeframe: timeframe,
            timestamp: timestamp
          }
        },
        update: {
          open: parseFloat(row.open),
          high: parseFloat(row.high),
          low: parseFloat(row.low),
          close: parseFloat(row.close),
          volume: parseFloat(row.volume || 0),
        },
        create: {
          symbol: symbol,
          timeframe: timeframe,
          timestamp: timestamp,
          open: parseFloat(row.open),
          high: parseFloat(row.high),
          low: parseFloat(row.low),
          close: parseFloat(row.close),
          volume: parseFloat(row.volume || 0),
        }
      });
      imported++;
      if (imported % 1000 === 0) console.log(`Imported ${imported} candles...`);
    } catch (e) {
      console.error(`Error importing row: ${JSON.stringify(row)}`, e.message);
    }
  }

  console.log(`Import complete! Successfully imported ${imported} candles.`);
  await prisma.$disconnect();
}

const args = process.argv.slice(2);
if (args.length < 3) {
  console.log("Usage: node import-dataset.js <path-to-file> <symbol> <timeframe>");
  console.log("Example: node import-dataset.js ./data/btc.csv BTCUSDT 1m");
  process.exit(1);
}

importData(args[0], args[1], args[2]);
