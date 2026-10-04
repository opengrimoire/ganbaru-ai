//! Admit aggregate inputs before grouping, without truncating canonical evidence.

use sqlx::SqliteConnection;

const HISTORY_AGGREGATE_ROWS: i64 = 100_000;
const REPLAY_AGGREGATE_ROWS: i64 = 1_000_000;

pub(super) const MAX_RECOVERY_RECORDS: i64 = 10_000;
pub(super) const MAX_RECOVERY_BYTES: i64 = 16 * 1024 * 1024;
const RECOVERY_RECORD_OVERHEAD: i64 = 256;

/// Recovery shares one row and allocation allowance across its canonical inputs.
/// Preflight runs in the recovery transaction before loading payloads or writing.
pub(super) struct RecoveryBudget {
    records_left: i64,
    bytes_left: i64,
}

impl Default for RecoveryBudget {
    fn default() -> Self {
        Self {
            records_left: MAX_RECOVERY_RECORDS,
            bytes_left: MAX_RECOVERY_BYTES,
        }
    }
}

impl RecoveryBudget {
    /// SQL and column names are native constants. The count probe stops at one
    /// excess row, and SQLite measures text before Rust allocates its contents.
    pub(super) async fn admit(
        &mut self,
        connection: &mut SqliteConnection,
        source_sql: &str,
        text_columns: &[&str],
        domain: &str,
    ) -> Result<(), String> {
        let bytes = text_columns
            .iter()
            .map(|column| format!("COALESCE(length(CAST(\"{column}\" AS BLOB)), 0)"))
            .collect::<Vec<_>>()
            .join(" + ");
        let query = format!(
            "SELECT COUNT(*), COALESCE(SUM(record_bytes), 0) FROM (
                SELECT {RECOVERY_RECORD_OVERHEAD} + 4 * ({bytes}) AS record_bytes
                FROM ({source_sql}) LIMIT ?)"
        );
        let (records, bytes): (i64, i64) = sqlx::query_as(&query)
            .bind(self.records_left + 1)
            .fetch_one(connection)
            .await
            .map_err(|error| format!("admit Focus recovery {domain}: {error}"))?;
        if records > self.records_left {
            return Err(format!(
                "Focus recovery {domain} exceeds its shared record budget"
            ));
        }
        if bytes > self.bytes_left {
            return Err(format!(
                "Focus recovery {domain} exceeds its shared byte budget"
            ));
        }
        self.records_left -= records;
        self.bytes_left -= bytes;
        Ok(())
    }
}

/// One allowance is shared by every aggregate in a history or replay read.
/// Count probes stop at one excess row and run in the caller's same snapshot.
pub(super) struct AggregateBudget {
    remaining: i64,
}

impl AggregateBudget {
    pub(super) fn history() -> Self {
        Self {
            remaining: HISTORY_AGGREGATE_ROWS,
        }
    }

    pub(super) fn replay() -> Self {
        Self {
            remaining: REPLAY_AGGREGATE_ROWS,
        }
    }

    /// Source SQL and arguments belong to native code, never to IPC input.
    /// Callers use indexed filters and no ordering in these preliminary reads.
    pub(super) async fn admit(
        &mut self,
        connection: &mut SqliteConnection,
        source_sql: &str,
        policy_id: &str,
        before: Option<&str>,
        domain: &str,
    ) -> Result<(), String> {
        let query = format!("SELECT COUNT(*) FROM ({source_sql} LIMIT ?)");
        let mut count = sqlx::query_scalar::<_, i64>(&query).bind(policy_id);
        if let Some(before) = before {
            count = count.bind(before);
        }
        let count = count
            .bind(self.remaining + 1)
            .fetch_one(connection)
            .await
            .map_err(|error| format!("admit adaptive {domain} aggregate: {error}"))?;
        if count > self.remaining {
            return Err(format!(
                "Adaptive {domain} aggregate exceeds its input work budget"
            ));
        }
        self.remaining -= count;
        Ok(())
    }
}
