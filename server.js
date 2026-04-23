const express = require('express');
const { getPool, sql } = require('./db');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return dt.getFullYear() + '/' +
    String(dt.getMonth() + 1).padStart(2, '0') + '/' +
    String(dt.getDate()).padStart(2, '0');
}
function parseDate(s) {
  if (!s || String(s).trim() === '') return null;
  const d = new Date(String(s).replace(/\//g, '-'));
  return isNaN(d.getTime()) ? null : d;
}
function rmaDateCode(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (match) {
    return match[1].slice(-2) +
      match[2].padStart(2, '0') +
      match[3].padStart(2, '0');
  }
  const dt = value instanceof Date && !isNaN(value) ? value : new Date();
  return String(dt.getFullYear()).slice(-2) +
    String(dt.getMonth() + 1).padStart(2, '0') +
    String(dt.getDate()).padStart(2, '0');
}
async function getNextRMANo(request, issueDate) {
  const prefix = `TR-R${rmaDateCode(issueDate)}`;
  const result = await request
    .input('rmaPrefix', sql.NVarChar, `${prefix}-%`)
    .query(`
      SELECT ISNULL(MAX(
        CASE
          WHEN RIGHT(RMANo, 2) NOT LIKE '%[^0-9]%' THEN CAST(RIGHT(RMANo, 2) AS INT)
          ELSE 0
        END
      ), 0) + 1 AS NextSeq
      FROM HWRMA
      WHERE RMANo LIKE @rmaPrefix
    `);
  const nextSeq = String(result.recordset[0].NextSeq).padStart(2, '0');
  return `${prefix}-${nextSeq}`;
}
function fmtDateRow(row, fields) {
  fields.forEach(f => { if (row[f] !== undefined) row[f] = fmtDate(row[f]); });
  return row;
}

async function withSerializable(pool, fn) {
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const result = await fn(transaction);
    await transaction.commit();
    return result;
  } catch (e) {
    try {
      await transaction.rollback();
    } catch (_) {
      // rollback failed (server already aborted); ignore
    }
    throw e;
  }
}

// ─── CUSTOMER ─────────────────────────────────────────────────────────────────
app.get('/api/customers', async (req, res) => {
  try {
    const pool = await getPool();
    const { name, phone } = req.query;
    let query = `SELECT Phone_num, Cust_Name, Contact_Person, Phone2, EMail, City, Industry FROM Customer`;
    const request = pool.request();
    const conds = [];
    if (name) {
      conds.push('(Cust_Name LIKE @name OR Contact_Person LIKE @name)');
      request.input('name', sql.NVarChar, `%${name}%`);
    }
    if (phone) {
      conds.push('(Phone_num LIKE @phone OR Phone2 LIKE @phone OR Fax LIKE @phone OR CAST(InstallationSummary AS NVARCHAR(MAX)) LIKE @phone)');
      request.input('phone', sql.NVarChar, `%${phone}%`);
    }
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY Cust_Name';
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/customers/:phone', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('phone', sql.VarChar, req.params.phone)
      .query('SELECT * FROM Customer WHERE Phone_num=@phone');
    if (!result.recordset.length) return res.status(404).json({ error: 'Not found' });
    const row = result.recordset[0];
    fmtDateRow(row, ['Installation_Date','Last_Modified_Date','Warranty_Expiry_DateHW','Warranty_Expiry_DateSF']);
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/customers', async (req, res) => {
  try {
    const pool = await getPool();
    const d = req.body;
    await pool.request()
      .input('Phone_num', sql.VarChar, d.Phone_num)
      .input('Ext1', sql.VarChar, d.Ext1 || '')
      .input('Cust_Name', sql.NVarChar, d.Cust_Name || '')
      .input('Street', sql.VarChar, d.Street || '')
      .input('City', sql.VarChar, d.City || '')
      .input('Province', sql.VarChar, d.Province || '')
      .input('Contract_Service', sql.VarChar, d.Contract_Service || '')
      .input('Contact_Person', sql.NVarChar, d.Contact_Person || '')
      .input('Postal_Code', sql.VarChar, d.Postal_Code || '')
      .input('Fax', sql.VarChar, d.Fax || '')
      .input('Industry', sql.VarChar, d.Industry || '')
      .input('Installation_Date', sql.DateTime, parseDate(d.Installation_Date))
      .input('Last_Modified_Date', sql.DateTime, parseDate(d.Last_Modified_Date) || new Date())
      .input('Phone2', sql.VarChar, d.Phone2 || '')
      .input('EMail', sql.VarChar, d.EMail || '')
      .input('Warranty_Expiry_DateHW', sql.DateTime, parseDate(d.Warranty_Expiry_DateHW))
      .input('Warranty_Expiry_DateSF', sql.DateTime, parseDate(d.Warranty_Expiry_DateSF))
      .input('Remote_Access', sql.SmallInt, d.Remote_Access ? 1 : 0)
      .input('ServiceDay', sql.VarChar, d.ServiceDay || '')
      .input('ServiceHR', sql.VarChar, d.ServiceHR || '')
      .input('CreditCardType', sql.VarChar, d.CreditCardType || '')
      .input('CreditCardNum', sql.VarChar, d.CreditCardNum || '')
      .input('CreditCardHolder', sql.VarChar, d.CreditCardHolder || '')
      .input('CreditCardExpDate', sql.VarChar, d.CreditCardExpDate || '')
      .input('URLAddress', sql.VarChar, d.URLAddress || '')
      .input('RecDate', sql.VarChar, d.RecDate || '')
      .input('NoURL', sql.Int, d.NoURL ? 1 : 0)
      .input('AnyDesk', sql.VarChar, d.AnyDesk || '')
      .input('ADate', sql.VarChar, d.ADate || '')
      .input('AStatus', sql.VarChar, d.AStatus || '')
      .input('BDate', sql.VarChar, d.BDate || '')
      .input('BStatus', sql.VarChar, d.BStatus || '')
      .input('InstallationSummary', sql.NVarChar, d.InstallationSummary || '')
      .input('AccessIP', sql.VarChar, d.AccessIP || '')
      .input('RustDesk', sql.VarChar, d.RustDesk || '')
      .query(`INSERT INTO Customer (Phone_num,Ext1,Cust_Name,Street,City,Province,Contract_Service,Contact_Person,
        Postal_Code,Fax,Industry,Installation_Date,Last_Modified_Date,Phone2,EMail,
        Warranty_Expiry_DateHW,Warranty_Expiry_DateSF,Remote_Access,ServiceDay,ServiceHR,
        CreditCardType,CreditCardNum,CreditCardHolder,CreditCardExpDate,
        URLAddress,RecDate,NoURL,AnyDesk,ADate,AStatus,BDate,BStatus,
        InstallationSummary,AccessIP,RustDesk)
        VALUES (@Phone_num,@Ext1,@Cust_Name,@Street,@City,@Province,@Contract_Service,@Contact_Person,
        @Postal_Code,@Fax,@Industry,@Installation_Date,@Last_Modified_Date,@Phone2,@EMail,
        @Warranty_Expiry_DateHW,@Warranty_Expiry_DateSF,@Remote_Access,@ServiceDay,@ServiceHR,
        @CreditCardType,@CreditCardNum,@CreditCardHolder,@CreditCardExpDate,
        @URLAddress,@RecDate,@NoURL,@AnyDesk,@ADate,@AStatus,@BDate,@BStatus,
        @InstallationSummary,@AccessIP,@RustDesk)`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/customers/:phone', async (req, res) => {
  try {
    const pool = await getPool();
    const d = req.body;
    await pool.request()
      .input('Phone_num', sql.VarChar, req.params.phone)
      .input('Ext1', sql.VarChar, d.Ext1 || '')
      .input('Cust_Name', sql.NVarChar, d.Cust_Name || '')
      .input('Street', sql.VarChar, d.Street || '')
      .input('City', sql.VarChar, d.City || '')
      .input('Province', sql.VarChar, d.Province || '')
      .input('Contract_Service', sql.VarChar, d.Contract_Service || '')
      .input('Contact_Person', sql.NVarChar, d.Contact_Person || '')
      .input('Postal_Code', sql.VarChar, d.Postal_Code || '')
      .input('Fax', sql.VarChar, d.Fax || '')
      .input('Industry', sql.VarChar, d.Industry || '')
      .input('Installation_Date', sql.DateTime, parseDate(d.Installation_Date))
      .input('Last_Modified_Date', sql.DateTime, new Date())
      .input('Phone2', sql.VarChar, d.Phone2 || '')
      .input('EMail', sql.VarChar, d.EMail || '')
      .input('Warranty_Expiry_DateHW', sql.DateTime, parseDate(d.Warranty_Expiry_DateHW))
      .input('Warranty_Expiry_DateSF', sql.DateTime, parseDate(d.Warranty_Expiry_DateSF))
      .input('Remote_Access', sql.SmallInt, d.Remote_Access ? 1 : 0)
      .input('ServiceDay', sql.VarChar, d.ServiceDay || '')
      .input('ServiceHR', sql.VarChar, d.ServiceHR || '')
      .input('CreditCardType', sql.VarChar, d.CreditCardType || '')
      .input('CreditCardNum', sql.VarChar, d.CreditCardNum || '')
      .input('CreditCardHolder', sql.VarChar, d.CreditCardHolder || '')
      .input('CreditCardExpDate', sql.VarChar, d.CreditCardExpDate || '')
      .input('URLAddress', sql.VarChar, d.URLAddress || '')
      .input('RecDate', sql.VarChar, d.RecDate || '')
      .input('NoURL', sql.Int, d.NoURL ? 1 : 0)
      .input('AnyDesk', sql.VarChar, d.AnyDesk || '')
      .input('ADate', sql.VarChar, d.ADate || '')
      .input('AStatus', sql.VarChar, d.AStatus || '')
      .input('BDate', sql.VarChar, d.BDate || '')
      .input('BStatus', sql.VarChar, d.BStatus || '')
      .input('InstallationSummary', sql.NVarChar, d.InstallationSummary || '')
      .input('AccessIP', sql.VarChar, d.AccessIP || '')
      .input('RustDesk', sql.VarChar, d.RustDesk || '')
      .query(`UPDATE Customer SET Ext1=@Ext1,Cust_Name=@Cust_Name,Street=@Street,City=@City,
        Province=@Province,Contract_Service=@Contract_Service,Contact_Person=@Contact_Person,
        Postal_Code=@Postal_Code,Fax=@Fax,Industry=@Industry,Installation_Date=@Installation_Date,
        Last_Modified_Date=@Last_Modified_Date,Phone2=@Phone2,EMail=@EMail,
        Warranty_Expiry_DateHW=@Warranty_Expiry_DateHW,Warranty_Expiry_DateSF=@Warranty_Expiry_DateSF,
        Remote_Access=@Remote_Access,ServiceDay=@ServiceDay,ServiceHR=@ServiceHR,
        CreditCardType=@CreditCardType,CreditCardNum=@CreditCardNum,CreditCardHolder=@CreditCardHolder,
        CreditCardExpDate=@CreditCardExpDate,URLAddress=@URLAddress,RecDate=@RecDate,
        NoURL=@NoURL,AnyDesk=@AnyDesk,ADate=@ADate,AStatus=@AStatus,BDate=@BDate,BStatus=@BStatus,
        InstallationSummary=@InstallationSummary,AccessIP=@AccessIP,RustDesk=@RustDesk
        WHERE Phone_num=@Phone_num`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/customers/:phone', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('phone', sql.VarChar, req.params.phone)
      .query('DELETE FROM Customer WHERE Phone_num=@phone');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── CALLLOG ──────────────────────────────────────────────────────────────────
// CallDate / CallTime are datetime; ServHour is real

app.get('/api/calllog', async (req, res) => {
  try {
    const pool = await getPool();
    const { phone, dateFrom, dateTo } = req.query;
    let query = 'SELECT Phone_num,SeqNo,CallDate,CallTime,ServHour,Subject,Action,Via,Response,Status,Remark FROM CallLog';
    const request = pool.request();
    const conds = [];
    if (phone)    { conds.push('Phone_num=@phone');        request.input('phone',    sql.NVarChar, phone); }
    if (dateFrom) { conds.push('CallDate>=@dateFrom');     request.input('dateFrom', sql.DateTime, parseDate(dateFrom)); }
    if (dateTo)   { conds.push('CallDate<=@dateTo');       request.input('dateTo',   sql.DateTime, parseDate(dateTo)); }
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY CallDate DESC, CallTime DESC';
    const result = await request.query(query);
    result.recordset.forEach(r => fmtDateRow(r, ['CallDate', 'CallTime']));
    res.json(result.recordset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/calllog', async (req, res) => {
  try {
    const pool = await getPool();
    const d = req.body;
    const nextSeq = await withSerializable(pool, async (transaction) => {
      const seqRes = await transaction.request()
        .input('phone', sql.NVarChar, d.Phone_num)
        .query("SELECT ISNULL(MAX(CAST(SeqNo AS INT)),0)+1 AS NextSeq FROM CallLog WHERE Phone_num=@phone");
      const seq = String(seqRes.recordset[0].NextSeq).padStart(3, '0');
      const callDate = parseDate(d.CallDate) || new Date();
      await transaction.request()
        .input('Phone_num', sql.NVarChar, d.Phone_num)
        .input('SeqNo', sql.NVarChar, seq)
        .input('CallDate', sql.DateTime, callDate)
        .input('CallTime', sql.DateTime, callDate)
        .input('ServHour', sql.Real, parseFloat(d.ServHour) || 0)
        .input('Subject', sql.NVarChar, d.Subject || '')
        .input('Action', sql.NVarChar, d.Action || '')
        .input('Via', sql.NVarChar, d.Via || '')
        .input('Response', sql.NVarChar, d.Response || '')
        .input('Status', sql.NVarChar, d.Status || '')
        .input('Remark', sql.NVarChar, d.Remark || '')
        .input('Last_Modified_Date', sql.DateTime, new Date())
        .query(`INSERT INTO CallLog (Phone_num,SeqNo,CallDate,CallTime,ServHour,Subject,Action,Via,Response,Status,Remark,Last_Modified_Date)
                VALUES (@Phone_num,@SeqNo,@CallDate,@CallTime,@ServHour,@Subject,@Action,@Via,@Response,@Status,@Remark,@Last_Modified_Date)`);
      return seq;
    });
    res.json({ ok: true, SeqNo: nextSeq });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/calllog/:phone/:seqno', async (req, res) => {
  try {
    const pool = await getPool();
    const d = req.body;
    const callDate = parseDate(d.CallDate) || new Date();
    await pool.request()
      .input('Phone_num', sql.NVarChar, req.params.phone)
      .input('SeqNo', sql.NVarChar, req.params.seqno)
      .input('CallDate', sql.DateTime, callDate)
      .input('CallTime', sql.DateTime, callDate)
      .input('ServHour', sql.Real, parseFloat(d.ServHour) || 0)
      .input('Subject', sql.NVarChar, d.Subject || '')
      .input('Action', sql.NVarChar, d.Action || '')
      .input('Via', sql.NVarChar, d.Via || '')
      .input('Response', sql.NVarChar, d.Response || '')
      .input('Status', sql.NVarChar, d.Status || '')
      .input('Remark', sql.NVarChar, d.Remark || '')
      .query(`UPDATE CallLog SET CallDate=@CallDate,CallTime=@CallTime,ServHour=@ServHour,
              Subject=@Subject,Action=@Action,Via=@Via,Response=@Response,Status=@Status,Remark=@Remark
              WHERE Phone_num=@Phone_num AND SeqNo=@SeqNo`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/calllog/:phone/:seqno', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('phone', sql.NVarChar, req.params.phone)
      .input('seqno', sql.NVarChar, req.params.seqno)
      .query('DELETE FROM CallLog WHERE Phone_num=@phone AND SeqNo=@seqno');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── HARDWARE ─────────────────────────────────────────────────────────────────

app.get('/api/hardware', async (req, res) => {
  try {
    const pool = await getPool();
    const { phone } = req.query;
    let query = 'SELECT * FROM Hardware';
    const request = pool.request();
    if (phone) { query += ' WHERE Phone_num=@phone'; request.input('phone', sql.NVarChar, phone); }
    query += ' ORDER BY SeqNo';
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/hardware', async (req, res) => {
  try {
    const pool = await getPool();
    const d = req.body;
    const nextSeq = await withSerializable(pool, async (transaction) => {
      const seqRes = await transaction.request()
        .query("SELECT ISNULL(MAX(CAST(SeqNo AS INT)), 100) AS maxSeq FROM Hardware");
      const seq = seqRes.recordset[0].maxSeq + 1;
      await transaction.request()
        .input('Phone_num', sql.NVarChar, d.Phone_num)
        .input('SeqNo', sql.NVarChar, String(seq))
        .input('Device_Name', sql.NVarChar, d.Device_Name || '')
        .input('MotherBoard', sql.NVarChar, d.MotherBoard || '')
        .input('CPU', sql.NVarChar, d.CPU || '')
        .input('Memory', sql.NVarChar, d.Memory || '')
        .input('HDD', sql.NVarChar, d.HDD || '')
        .input('Monitor', sql.NVarChar, d.Monitor || '')
        .input('KB', sql.NVarChar, d.KB || '')
        .input('GraphicCard', sql.NVarChar, d.GraphicCard || '')
        .input('Printer', sql.NVarChar, d.Printer || '')
        .input('Scanner', sql.NVarChar, d.Scanner || '')
        .input('CashDrawer', sql.NVarChar, d.CashDrawer || '')
        .input('Others', sql.NVarChar, d.Others || '')
        .input('CustomerProvide', sql.NVarChar, d.CustomerProvide || '')
        .input('BorrowTo', sql.NVarChar, d.BorrowTo || '')
        .input('Last_Modified_Date', sql.DateTime, new Date())
        .query(`INSERT INTO Hardware (Phone_num,SeqNo,Device_Name,MotherBoard,CPU,Memory,HDD,Monitor,KB,GraphicCard,Printer,Scanner,CashDrawer,Others,CustomerProvide,BorrowTo,Last_Modified_Date)
                VALUES (@Phone_num,@SeqNo,@Device_Name,@MotherBoard,@CPU,@Memory,@HDD,@Monitor,@KB,@GraphicCard,@Printer,@Scanner,@CashDrawer,@Others,@CustomerProvide,@BorrowTo,@Last_Modified_Date)`);
      return seq;
    });
    res.json({ ok: true, SeqNo: String(nextSeq) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/hardware/:seqno', async (req, res) => {
  try {
    const pool = await getPool();
    const d = req.body;
    await pool.request()
      .input('SeqNo', sql.NVarChar, req.params.seqno)
      .input('Phone_num', sql.NVarChar, d.Phone_num || '')
      .input('Device_Name', sql.NVarChar, d.Device_Name || '')
      .input('MotherBoard', sql.NVarChar, d.MotherBoard || '')
      .input('CPU', sql.NVarChar, d.CPU || '')
      .input('Memory', sql.NVarChar, d.Memory || '')
      .input('HDD', sql.NVarChar, d.HDD || '')
      .input('Monitor', sql.NVarChar, d.Monitor || '')
      .input('KB', sql.NVarChar, d.KB || '')
      .input('GraphicCard', sql.NVarChar, d.GraphicCard || '')
      .input('Printer', sql.NVarChar, d.Printer || '')
      .input('Scanner', sql.NVarChar, d.Scanner || '')
      .input('CashDrawer', sql.NVarChar, d.CashDrawer || '')
      .input('Others', sql.NVarChar, d.Others || '')
      .input('CustomerProvide', sql.NVarChar, d.CustomerProvide || '')
      .input('BorrowTo', sql.NVarChar, d.BorrowTo || '')
      .query(`UPDATE Hardware SET Phone_num=@Phone_num,Device_Name=@Device_Name,MotherBoard=@MotherBoard,
              CPU=@CPU,Memory=@Memory,HDD=@HDD,Monitor=@Monitor,KB=@KB,GraphicCard=@GraphicCard,
              Printer=@Printer,Scanner=@Scanner,CashDrawer=@CashDrawer,Others=@Others,
              CustomerProvide=@CustomerProvide,BorrowTo=@BorrowTo WHERE SeqNo=@SeqNo`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/hardware/:seqno', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('seqno', sql.NVarChar, req.params.seqno)
      .query('DELETE FROM Hardware WHERE SeqNo=@seqno');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── HWRMA ────────────────────────────────────────────────────────────────────
// IssueDate / ShipDate / ReturnDate are datetime

app.get('/api/hwrma', async (req, res) => {
  try {
    const pool = await getPool();
    const { phone, status } = req.query;
    let query = 'SELECT * FROM HWRMA';
    const request = pool.request();
    const conds = [];
    if (phone)  { conds.push('Phone_num=@phone');   request.input('phone',  sql.NVarChar, phone); }
    if (status) { conds.push('Status=@status');      request.input('status', sql.NVarChar, status); }
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY IssueDate DESC';
    const result = await request.query(query);
    result.recordset.forEach(r => fmtDateRow(r, ['IssueDate','ShipDate','ReturnDate']));
    res.json(result.recordset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/hwrma/next-number', async (req, res) => {
  try {
    const pool = await getPool();
    const issueDate = parseDate(req.query.issueDate) || new Date();
    const RMANo = await getNextRMANo(pool.request(), issueDate);
    res.json({ RMANo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/hwrma', async (req, res) => {
  try {
    const pool = await getPool();
    const d = req.body;
    const issueDate = parseDate(d.IssueDate) || new Date();
    let rmaNo;
    await withSerializable(pool, async (transaction) => {
      rmaNo = await getNextRMANo(transaction.request(), issueDate);
      await transaction.request()
        .input('Phone_num', sql.NVarChar, d.Phone_num)
        .input('RMANo', sql.NVarChar, rmaNo)
        .input('IssueDate', sql.DateTime, issueDate)
        .input('Status', sql.NVarChar, d.Status || 'Open')
        .input('DeviceName', sql.NVarChar, d.DeviceName || '')
        .input('Problem', sql.NVarChar, d.Problem || '')
        .input('cAction', sql.NVarChar, d.cAction || '')
        .input('HandleBy', sql.NVarChar, d.HandleBy || '')
        .input('RepairBy', sql.NVarChar, d.RepairBy || '')
        .input('VendorRMANo', sql.NVarChar, d.VendorRMANo || '')
        .input('ShipDate', sql.DateTime, parseDate(d.ShipDate))
        .input('ReturnDate', sql.DateTime, parseDate(d.ReturnDate))
        .input('BorrowFrom', sql.NVarChar, d.BorrowFrom || '')
        .input('OldSN', sql.NVarChar, d.OldSN || '')
        .input('NewSN', sql.NVarChar, d.NewSN || '')
        .input('DeliveryMethod', sql.NVarChar, d.DeliveryMethod || '')
        .input('Remark', sql.NVarChar, d.Remark || '')
        .input('Last_Modified_Date', sql.DateTime, new Date())
        .query(`INSERT INTO HWRMA (Phone_num,RMANo,IssueDate,Status,DeviceName,Problem,cAction,HandleBy,RepairBy,VendorRMANo,ShipDate,ReturnDate,BorrowFrom,OldSN,NewSN,DeliveryMethod,Remark,Last_Modified_Date)
                VALUES (@Phone_num,@RMANo,@IssueDate,@Status,@DeviceName,@Problem,@cAction,@HandleBy,@RepairBy,@VendorRMANo,@ShipDate,@ReturnDate,@BorrowFrom,@OldSN,@NewSN,@DeliveryMethod,@Remark,@Last_Modified_Date)`);
    });
    res.json({ ok: true, RMANo: rmaNo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/hwrma/:phone/:rmano', async (req, res) => {
  try {
    const pool = await getPool();
    const d = req.body;
    await pool.request()
      .input('Phone_num', sql.NVarChar, req.params.phone)
      .input('RMANo', sql.NVarChar, req.params.rmano)
      .input('IssueDate', sql.DateTime, parseDate(d.IssueDate) || new Date())
      .input('Status', sql.NVarChar, d.Status || '')
      .input('DeviceName', sql.NVarChar, d.DeviceName || '')
      .input('Problem', sql.NVarChar, d.Problem || '')
      .input('cAction', sql.NVarChar, d.cAction || '')
      .input('HandleBy', sql.NVarChar, d.HandleBy || '')
      .input('RepairBy', sql.NVarChar, d.RepairBy || '')
      .input('VendorRMANo', sql.NVarChar, d.VendorRMANo || '')
      .input('ShipDate', sql.DateTime, parseDate(d.ShipDate))
      .input('ReturnDate', sql.DateTime, parseDate(d.ReturnDate))
      .input('BorrowFrom', sql.NVarChar, d.BorrowFrom || '')
      .input('OldSN', sql.NVarChar, d.OldSN || '')
      .input('NewSN', sql.NVarChar, d.NewSN || '')
      .input('DeliveryMethod', sql.NVarChar, d.DeliveryMethod || '')
      .input('Remark', sql.NVarChar, d.Remark || '')
      .query(`UPDATE HWRMA SET IssueDate=@IssueDate,Status=@Status,DeviceName=@DeviceName,Problem=@Problem,
              cAction=@cAction,HandleBy=@HandleBy,RepairBy=@RepairBy,VendorRMANo=@VendorRMANo,
              ShipDate=@ShipDate,ReturnDate=@ReturnDate,BorrowFrom=@BorrowFrom,OldSN=@OldSN,
              NewSN=@NewSN,DeliveryMethod=@DeliveryMethod,Remark=@Remark
              WHERE Phone_num=@Phone_num AND RMANo=@RMANo`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/hwrma/:phone/:rmano', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('phone', sql.NVarChar, req.params.phone)
      .input('rmano', sql.NVarChar, req.params.rmano)
      .query('DELETE FROM HWRMA WHERE Phone_num=@phone AND RMANo=@rmano');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SWFIX ────────────────────────────────────────────────────────────────────
// Column is Phone_Num (capital N); PK is CaseNum only; IssueDate is datetime

app.get('/api/swfix', async (req, res) => {
  try {
    const pool = await getPool();
    const { phone, status } = req.query;
    let query = 'SELECT * FROM SWFix';
    const request = pool.request();
    const conds = [];
    if (phone)  { conds.push('Phone_Num=@phone');   request.input('phone',  sql.NVarChar, phone); }
    if (status) { conds.push('Status=@status');      request.input('status', sql.NVarChar, status); }
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY IssueDate DESC';
    const result = await request.query(query);
    result.recordset.forEach(r => fmtDateRow(r, ['IssueDate']));
    res.json(result.recordset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/swfix', async (req, res) => {
  try {
    const pool = await getPool();
    const d = req.body;
    await pool.request()
      .input('Phone_Num', sql.NVarChar, d.Phone_num || d.Phone_Num)
      .input('CaseNum', sql.NVarChar, d.CaseNum)
      .input('IssueDate', sql.DateTime, parseDate(d.IssueDate) || new Date())
      .input('Status', sql.NVarChar, d.Status || 'Open')
      .input('SoftwareName', sql.NVarChar, d.SoftwareName || '')
      .input('Version', sql.NVarChar, d.Version || '')
      .input('Problem', sql.NVarChar, d.Problem || '')
      .input('cAction', sql.NVarChar, d.cAction || '')
      .input('HandleBy', sql.NVarChar, d.HandleBy || '')
      .input('DeliveryMethod', sql.NVarChar, d.DeliveryMethod || '')
      .input('Remark', sql.NVarChar, d.Remark || '')
      .query(`INSERT INTO SWFix (Phone_Num,CaseNum,IssueDate,Status,SoftwareName,Version,Problem,cAction,HandleBy,DeliveryMethod,Remark)
              VALUES (@Phone_Num,@CaseNum,@IssueDate,@Status,@SoftwareName,@Version,@Problem,@cAction,@HandleBy,@DeliveryMethod,@Remark)`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/swfix/:phone/:casenum', async (req, res) => {
  try {
    const pool = await getPool();
    const d = req.body;
    await pool.request()
      .input('CaseNum', sql.NVarChar, req.params.casenum)
      .input('IssueDate', sql.DateTime, parseDate(d.IssueDate) || new Date())
      .input('Status', sql.NVarChar, d.Status || '')
      .input('SoftwareName', sql.NVarChar, d.SoftwareName || '')
      .input('Version', sql.NVarChar, d.Version || '')
      .input('Problem', sql.NVarChar, d.Problem || '')
      .input('cAction', sql.NVarChar, d.cAction || '')
      .input('HandleBy', sql.NVarChar, d.HandleBy || '')
      .input('DeliveryMethod', sql.NVarChar, d.DeliveryMethod || '')
      .input('Remark', sql.NVarChar, d.Remark || '')
      .query(`UPDATE SWFix SET IssueDate=@IssueDate,Status=@Status,SoftwareName=@SoftwareName,
              Version=@Version,Problem=@Problem,cAction=@cAction,HandleBy=@HandleBy,
              DeliveryMethod=@DeliveryMethod,Remark=@Remark WHERE CaseNum=@CaseNum`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/swfix/:phone/:casenum', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('casenum', sql.NVarChar, req.params.casenum)
      .query('DELETE FROM SWFix WHERE CaseNum=@casenum');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── NOTES ────────────────────────────────────────────────────────────────────
// Real schema: ID (identity), Notes (ntext), UpdTime (datetime) — no Phone_num

app.get('/api/notes', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .query('SELECT ID, CAST(Notes AS NVARCHAR(MAX)) AS Notes, UpdTime FROM Notes ORDER BY UpdTime DESC');
    result.recordset.forEach(r => fmtDateRow(r, ['UpdTime']));
    res.json(result.recordset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/notes', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('Notes', sql.NVarChar, req.body.Notes || '')
      .input('UpdTime', sql.DateTime, new Date())
      .query('INSERT INTO Notes (Notes, UpdTime) VALUES (@Notes, @UpdTime)');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/notes/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('ID', sql.Int, parseInt(req.params.id))
      .input('Notes', sql.NVarChar, req.body.Notes || '')
      .input('UpdTime', sql.DateTime, new Date())
      .query('UPDATE Notes SET Notes=@Notes, UpdTime=@UpdTime WHERE ID=@ID');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/notes/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, parseInt(req.params.id))
      .query('DELETE FROM Notes WHERE ID=@id');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── LOOKUP: City, Engineer, Industry, SWName ─────────────────────────────────
// ID is nvarchar(2), not identity — calculate next ID numerically

function nvarchar2Lookup(table, idField, nameField, sqlIdType) {
  sqlIdType = sqlIdType || sql.NVarChar;

  app.get(`/api/lookup/${table.toLowerCase()}`, async (req, res) => {
    try {
      const pool = await getPool();
      const result = await pool.request()
        .query(`SELECT ${idField}, ${nameField} FROM ${table} ORDER BY ${idField}`);
      res.json(result.recordset);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post(`/api/lookup/${table.toLowerCase()}`, async (req, res) => {
    try {
      const pool = await getPool();
      await withSerializable(pool, async (transaction) => {
        const maxRes = await transaction.request()
          .query(`SELECT ISNULL(MAX(CAST(${idField} AS INT)),0)+1 AS Next FROM ${table}`);
        const nextId = String(maxRes.recordset[0].Next).padStart(2, '0');
        await transaction.request()
          .input('id',  sql.NVarChar, nextId)
          .input('val', sql.NVarChar, req.body[nameField] || '')
          .query(`INSERT INTO ${table} (${idField}, ${nameField}) VALUES (@id, @val)`);
      });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put(`/api/lookup/${table.toLowerCase()}/:id`, async (req, res) => {
    try {
      const pool = await getPool();
      await pool.request()
        .input('id',  sql.NVarChar, req.params.id)
        .input('val', sql.NVarChar, req.body[nameField] || '')
        .query(`UPDATE ${table} SET ${nameField}=@val WHERE ${idField}=@id`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete(`/api/lookup/${table.toLowerCase()}/:id`, async (req, res) => {
    try {
      const pool = await getPool();
      await pool.request().input('id', sql.NVarChar, req.params.id)
        .query(`DELETE FROM ${table} WHERE ${idField}=@id`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

nvarchar2Lookup('City',     'ID', 'City');
nvarchar2Lookup('Engineer', 'ID', 'Engineer');
nvarchar2Lookup('Industry', 'ID', 'Industry');
nvarchar2Lookup('SWName',   'ID', 'Software_Name');

// ─── LOOKUP: ServiceDay, ServiceHR ────────────────────────────────────────────
// PK is Seq_num (nvarchar(2)); field names differ

nvarchar2Lookup('ServiceDay', 'Seq_num', 'ServiceDay');
nvarchar2Lookup('ServiceHR',  'Seq_num', 'ServiceHR');


// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CustProfile Web running at http://localhost:${PORT}`));
