# Media3 keeps its public session and player APIs through consumer rules.
-keep class org.opengrimoire.ganbaruai.mobile.media.NativeMusicAuthority {
    public static native boolean isCurrent(long);
}
-keep class org.opengrimoire.ganbaruai.mobile.media.NativeMusicSession {
    public static boolean isActive();
    public static boolean dispatch(java.lang.String);
    public static boolean cancelDelivery(long);
}
