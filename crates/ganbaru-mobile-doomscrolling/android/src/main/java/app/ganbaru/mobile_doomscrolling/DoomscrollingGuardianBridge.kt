package app.ganbaru.mobile_doomscrolling

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

internal const val DOOMSCROLLING_NOTIFICATION_ACTION_KEY = "notificationAction"
private const val NOTIFICATION_ACTION_STORE = "GANBARU_DOOMSCROLLING_NOTIFICATION_ACTION_STORE"
private const val GUARDIAN_AUTHORITY_SUFFIX = ".ganbaru.guardian.doomscrolling"
private const val METHOD_APPLY_RULES = "applyRules"
private const val METHOD_INVALIDATE_RULES = "invalidateRules"
private const val METHOD_PENDING_EVENTS = "pendingEvents"
private const val METHOD_ACKNOWLEDGE_EVENTS = "acknowledgeEvents"
private const val METHOD_ACCOUNTING_SNAPSHOT = "accountingSnapshot"
private const val KEY_VAULT_ID = "vaultId"
private const val KEY_SNAPSHOT = "snapshot"
private const val KEY_EVENTS = "events"
private const val KEY_IDS = "ids"
internal val DOOMSCROLLING_GUARDIAN_LOCK = Any()

internal object DoomscrollingNotificationActionStore {
  fun capture(context: Context, intent: Intent?) {
    val target = intent?.getStringExtra(DOOMSCROLLING_NOTIFICATION_ACTION_KEY)
      ?.takeIf { it == "mobile" || it == "limits" }
      ?: return
    check(context.getSharedPreferences(NOTIFICATION_ACTION_STORE, Context.MODE_PRIVATE)
      .edit()
      .putString(DOOMSCROLLING_NOTIFICATION_ACTION_KEY, target)
      .commit()) { "Doomscrolling notification action could not be persisted" }
    intent.removeExtra(DOOMSCROLLING_NOTIFICATION_ACTION_KEY)
  }

  fun take(context: Context): String? {
    val preferences = context.getSharedPreferences(NOTIFICATION_ACTION_STORE, Context.MODE_PRIVATE)
    val target = preferences.getString(DOOMSCROLLING_NOTIFICATION_ACTION_KEY, null)
    check(preferences.edit().remove(DOOMSCROLLING_NOTIFICATION_ACTION_KEY).commit()) {
      "Doomscrolling notification action could not be cleared"
    }
    return target?.takeIf { it == "mobile" || it == "limits" }
  }
}

internal class DoomscrollingGuardianClient(private val context: Context) {
  fun applyRules(encoded: String) {
    call(METHOD_APPLY_RULES, Bundle().apply { putString(KEY_SNAPSHOT, encoded) })
  }

  fun invalidateRules() { call(METHOD_INVALIDATE_RULES) }

  fun pendingEvents(vaultId: String, usageOnly: Boolean): List<JournalEvent> {
    @Suppress("DEPRECATION")
    val values = call(METHOD_PENDING_EVENTS, Bundle().apply {
      putString(KEY_VAULT_ID, vaultId)
      putBoolean("usageOnly", usageOnly)
    }).getParcelableArrayList<Bundle>(KEY_EVENTS)
      ?: arrayListOf()
    return values.map { value -> value.toJournalEvent() }
  }

  fun accountingSnapshot(vaultId: String): String =
    call(METHOD_ACCOUNTING_SNAPSHOT, Bundle().apply { putString(KEY_VAULT_ID, vaultId) })
      .getString(KEY_SNAPSHOT) ?: error("Doomscrolling accounting snapshot is missing")

  fun acknowledgeEvents(ids: List<String>) {
    call(METHOD_ACKNOWLEDGE_EVENTS, Bundle().apply {
      putStringArrayList(KEY_IDS, ArrayList(ids))
    })
  }

  private fun call(method: String, extras: Bundle? = null): Bundle =
    context.contentResolver.call(uri(context), method, null, extras)
      ?: error("Doomscrolling guardian did not return a response")

  private fun Bundle.toJournalEvent(): JournalEvent = JournalEvent(
    id = requireString("id"),
    kind = requireString("kind"),
    packageName = requireString("packageName"),
    displayName = requireString("displayName"),
    startedAt = requireLong("startedAt"),
    elapsedSeconds = requireInt("elapsedSeconds"),
    localDate = requireString("localDate"),
    occurredAt = requireLong("occurredAt"),
    reason = getString("reason"),
    ruleId = getString("ruleId"),
    runId = getString("runId"),
    phase = getString("phase"),
    vaultId = requireString("vaultId"),
  )

  private fun Bundle.requireString(key: String): String =
    getString(key)?.takeIf(String::isNotBlank)
      ?: error("Doomscrolling guardian returned an invalid event")

  private fun Bundle.requireLong(key: String): Long {
    require(containsKey(key)) { "Doomscrolling guardian returned an invalid event" }
    return getLong(key)
  }

  private fun Bundle.requireInt(key: String): Int {
    require(containsKey(key)) { "Doomscrolling guardian returned an invalid event" }
    return getInt(key)
  }

  companion object {
    private fun uri(context: Context): Uri = Uri.Builder()
      .scheme("content")
      .authority(context.packageName + GUARDIAN_AUTHORITY_SUFFIX)
      .build()
  }
}

/** Owns mobile Doomscrolling runtime state inside Ganbaru AI's guardian process. */
class DoomscrollingGuardianProvider : ContentProvider() {
  override fun onCreate(): Boolean = true

  override fun call(method: String, arg: String?, extras: Bundle?): Bundle {
    val appContext = requireNotNull(context).applicationContext
    return synchronized(DOOMSCROLLING_GUARDIAN_LOCK) {
      when (method) {
        METHOD_INVALIDATE_RULES -> {
          DoomscrollingRuntimeStore.invalidateRules(appContext)
          Bundle.EMPTY
        }
        METHOD_APPLY_RULES -> {
          DoomscrollingRuntimeStore.saveRules(appContext, extras.requireString(KEY_SNAPSHOT))
          appContext.sendBroadcast(Intent(ACTION_DOOMSCROLLING_RULES_CHANGED).apply {
            setPackage(appContext.packageName)
          }, guardianPermission(appContext))
          Bundle.EMPTY
        }
        METHOD_PENDING_EVENTS -> Bundle().apply {
          putParcelableArrayList(
            KEY_EVENTS,
            ArrayList(DoomscrollingJournal(appContext).use { journal ->
              journal.pending(extras.requireVaultId(), extras?.getBoolean("usageOnly", false) ?: false)
                .map { event -> event.toBundle() }
            }),
          )
        }
        METHOD_ACCOUNTING_SNAPSHOT -> {
          val vaultId = extras.requireVaultId()
          val observedAt = System.currentTimeMillis()
          val observedLocal = Instant.ofEpochMilli(observedAt).atZone(ZoneId.systemDefault())
          val date = observedLocal.toLocalDate()
          val week = date.minusDays((date.dayOfWeek.value - 1).toLong()).toString()
          val journalVaultId = DoomscrollingRuntimeStore.journalVaultId(appContext)
          val encoded = DoomscrollingJournal(appContext).use { journal ->
            JSONObject().apply {
              put("vaultId", vaultId)
              put("journalVaultId", journalVaultId ?: JSONObject.NULL)
              put("copy", DoomscrollingRuntimeStore.notificationCopy(appContext) ?: JSONObject.NULL)
              put("observedAtEpochMs", observedAt)
              put("utcOffsetSeconds", observedLocal.offset.totalSeconds)
              put("localDate", date.toString())
              put("weekStartLocalDate", week)
              put("localSources", JSONArray().apply {
                if (journalVaultId == vaultId) for ((packageName, localDate, seconds) in journal.accountingTotals(week, date.toString())) {
                  put(JSONObject().apply {
                    put("sourceType", "mobile-app")
                    put("sourceKey", packageName)
                    put("localDate", localDate)
                    put("elapsedSeconds", seconds)
                  })
                }
              })
              put("pending", JSONArray(journal.accountingPending(vaultId, week, date.toString()).map { JSONObject(it.toResponse()) }))
            }.toString()
          }
          require(encoded.toByteArray().size <= MAX_ACCOUNTING_BYTES) {
            "Doomscrolling accounting snapshot exceeds its byte limit"
          }
          Bundle().apply { putString(KEY_SNAPSHOT, encoded) }
        }
        METHOD_ACKNOWLEDGE_EVENTS -> {
          val ids = extras?.getStringArrayList(KEY_IDS) ?: arrayListOf()
          require(ids.size <= 500) { "Too many Doomscrolling event acknowledgements" }
          require(ids.all { it.length in 1..120 }) { "Doomscrolling event ID is invalid" }
          DoomscrollingJournal(appContext).acknowledge(ids)
          Bundle.EMPTY
        }
        else -> error("Unknown Doomscrolling guardian operation")
      }
    }
  }

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor? = unsupported()

  override fun getType(uri: Uri): String? = unsupported()

  override fun insert(uri: Uri, values: ContentValues?): Uri? = unsupported()

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int =
    unsupported()

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<out String>?,
  ): Int = unsupported()

  private fun JournalEvent.toBundle(): Bundle = Bundle().apply {
    putString("id", id)
    putString("kind", kind)
    putString("packageName", packageName)
    putString("displayName", displayName)
    putLong("startedAt", startedAt)
    putInt("elapsedSeconds", elapsedSeconds)
    putString("localDate", localDate)
    putLong("occurredAt", occurredAt)
    putString("reason", reason)
    putString("ruleId", ruleId)
    putString("runId", runId)
    putString("phase", phase)
    putString("vaultId", vaultId)
  }

  private fun <T> unsupported(): T = throw UnsupportedOperationException(
    "Doomscrolling guardian supports private call operations only",
  )

  private fun Bundle?.requireString(key: String): String =
    this?.getString(key)?.takeIf(String::isNotBlank)
      ?: error("Doomscrolling guardian argument is missing")

  private fun Bundle?.requireVaultId(): String = requireString(KEY_VAULT_ID).also {
    require(it.length in 1..128) { "Doomscrolling vault ID is invalid" }
  }

  companion object {
    private const val MAX_ACCOUNTING_BYTES = 512 * 1024
  }
}

internal fun guardianPermission(context: Context): String =
  "${context.packageName}.permission.INTERNAL_GUARDIAN"
