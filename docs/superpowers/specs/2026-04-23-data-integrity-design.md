# Data Integrity: Concurrent Add/Edit Protection

**Date:** 2026-04-23  
**Status:** Approved  

## Problem

Two concurrent users can corrupt data in two distinct ways:

1. **Sequence number collision** — Four POST handlers use a two-step "SELECT MAX → INSERT" pattern. Two simultaneous requests read the same MAX value, generate the same next key, and one INSERT fails with a duplicate key error (or silently corrupts if the key is not unique-constrained).

2. **Lost updates** — Any PUT handler overwrites the full record unconditionally. If User A and User B both open the same record, User A saves first, and User B saves second, User B's save silently discards User A's changes.

## Scope

All changes are confined to `server.js` (backend) and `public/app.js` (frontend), plus a one-time SQL migration for 4 new columns.

---

## Fix 1: Sequence Number Race — SERIALIZABLE Transactions

**Affected endpoints:**
- `POST /api/calllog` — per-customer `SeqNo`
- `POST /api/hardware` — global `SeqNo`
- `POST /api/hwrma` (via `getNextRMANo`) — per-date-prefix RMA number
- `POST /api/lookup/:table` — shared `nvarchar2Lookup` function (6 lookup tables)

**Mechanism:**

Each handler wraps its SELECT MAX + INSERT in a `sql.Transaction` at `SERIALIZABLE` isolation level. At this level, SQL Server prevents any other transaction from inserting into the scanned range until the first transaction commits, making the read-then-write atomic without requiring explicit lock hints.

```
BEGIN TRAN (SERIALIZABLE)
  SELECT MAX(SeqNo) → compute next value
  INSERT new row with computed value
COMMIT
```

On any error, the transaction is rolled back before re-throwing.

**`getNextRMANo` call site:** The function already accepts a `request` object. The call site will pass `new sql.Request(transaction)` instead of `pool.request()`, so the RMA number SELECT and the subsequent INSERT share the same transaction without changing the function signature.

---

## Fix 2: Lost Updates — Optimistic Locking via Timestamp

### Schema migration (one-time)

Add a `Last_Modified_Date DATETIME` column to the four sub-tables that lack one:

```sql
ALTER TABLE CallLog  ADD Last_Modified_Date DATETIME;
ALTER TABLE Hardware ADD Last_Modified_Date DATETIME;
ALTER TABLE HWRMA    ADD Last_Modified_Date DATETIME;
ALTER TABLE SWFix    ADD Last_Modified_Date DATETIME;
```

Customer already has `Last_Modified_Date`. Notes already has `UpdTime`.

### Backend GET — expose raw timestamp

Every GET endpoint that returns records used for editing will include a `_ts` field containing the raw `Last_Modified_Date` (or `UpdTime` for Notes) as an ISO string alongside the display-formatted date fields. This field is not shown to the user.

### Backend PUT — check before update

Every PUT handler will:
1. Accept `_ts` from the request body.
2. If `_ts` is present, append `AND Last_Modified_Date = @clientTs` (or `AND UpdTime = @clientTs`) to its `WHERE` clause. If `_ts` is absent, skip the check (no conflict detection, no error — prevents NULL-match false negatives).
3. Check `@@ROWCOUNT` after the UPDATE.
4. If `@@ROWCOUNT = 0` and `_ts` was provided, return **HTTP 409 Conflict** with `{ error: 'conflict' }`.
5. On success, set `Last_Modified_Date = GETDATE()` (already done for Customer; will be added to sub-tables).

Affected PUT endpoints: `/api/customers/:phone`, `/api/calllog/:phone/:seqno`, `/api/hardware/:seqno`, `/api/hwrma/:phone/:rmano`, `/api/swfix/:phone/:casenum`, `/api/notes/:id`.

### Frontend — send and handle `_ts`

- `state.subSelected` already holds the full fetched row, so `_ts` is carried automatically once the server includes it in GET responses.
- For the customer record, store `_ts` in a dedicated `state.custTs` variable when `loadCustomerDetail` fetches the full record.
- `saveSubRecord()` and `saveCust()`: on PUT, include `{ _ts: state.subSelected._ts }` (or `state.custTs`) in the request body.
- The `api()` helper already throws on non-ok responses, so 409 surfaces as an `Error`. The catch blocks in `saveSubRecord` and `saveCust` will check `e.message === 'conflict'` and show: **"This record was just modified by another user. Please close and reopen it before saving."**

---

## What is NOT changing

- No schema changes to primary keys or existing column types.
- No changes to DELETE endpoints (deleting a concurrently-edited record is acceptable for this app's use case).
- No changes to GET-only endpoints (reads are always consistent via SQL Server's default read-committed isolation).
- Lookup POST endpoints get the SERIALIZABLE transaction fix but not optimistic locking (lookup adds are rare and collisions would surface as a duplicate-key error, which is already caught).

---

## Error Handling Summary

| Scenario | HTTP Status | User-visible message |
|---|---|---|
| Sequence collision prevented | — | Transparent (transaction handles it) |
| Optimistic lock conflict on PUT | 409 | "This record was just modified by another user. Please close and reopen it before saving." |
| Other DB errors | 500 | Existing generic error alert (unchanged) |
