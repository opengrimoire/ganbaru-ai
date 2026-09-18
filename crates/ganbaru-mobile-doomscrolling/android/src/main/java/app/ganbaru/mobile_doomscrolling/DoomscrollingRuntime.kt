package app.ganbaru.mobile_doomscrolling

import android.app.AppOpsManager
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Process
import android.provider.Settings
import android.telecom.TelecomManager
import android.view.accessibility.AccessibilityManager
import java.time.Instant
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject

internal const val ACTION_DOOMSCROLLING_PHASE = "app.ganbaru.intent.action.DOOMSCROLLING_PHASE"
internal const val ACTION_DOOMSCROLLING_PHASE_CLEAR =
  "app.ganbaru.intent.action.DOOMSCROLLING_PHASE_CLEAR"
internal const val ACTION_DOOMSCROLLING_RULES_CHANGED =
  "app.ganbaru.intent.action.DOOMSCROLLING_RULES_CHANGED"
private const val RUNTIME_STORE = "GANBARU_DOOMSCROLLING_RUNTIME"
private const val RULES_KEY = "rules"
private const val RULES_VAULT_ID_KEY = "rulesVaultId"
private const val PHASE_ACTIVE_KEY = "phaseActive"
private const val PHASE_RUN_ID_KEY = "phaseRunId"
private const val PHASE_KIND_KEY = "phaseKind"
private const val PHASE_RUNNING_KEY = "phaseRunning"
private const val PHASE_VALID_UNTIL_KEY = "phaseValidUntil"
private const val NOTIFICATION_TIMESTAMPS_KEY = "notificationTimestamps"
private const val COMBINED_USAGE_BASELINES_KEY = "combinedUsageBaselines"
private const val BLOCK_CHANNEL_ID = "doomscrolling-blocks-v1"
private const val BLOCK_NOTIFICATION_BASE_ID = 1_500_100_000

internal object DoomscrollingRuntimeStore {
  fun saveRules(context: Context, encoded: String) {
    val next = DoomscrollingRuleCodec.decode(encoded)
    val prefs = preferences(context)
    val previousVaultId = prefs.getString(RULES_VAULT_ID_KEY, null)
    val incompletePreviousRules = prefs.contains(RULES_KEY) && previousVaultId == null
    if (incompletePreviousRules || (previousVaultId != null && previousVaultId != next.vaultId)) {
      DoomscrollingJournal(context).clearTotalsAndCheckpoints()
    }
    val baselines = JSONObject().apply {
      put("revision", next.revision)
      put("items", JSONArray().apply {
        val journal = DoomscrollingJournal(context)
        for (limit in next.limits) {
          for ((period, accepted) in listOf(
            "day" to limit.acceptedDailyUsage,
            "week" to limit.acceptedWeeklyUsage,
          )) {
            if (accepted == null) continue
            put(JSONObject().apply {
              put("limitId", limit.id)
              put("period", period)
              put("windowStartLocalDate", accepted.windowStartLocalDate)
              put("windowEndLocalDate", accepted.windowEndLocalDate)
              put("acceptedUsedSeconds", accepted.usedSeconds)
              put("localUsedSeconds", journal.usedSeconds(
                limit.packages,
                accepted.windowStartLocalDate,
                accepted.windowEndLocalDate,
              ))
            })
          }
        }
      })
    }
    check(prefs.edit()
      .putString(RULES_KEY, encoded)
      .putString(RULES_VAULT_ID_KEY, next.vaultId)
      .putString(COMBINED_USAGE_BASELINES_KEY, baselines.toString())
      .commit()) { "Doomscrolling rule snapshot could not be persisted" }
  }

  fun rules(context: Context): DoomscrollingRulesSnapshot? {
    val encoded = preferences(context).getString(RULES_KEY, null) ?: return null
    return try {
      DoomscrollingRuleCodec.decode(encoded)
    } catch (_: Exception) {
      null
    }
  }

  fun combinedUsedSeconds(
    context: Context,
    rules: DoomscrollingRulesSnapshot,
    limit: MobileLimit,
    period: String,
    accepted: AcceptedUsage,
    currentLocalUsedSeconds: Int,
  ): Int {
    val encoded = preferences(context).getString(COMBINED_USAGE_BASELINES_KEY, null)
      ?: return currentLocalUsedSeconds
    val baseline = runCatching {
      val root = JSONObject(encoded)
      if (root.getString("revision") != rules.revision) return@runCatching null
      val items = root.getJSONArray("items")
      (0 until items.length()).asSequence()
        .map(items::getJSONObject)
        .firstOrNull {
          it.getString("limitId") == limit.id &&
            it.getString("period") == period &&
            it.getString("windowStartLocalDate") == accepted.windowStartLocalDate &&
            it.getString("windowEndLocalDate") == accepted.windowEndLocalDate
        }
    }.getOrNull() ?: return currentLocalUsedSeconds
    val acceptedUsed = baseline.getInt("acceptedUsedSeconds")
    val localAtAcceptance = baseline.getInt("localUsedSeconds")
    return combinedUsageSinceAcceptance(acceptedUsed, localAtAcceptance, currentLocalUsedSeconds)
  }

  fun savePhase(
    context: Context,
    runId: String,
    phase: String,
    running: Boolean,
    validUntilEpochMs: Long,
  ): Boolean {
    if (runId.isBlank() || runId.length > 128
      || phase !in setOf("focus", "short_break", "long_break")
      || validUntilEpochMs <= 0L
    ) {
      clearPhase(context)
      return false
    }
    check(preferences(context).edit()
      .putBoolean(PHASE_ACTIVE_KEY, true)
      .putString(PHASE_RUN_ID_KEY, runId)
      .putString(PHASE_KIND_KEY, phase)
      .putBoolean(PHASE_RUNNING_KEY, running)
      .putLong(PHASE_VALID_UNTIL_KEY, validUntilEpochMs)
      .commit()) { "Doomscrolling phase state could not be persisted" }
    return true
  }

  fun clearPhase(context: Context) {
    check(preferences(context).edit()
      .remove(PHASE_ACTIVE_KEY)
      .remove(PHASE_RUN_ID_KEY)
      .remove(PHASE_KIND_KEY)
      .remove(PHASE_RUNNING_KEY)
      .remove(PHASE_VALID_UNTIL_KEY)
      .commit()) { "Doomscrolling phase state could not be cleared" }
  }

  fun updatePhaseFromIntent(context: Context, intent: Intent): Boolean {
    if (intent.action == ACTION_DOOMSCROLLING_PHASE_CLEAR) {
      clearPhase(context)
      return true
    }
    if (intent.action != ACTION_DOOMSCROLLING_PHASE) return false
    return savePhase(
      context = context,
      runId = intent.getStringExtra("runId").orEmpty(),
      phase = intent.getStringExtra("phase").orEmpty(),
      running = intent.getBooleanExtra("running", false),
      validUntilEpochMs = intent.getLongExtra("validUntilEpochMs", 0L),
    )
  }

  fun phase(context: Context): PomodoroPhaseState? {
    val prefs = preferences(context)
    if (!prefs.getBoolean(PHASE_ACTIVE_KEY, false)) return null
    return PomodoroPhaseState(
      active = true,
      runId = prefs.getString(PHASE_RUN_ID_KEY, null),
      phase = prefs.getString(PHASE_KIND_KEY, null),
      running = prefs.getBoolean(PHASE_RUNNING_KEY, false),
      validUntilEpochMs = prefs.getLong(PHASE_VALID_UNTIL_KEY, 0L),
    )
  }

  fun allowNotification(context: Context, nowEpochMs: Long): Boolean {
    val prefs = preferences(context)
    val recent = prefs.getString(NOTIFICATION_TIMESTAMPS_KEY, "")
      .orEmpty()
      .split(',')
      .mapNotNull(String::toLongOrNull)
      .filter { nowEpochMs - it < 60_000L }
    if (recent.size >= 5) return false
    prefs.edit().putString(
      NOTIFICATION_TIMESTAMPS_KEY,
      (recent + nowEpochMs).joinToString(","),
    ).apply()
    return true
  }

  private fun preferences(context: Context) = context.getSharedPreferences(
    RUNTIME_STORE,
    Context.MODE_PRIVATE,
  )
}

class DoomscrollingPhaseReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    synchronized(DOOMSCROLLING_GUARDIAN_LOCK) {
      DoomscrollingRuntimeStore.updatePhaseFromIntent(context, intent)
    }
  }
}

internal object DoomscrollingAccess {
  fun hasUsageAccess(context: Context): Boolean {
    val manager = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    return manager.checkOpNoThrow(
      AppOpsManager.OPSTR_GET_USAGE_STATS,
      Process.myUid(),
      context.packageName,
    ) == AppOpsManager.MODE_ALLOWED
  }

  fun hasAccessibilityAccess(context: Context): Boolean {
    val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
    return manager.getEnabledAccessibilityServiceList(
      android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK,
    ).any { info ->
      val serviceInfo = info.resolveInfo?.serviceInfo ?: return@any false
      serviceInfo.name == DoomscrollingAccessibilityService::class.java.name
        || serviceInfo.name.endsWith(".DoomscrollingAccessibilityService")
    }
  }
}

internal object ProtectedPackages {
  fun resolve(context: Context): Set<String> {
    val manager = context.packageManager
    val packages = mutableSetOf(context.packageName, "android")
    resolve(manager, Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME))?.let(packages::add)
    resolve(manager, Intent(Settings.ACTION_SETTINGS))?.let(packages::add)
    resolve(manager, Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))?.let(packages::add)
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
    telecom?.defaultDialerPackage?.let(packages::add)
    return packages
  }

  fun isProtected(context: Context, packageName: String): Boolean {
    if (packageName in resolve(context)) return true
    val info = try {
      context.packageManager.getApplicationInfo(packageName, 0)
    } catch (_: PackageManager.NameNotFoundException) {
      return true
    }
    return info.uid < Process.FIRST_APPLICATION_UID
  }

  private fun resolve(manager: PackageManager, intent: Intent): String? =
    manager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
}

internal data class DoomscrollingRecoveryScope(
  val usagePackages: Set<String>,
  val observedPackages: Set<String>,
)

internal object DoomscrollingRecovery {
  private const val EVENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1_000L
  private const val EVENT_DELIVERY_OVERLAP_MS = 5_000L

  fun scope(rules: DoomscrollingRulesSnapshot): DoomscrollingRecoveryScope {
    val usagePackages = if (rules.limitsEnabled) {
      rules.limits.filter { it.enabled }.flatMapTo(mutableSetOf()) { it.packages }
    } else {
      mutableSetOf()
    }
    val observedPackages = rules.mobile.blockedApps
      .filterTo(mutableListOf()) { it.enabled }
      .mapTo(usagePackages.toMutableSet()) { it.packageName.lowercase() }
    return DoomscrollingRecoveryScope(usagePackages, observedPackages)
  }

  fun queryStart(nowEpochMs: Long): Long = (nowEpochMs - EVENT_WINDOW_MS).coerceAtLeast(0L)

  fun incrementalQueryStart(observedThroughEpochMs: Long): Long =
    (observedThroughEpochMs - EVENT_DELIVERY_OVERLAP_MS).coerceAtLeast(0L)
}

internal class DoomscrollingEngine(private val context: Context) {
  private val journal = DoomscrollingJournal(context)
  private var observationState: UsageObservationState? = null
  private var observationScope: DoomscrollingRecoveryScope? = null
  private var observedThroughEpochMs: Long = 0L
  private var lastBlockedPackage: String? = null
  private var lastBlockedAt: Long = 0L

  fun onAccessibilityPackage(packageName: String, nowEpochMs: Long): Boolean {
    val rules = prepareObservation(nowEpochMs) ?: return false
    if (ProtectedPackages.isProtected(context, packageName)) return false
    val decision = evaluate(rules, packageName, nowEpochMs)
    if (!decision.blocked) return false
    return enforce(packageName, rules, decision, nowEpochMs)
  }

  fun onCheckpoint(nowEpochMs: Long): Boolean {
    val rules = prepareObservation(nowEpochMs) ?: return false
    val visiblePackages = observationState?.visibleActivities?.keys.orEmpty()
    if (!isInteractiveAndUnlocked()) return false
    for (packageName in visiblePackages.sorted()) {
      if (ProtectedPackages.isProtected(context, packageName)) continue
      val decision = evaluate(rules, packageName, nowEpochMs)
      if (decision.blocked) return enforce(packageName, rules, decision, nowEpochMs)
    }
    return false
  }

  private fun enforce(
    packageName: String,
    rules: DoomscrollingRulesSnapshot,
    decision: BlockDecision,
    nowEpochMs: Long,
  ): Boolean {
    if (lastBlockedPackage == packageName && nowEpochMs - lastBlockedAt < 1_500L) return true
    lastBlockedPackage = packageName
    lastBlockedAt = nowEpochMs
    val displayName = appLabel(packageName)
    val phase = DoomscrollingRuntimeStore.phase(context)
    journal.recordBlock(
      packageName,
      displayName,
      nowEpochMs,
      decision.reason ?: "rule",
      decision.ruleId,
      phase?.runId,
      phase?.phase,
      rules.vaultId,
    )
    notifyBlocked(rules, packageName, displayName, decision, nowEpochMs)
    return true
  }

  private fun prepareObservation(nowEpochMs: Long): DoomscrollingRulesSnapshot? {
    if (!DoomscrollingAccess.hasUsageAccess(context)) {
      resetObservation()
      return null
    }
    val rules = DoomscrollingRuntimeStore.rules(context) ?: run {
      resetObservation()
      return null
    }
    val scope = DoomscrollingRecovery.scope(rules)
    val lastObserved = (journal.metadata("lastObservedEpochMs") ?: nowEpochMs)
      .coerceIn(0L, nowEpochMs)
    val mustRebuild = observationState == null
      || observationScope != scope
      || observedThroughEpochMs > nowEpochMs
      || lastObserved < observedThroughEpochMs
    val queryStart = if (mustRebuild) {
      DoomscrollingRecovery.queryStart(nowEpochMs)
    } else {
      DoomscrollingRecovery.incrementalQueryStart(observedThroughEpochMs)
    }
    val initialState = if (mustRebuild) UsageObservationState() else checkNotNull(observationState)
    val result = if (nowEpochMs > queryStart) {
      DoomscrollingUsageObserver.reconcile(
        initialState = initialState,
        events = queryUsageEvents(queryStart, nowEpochMs),
        observedPackages = scope.observedPackages,
        usagePackages = scope.usagePackages,
        intervalStartEpochMs = lastObserved,
        intervalEndEpochMs = nowEpochMs,
      )
    } else {
      UsageObservationResult(
        state = initialState,
        intervals = emptyList(),
        visiblePackages = initialState.visibleActivities.keys,
      )
    }
    val usageIntervals = result.intervals.map { interval ->
      JournalUsageInterval(
        packageName = interval.packageName,
        displayName = appLabel(interval.packageName),
        startedAt = interval.startedAtEpochMs,
        endedAt = interval.endedAtEpochMs,
      )
    }
    journal.recordUsageBatch(rules.vaultId, usageIntervals, nowEpochMs)
    val power = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
    val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    observationState = result.state.withDeviceState(
      screenInteractive = power.isInteractive,
      keyguardVisible = keyguard.isKeyguardLocked,
    )
    observationScope = scope
    observedThroughEpochMs = nowEpochMs
    return rules
  }

  private fun queryUsageEvents(
    startedAtEpochMs: Long,
    endedAtEpochMs: Long,
  ): List<UsageObservationEvent> {
    val usageEvents = (context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager)
      .queryEvents(startedAtEpochMs, endedAtEpochMs)
      ?: error("Android usage events were unavailable")
    val observations = mutableListOf<UsageObservationEvent>()
    val event = UsageEvents.Event()
    while (usageEvents.hasNextEvent()) {
      usageEvents.getNextEvent(event)
      val kind = eventKind(event.eventType) ?: continue
      observations += UsageObservationEvent(
        packageName = event.packageName?.lowercase(),
        activityName = event.className,
        kind = kind,
        timestampEpochMs = event.timeStamp,
      )
    }
    return observations
  }

  private fun eventKind(eventType: Int): UsageObservationEventKind? = when (eventType) {
    UsageEvents.Event.ACTIVITY_RESUMED -> UsageObservationEventKind.ACTIVITY_RESUMED
    UsageEvents.Event.ACTIVITY_PAUSED -> UsageObservationEventKind.ACTIVITY_PAUSED
    UsageEvents.Event.ACTIVITY_STOPPED -> UsageObservationEventKind.ACTIVITY_STOPPED
    USAGE_EVENT_END_OF_DAY,
    USAGE_EVENT_CONTINUE_PREVIOUS_DAY,
    -> UsageObservationEventKind.ACTIVITY_VISIBLE_ROLLOVER
    UsageEvents.Event.SCREEN_INTERACTIVE -> UsageObservationEventKind.SCREEN_INTERACTIVE
    UsageEvents.Event.SCREEN_NON_INTERACTIVE -> UsageObservationEventKind.SCREEN_NON_INTERACTIVE
    UsageEvents.Event.KEYGUARD_SHOWN -> UsageObservationEventKind.KEYGUARD_SHOWN
    UsageEvents.Event.KEYGUARD_HIDDEN -> UsageObservationEventKind.KEYGUARD_HIDDEN
    UsageEvents.Event.DEVICE_SHUTDOWN -> UsageObservationEventKind.DEVICE_SHUTDOWN
    UsageEvents.Event.DEVICE_STARTUP -> UsageObservationEventKind.DEVICE_STARTUP
    else -> null
  }

  private fun resetObservation() {
    observationState = null
    observationScope = null
    observedThroughEpochMs = 0L
  }

  private fun evaluate(
    rules: DoomscrollingRulesSnapshot,
    packageName: String,
    nowEpochMs: Long,
  ): BlockDecision {
    if (DoomscrollingEvaluator.evaluateSchedule(
        rules.mobile,
        DoomscrollingRuntimeStore.phase(context),
        packageName,
        nowEpochMs,
      )) {
      return BlockDecision(true, "schedule", null)
    }
    if (!rules.limitsEnabled) return BlockDecision(false)
    val localDate = localDate(nowEpochMs)
    val weekStart = Instant.ofEpochMilli(nowEpochMs).atZone(ZoneId.systemDefault())
      .toLocalDate().minusDays((Instant.ofEpochMilli(nowEpochMs).atZone(ZoneId.systemDefault())
        .dayOfWeek.value - 1).toLong()).toString()
    for (limit in rules.limits) {
      if (!limit.enabled || packageName.lowercase() !in limit.packages) continue
      val dailyExhausted = limit.minutesPerDay?.let {
        val localUsed = journal.usedSeconds(limit.packages, localDate, localDate)
        val combinedUsed = limit.acceptedDailyUsage
          ?.takeIf { accepted ->
            accepted.windowStartLocalDate == localDate && accepted.windowEndLocalDate == localDate
          }
          ?.let { accepted ->
            DoomscrollingRuntimeStore.combinedUsedSeconds(
              context,
              rules,
              limit,
              "day",
              accepted,
              localUsed,
            )
          } ?: localUsed
        combinedUsed >= it * 60
      } ?: false
      val weeklyExhausted = limit.minutesPerWeek?.let {
        val localUsed = journal.usedSeconds(limit.packages, weekStart, localDate)
        val combinedUsed = limit.acceptedWeeklyUsage
          ?.takeIf { accepted ->
            accepted.windowStartLocalDate == weekStart && accepted.windowEndLocalDate == localDate
          }
          ?.let { accepted ->
            DoomscrollingRuntimeStore.combinedUsedSeconds(
              context,
              rules,
              limit,
              "week",
              accepted,
              localUsed,
            )
          } ?: localUsed
        combinedUsed >= it * 60
      } ?: false
      if (dailyExhausted || weeklyExhausted) {
        return BlockDecision(true, "usage_limit", limit.id)
      }
    }
    return BlockDecision(false)
  }

  private fun notifyBlocked(
    rules: DoomscrollingRulesSnapshot,
    packageName: String,
    displayName: String,
    decision: BlockDecision,
    nowEpochMs: Long,
  ) {
    if (!DoomscrollingRuntimeStore.allowNotification(context, nowEpochMs)) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(
      NotificationChannel(
        BLOCK_CHANNEL_ID,
        rules.copy.channelName,
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply { description = rules.copy.channelDescription },
    )
    val target = if (decision.reason == "usage_limit") "limits" else "mobile"
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra(DOOMSCROLLING_NOTIFICATION_ACTION_KEY, target)
    }
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        context,
        BLOCK_NOTIFICATION_BASE_ID + packageName.hashCode(),
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val body = if (decision.reason == "usage_limit") {
      rules.copy.limitMessage
    } else {
      rules.copy.blockedMessage
    }
    manager.notify(
      BLOCK_NOTIFICATION_BASE_ID + (packageName.hashCode() and 0xFFFF),
      Notification.Builder(context, BLOCK_CHANNEL_ID)
        .setSmallIcon(notificationIcon())
        .setContentTitle(displayName)
        .setContentText(body)
        .setCategory(Notification.CATEGORY_STATUS)
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setContentIntent(contentIntent)
        .setAutoCancel(true)
        .build(),
    )
  }

  private fun isInteractiveAndUnlocked(): Boolean {
    val power = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
    val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    return power.isInteractive && !keyguard.isKeyguardLocked
  }

  private fun appLabel(packageName: String): String = try {
    val info = context.packageManager.getApplicationInfo(packageName, 0)
    context.packageManager.getApplicationLabel(info).toString().trim().take(120)
      .ifBlank { packageName }
  } catch (_: PackageManager.NameNotFoundException) {
    packageName
  }

  private fun localDate(epochMs: Long): String = Instant.ofEpochMilli(epochMs)
    .atZone(ZoneId.systemDefault()).toLocalDate().toString()

  private fun notificationIcon(): Int = context.resources.getIdentifier(
    "ic_notification_focus",
    "drawable",
    context.packageName,
  ).takeIf { it != 0 } ?: context.applicationInfo.icon

  private companion object {
    const val USAGE_EVENT_END_OF_DAY = 3
    const val USAGE_EVENT_CONTINUE_PREVIOUS_DAY = 4
  }
}
