# Ganbaru AI mobile notification bridge consumer rules.

# The private JNI export uses this exact class and static method name.
-keep class app.ganbaru.mobile_notifications.NativeFocusAuthority {
    public static native boolean isCurrent(long, long, long);
    public static native boolean isProcessCurrent(long);
}
