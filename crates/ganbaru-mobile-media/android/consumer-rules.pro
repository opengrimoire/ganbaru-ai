# Media3 keeps its public session and player APIs through consumer rules.
-keep class app.ganbaru.mobile_media.NativeMusicAuthority {
    public static native boolean isCurrent(long);
}
-keep class app.ganbaru.mobile_media.NativeMusicSession {
    public static boolean isActive();
    public static boolean dispatch(java.lang.String);
    public static boolean cancelDelivery(long);
}
