const sql = require('mssql');
const config = require('./config.json');

let pool = null;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config.db);
  }
  return pool;
}

module.exports = { getPool, sql };
