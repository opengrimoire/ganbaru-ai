package org.opengrimoire.ganbaruai.mobile.media

import android.util.Log

/** Final cached native check, independent of Activity and WebView execution. */
internal object NativeMusicAuthority {
  @JvmStatic external fun isCurrent(deliveryId: Long): Boolean

  fun requireCurrent(deliveryId: Long) {
    check(current(deliveryId)) { "Android Music delivery is canceled or its authority changed" }
  }

  fun current(deliveryId: Long): Boolean {
    if (deliveryId <= 0) return false
    return try { isCurrent(deliveryId) }
    catch (error: LinkageError) { Log.e("GanbaruMusic", "Native Music authority is unavailable", error); false }
  }
}
