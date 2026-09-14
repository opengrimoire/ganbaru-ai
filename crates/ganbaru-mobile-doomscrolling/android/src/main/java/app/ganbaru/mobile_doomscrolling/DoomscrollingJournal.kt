package app.ganbaru.mobile_doomscrolling

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.time.Instant
import java.time.ZoneId
import java.util.UUID

internal data class JournalEvent(
  val id: String,
  val kind: String,
  val packageName: String,
  val displayName: String,
  val startedAt: Long,
  val elapsedSeconds: Int,
  val localDate: String,
  val occurredAt: Long,
  val reason: String?,
  val ruleId: String?,
  val runId: String?,
  val phase: String?,
  val vaultId: String,
)

internal data class JournalUsageInterval(
  val packageName: String,
  val displayName: String,
  val startedAt: Long,
  val endedAt: Long,
)

internal class DoomscrollingJournal(context: Context) : SQLiteOpenHelper(
  context,
  "ganbaru-doomscrolling-runtime.sqlite",
  null,
  1,
) {
  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE journal_events (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('usage', 'block')),
        package_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        elapsed_seconds INTEGER NOT NULL,
        local_date TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        reason TEXT,
        rule_id TEXT,
        run_id TEXT,
        phase TEXT,
        vault_id TEXT NOT NULL
      )
      """.trimIndent(),
    )
    db.execSQL(
      """
      CREATE TABLE daily_totals (
        package_name TEXT NOT NULL,
        local_date TEXT NOT NULL,
        elapsed_seconds INTEGER NOT NULL,
        PRIMARY KEY(package_name, local_date)
      )
      """.trimIndent(),
    )
    db.execSQL("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    db.execSQL("CREATE INDEX journal_events_occurred ON journal_events(occurred_at)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    error("Unsupported Doomscrolling journal schema change from $oldVersion to $newVersion")
  }

  fun recordUsageBatch(
    vaultId: String,
    intervals: List<JournalUsageInterval>,
    observedAt: Long,
  ) {
    writableDatabase.beginTransaction()
    try {
      for (interval in intervals) {
        if (interval.endedAt <= interval.startedAt) continue
        val normalizedPackage = interval.packageName.lowercase()
        for (slice in splitByLocalDate(interval.startedAt, interval.endedAt)) {
          val elapsedSeconds = ((slice.endEpochMs - slice.startEpochMs) / 1_000L)
            .coerceAtMost(86_400L).toInt()
          if (elapsedSeconds < 1) continue
          val values = ContentValues().apply {
            put("id", "usage-${UUID.randomUUID()}")
            put("kind", "usage")
            put("package_name", normalizedPackage)
            put("display_name", interval.displayName.take(120))
            put("started_at", slice.startEpochMs)
            put("elapsed_seconds", elapsedSeconds)
            put("local_date", slice.localDate)
            put("occurred_at", interval.endedAt)
            put("vault_id", vaultId)
          }
          writableDatabase.insertOrThrow("journal_events", null, values)
          incrementDailyTotal(normalizedPackage, slice.localDate, elapsedSeconds)
        }
      }
      writeMetadata("lastObservedEpochMs", observedAt)
      pruneDailyTotals(observedAt)
      writableDatabase.setTransactionSuccessful()
    } finally {
      writableDatabase.endTransaction()
    }
    compactIfNeeded()
  }

  fun recordBlock(
    packageName: String,
    displayName: String,
    occurredAt: Long,
    reason: String,
    ruleId: String?,
    runId: String?,
    phase: String?,
    vaultId: String,
  ) {
    writableDatabase.insertOrThrow("journal_events", null, ContentValues().apply {
      put("id", "block-${UUID.randomUUID()}")
      put("kind", "block")
      put("package_name", packageName.lowercase())
      put("display_name", displayName.take(120))
      put("started_at", occurredAt)
      put("elapsed_seconds", 0)
      put("local_date", localDate(occurredAt))
      put("occurred_at", occurredAt)
      put("reason", reason.take(80))
      put("rule_id", ruleId?.take(80))
      put("run_id", runId?.take(128))
      put("phase", phase?.take(32))
      put("vault_id", vaultId)
    })
    compactIfNeeded()
  }

  fun usedSeconds(packageNames: Set<String>, startDate: String, endDate: String): Int {
    if (packageNames.isEmpty()) return 0
    val placeholders = packageNames.joinToString(",") { "?" }
    val args = packageNames.map(String::lowercase) + listOf(startDate, endDate)
    readableDatabase.rawQuery(
      """
      SELECT COALESCE(SUM(elapsed_seconds), 0)
      FROM daily_totals
      WHERE package_name IN ($placeholders) AND local_date BETWEEN ? AND ?
      """.trimIndent(),
      args.toTypedArray(),
    ).use { cursor ->
      return if (cursor.moveToFirst()) cursor.getInt(0) else 0
    }
  }

  fun pending(limit: Int = 200): List<JournalEvent> {
    val events = mutableListOf<JournalEvent>()
    readableDatabase.query(
      "journal_events",
      EVENT_COLUMNS,
      null,
      null,
      null,
      null,
      "CASE WHEN kind = 'usage' THEN 0 ELSE 1 END, occurred_at ASC, id ASC",
      limit.coerceIn(1, 500).toString(),
    ).use { cursor ->
      while (cursor.moveToNext()) {
        events += JournalEvent(
          id = cursor.getString(0),
          kind = cursor.getString(1),
          packageName = cursor.getString(2),
          displayName = cursor.getString(3),
          startedAt = cursor.getLong(4),
          elapsedSeconds = cursor.getInt(5),
          localDate = cursor.getString(6),
          occurredAt = cursor.getLong(7),
          reason = cursor.getString(8),
          ruleId = cursor.getString(9),
          runId = cursor.getString(10),
          phase = cursor.getString(11),
          vaultId = cursor.getString(12),
        )
      }
    }
    return events
  }

  fun acknowledge(ids: List<String>) {
    if (ids.isEmpty()) return
    writableDatabase.beginTransaction()
    try {
      for (id in ids.distinct().take(500)) {
        writableDatabase.delete("journal_events", "id = ?", arrayOf(id))
      }
      writableDatabase.setTransactionSuccessful()
    } finally {
      writableDatabase.endTransaction()
    }
  }

  fun metadata(key: String): Long? = readableDatabase.query(
    "metadata",
    arrayOf("value"),
    "key = ?",
    arrayOf(key),
    null,
    null,
    null,
    "1",
  ).use { cursor -> cursor.takeIf { it.moveToFirst() }?.getString(0)?.toLongOrNull() }

  private fun writeMetadata(key: String, value: Long) {
    writableDatabase.insertWithOnConflict(
      "metadata",
      null,
      ContentValues().apply {
        put("key", key)
        put("value", value.toString())
      },
      SQLiteDatabase.CONFLICT_REPLACE,
    )
  }

  fun clearTotalsAndCheckpoints() {
    writableDatabase.beginTransaction()
    try {
      writableDatabase.delete("daily_totals", null, null)
      writableDatabase.delete("metadata", null, null)
      writableDatabase.setTransactionSuccessful()
    } finally {
      writableDatabase.endTransaction()
    }
  }

  private fun compactIfNeeded() {
    val count = readableDatabase.rawQuery("SELECT COUNT(*) FROM journal_events", null)
      .use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) else 0 }
    if (count <= MAX_PENDING_EVENTS) return
    writableDatabase.beginTransaction()
    try {
      val groups = mutableListOf<JournalEvent>()
      readableDatabase.rawQuery(
        """
        SELECT package_name, MAX(display_name), MIN(started_at), SUM(elapsed_seconds),
               local_date, MAX(occurred_at), vault_id
        FROM journal_events
        WHERE kind = 'usage' AND id NOT IN (
          SELECT id FROM journal_events ORDER BY occurred_at ASC, id ASC LIMIT $MAX_IMPORT_BATCH
        )
        GROUP BY package_name, local_date, vault_id
        """.trimIndent(),
        null,
      ).use { cursor ->
        while (cursor.moveToNext()) {
          groups += JournalEvent(
            id = "compact-${UUID.randomUUID()}",
            kind = "usage",
            packageName = cursor.getString(0),
            displayName = cursor.getString(1),
            startedAt = cursor.getLong(2),
            elapsedSeconds = cursor.getInt(3).coerceAtMost(86_400),
            localDate = cursor.getString(4),
            occurredAt = cursor.getLong(5),
            reason = null,
            ruleId = null,
            runId = null,
            phase = null,
            vaultId = cursor.getString(6),
          )
        }
      }
      writableDatabase.execSQL(
        """
        DELETE FROM journal_events
        WHERE kind = 'usage' AND id NOT IN (
          SELECT id FROM journal_events ORDER BY occurred_at ASC, id ASC LIMIT $MAX_IMPORT_BATCH
        )
        """.trimIndent(),
      )
      groups.forEach(::insertCompactedEvent)
      writableDatabase.execSQL(
        """
        DELETE FROM journal_events WHERE kind = 'block' AND id NOT IN (
          SELECT id FROM journal_events WHERE kind = 'block' ORDER BY occurred_at DESC LIMIT 500
        ) AND id NOT IN (
          SELECT id FROM journal_events ORDER BY occurred_at ASC, id ASC LIMIT $MAX_IMPORT_BATCH
        )
        """.trimIndent(),
      )
      writableDatabase.setTransactionSuccessful()
    } finally {
      writableDatabase.endTransaction()
    }
  }

  private fun insertCompactedEvent(event: JournalEvent) {
    writableDatabase.insertOrThrow("journal_events", null, ContentValues().apply {
      put("id", event.id)
      put("kind", event.kind)
      put("package_name", event.packageName)
      put("display_name", event.displayName)
      put("started_at", event.startedAt)
      put("elapsed_seconds", event.elapsedSeconds)
      put("local_date", event.localDate)
      put("occurred_at", event.occurredAt)
      put("vault_id", event.vaultId)
    })
  }

  private fun pruneDailyTotals(nowEpochMs: Long) {
    val cutoff = Instant.ofEpochMilli(nowEpochMs).atZone(ZoneId.systemDefault())
      .toLocalDate().minusDays(14).toString()
    writableDatabase.delete("daily_totals", "local_date < ?", arrayOf(cutoff))
  }

  private fun incrementDailyTotal(
    packageName: String,
    localDate: String,
    elapsedSeconds: Int,
  ) {
    val inserted = writableDatabase.insertWithOnConflict(
      "daily_totals",
      null,
      ContentValues().apply {
        put("package_name", packageName)
        put("local_date", localDate)
        put("elapsed_seconds", elapsedSeconds)
      },
      SQLiteDatabase.CONFLICT_IGNORE,
    )
    if (inserted != -1L) return

    writableDatabase.compileStatement(
      """
      UPDATE daily_totals
      SET elapsed_seconds = elapsed_seconds + ?
      WHERE package_name = ? AND local_date = ?
      """.trimIndent(),
    ).use { statement ->
      statement.bindLong(1, elapsedSeconds.toLong())
      statement.bindString(2, packageName)
      statement.bindString(3, localDate)
      check(statement.executeUpdateDelete() == 1) {
        "Android usage total could not be updated"
      }
    }
  }

  private data class UsageSlice(
    val startEpochMs: Long,
    val endEpochMs: Long,
    val localDate: String,
  )

  private fun splitByLocalDate(startedAt: Long, endedAt: Long): List<UsageSlice> {
    val zone = ZoneId.systemDefault()
    val slices = mutableListOf<UsageSlice>()
    var cursor = startedAt
    while (cursor < endedAt) {
      val day = Instant.ofEpochMilli(cursor).atZone(zone).toLocalDate()
      val nextDay = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
      val end = minOf(endedAt, nextDay)
      slices += UsageSlice(cursor, end, day.toString())
      cursor = end
    }
    return slices
  }

  private fun localDate(epochMs: Long): String = Instant.ofEpochMilli(epochMs)
    .atZone(ZoneId.systemDefault()).toLocalDate().toString()

  companion object {
    private const val MAX_IMPORT_BATCH = 200
    private const val MAX_PENDING_EVENTS = 2_000
    private val EVENT_COLUMNS = arrayOf(
      "id",
      "kind",
      "package_name",
      "display_name",
      "started_at",
      "elapsed_seconds",
      "local_date",
      "occurred_at",
      "reason",
      "rule_id",
      "run_id",
      "phase",
      "vault_id",
    )
  }
}
