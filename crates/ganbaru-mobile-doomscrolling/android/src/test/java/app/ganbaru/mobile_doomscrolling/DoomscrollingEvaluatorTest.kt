package app.ganbaru.mobile_doomscrolling

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DoomscrollingEvaluatorTest {
  @Test
  fun acceptedCombinedUsageAddsOnlyNewOfflineLocalUsage() {
    assertEquals(75, combinedUsageSinceAcceptance(60, 20, 35))
    assertEquals(60, combinedUsageSinceAcceptance(60, 20, 10))
  }

  private val schedule = MobileSchedule(
    enabled = true,
    blockDuringFocus = true,
    blockDuringShortBreaks = false,
    blockDuringLongBreaks = true,
    pauseDuringFocusPause = true,
    blockedApps = listOf(
      MobileAppRule("YouTube", "com.google.android.youtube", enabled = true),
    ),
  )

  @Test
  fun blocksSelectedAppDuringEnabledActivePhase() {
    assertTrue(DoomscrollingEvaluator.evaluateSchedule(
      schedule,
      phase(phase = "focus"),
      "com.google.android.youtube",
      NOW,
    ))
  }

  @Test
  fun followsPerPhaseSchedule() {
    assertFalse(DoomscrollingEvaluator.evaluateSchedule(
      schedule,
      phase(phase = "short_break"),
      "com.google.android.youtube",
      NOW,
    ))
    assertTrue(DoomscrollingEvaluator.evaluateSchedule(
      schedule,
      phase(phase = "long_break"),
      "com.google.android.youtube",
      NOW,
    ))
  }

  @Test
  fun failsOpenForPausedOrExpiredProjection() {
    assertFalse(DoomscrollingEvaluator.evaluateSchedule(
      schedule,
      phase(phase = "focus", running = false),
      "com.google.android.youtube",
      NOW,
    ))
    assertFalse(DoomscrollingEvaluator.evaluateSchedule(
      schedule,
      phase(phase = "focus", validUntilEpochMs = NOW),
      "com.google.android.youtube",
      NOW,
    ))
  }

  @Test
  fun ignoresAppsWithoutAnEnabledExactPackageRule() {
    assertFalse(DoomscrollingEvaluator.evaluateSchedule(
      schedule,
      phase(phase = "focus"),
      "com.example.video",
      NOW,
    ))
    assertFalse(DoomscrollingEvaluator.evaluateSchedule(
      schedule.copy(blockedApps = schedule.blockedApps.map { it.copy(enabled = false) }),
      phase(phase = "focus"),
      "com.google.android.youtube",
      NOW,
    ))
  }

  @Test
  fun recoveryObservesScheduledAppsWithoutCountingThemAsLimitUsage() {
    val rules = rules(
      limitsEnabled = true,
      limits = listOf(MobileLimit(
        id = "video",
        name = "Video",
        enabled = true,
        minutesPerDay = 60,
        minutesPerWeek = null,
        packages = setOf("com.example.video"),
      )),
    )

    val scope = DoomscrollingRecovery.scope(rules)

    assertEquals(setOf("com.example.video"), scope.usagePackages)
    assertEquals(
      setOf("com.example.video", "com.google.android.youtube"),
      scope.observedPackages,
    )
  }

  @Test
  fun recoveryExcludesDisabledRulesAndUsesThreeDayEventWindow() {
    val rules = rules(
      limitsEnabled = false,
      schedule = schedule.copy(
        blockedApps = schedule.blockedApps + MobileAppRule(
          "Disabled",
          "com.example.disabled",
          enabled = false,
        ),
      ),
    )

    val scope = DoomscrollingRecovery.scope(rules)

    assertTrue(scope.usagePackages.isEmpty())
    assertEquals(setOf("com.google.android.youtube"), scope.observedPackages)
    assertEquals(NOW - 3 * 24 * 60 * 60 * 1_000L, DoomscrollingRecovery.queryStart(NOW))
    assertEquals(0L, DoomscrollingRecovery.queryStart(1_000L))
    assertEquals(NOW - 5_000L, DoomscrollingRecovery.incrementalQueryStart(NOW))
    assertEquals(0L, DoomscrollingRecovery.incrementalQueryStart(1_000L))
  }

  private fun phase(
    phase: String,
    running: Boolean = true,
    validUntilEpochMs: Long = NOW + 60_000L,
  ) = PomodoroPhaseState(
    active = true,
    runId = "run-1",
    phase = phase,
    running = running,
    validUntilEpochMs = validUntilEpochMs,
  )

  private fun rules(
    limitsEnabled: Boolean,
    limits: List<MobileLimit> = emptyList(),
    schedule: MobileSchedule = this.schedule,
  ) = DoomscrollingRulesSnapshot(
    vaultId = "vault-1",
    revision = "revision-1",
    generatedAtEpochMs = NOW,
    mobile = schedule,
    limitsEnabled = limitsEnabled,
    limits = limits,
    copy = DoomscrollingCopy(
      channelName = "Doomscrolling",
      channelDescription = "Doomscrolling",
      blockedMessage = "Blocked",
      limitMessage = "Limit reached",
    ),
  )

  private companion object {
    const val NOW = 1_788_041_200_000L
  }
}
