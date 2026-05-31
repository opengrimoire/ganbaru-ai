use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[cfg(any(target_os = "windows", test))]
const VK_TAB_CODE: u32 = 0x09;
#[cfg(any(target_os = "windows", test))]
const VK_ESCAPE_CODE: u32 = 0x1B;
#[cfg(any(target_os = "windows", test))]
const VK_SPACE_CODE: u32 = 0x20;
#[cfg(any(target_os = "windows", test))]
const VK_DELETE_CODE: u32 = 0x2E;
#[cfg(any(target_os = "windows", test))]
const VK_0_CODE: u32 = 0x30;
#[cfg(any(target_os = "windows", test))]
const VK_9_CODE: u32 = 0x39;
#[cfg(any(target_os = "windows", test))]
const VK_D_CODE: u32 = 0x44;
#[cfg(any(target_os = "windows", test))]
const VK_E_CODE: u32 = 0x45;
#[cfg(any(target_os = "windows", test))]
const VK_F4_CODE: u32 = 0x73;
#[cfg(any(target_os = "windows", test))]
const VK_L_CODE: u32 = 0x4C;
#[cfg(any(target_os = "windows", test))]
const VK_M_CODE: u32 = 0x4D;
#[cfg(any(target_os = "windows", test))]
const VK_R_CODE: u32 = 0x52;
#[cfg(any(target_os = "windows", test))]
const VK_LWIN_CODE: u32 = 0x5B;
#[cfg(any(target_os = "windows", test))]
const VK_RWIN_CODE: u32 = 0x5C;

#[cfg(any(target_os = "macos", test))]
const MAC_PRESENTATION_HIDE_DOCK: u64 = 1 << 1;
#[cfg(any(target_os = "macos", test))]
const MAC_PRESENTATION_HIDE_MENU_BAR: u64 = 1 << 3;
#[cfg(any(target_os = "macos", test))]
const MAC_PRESENTATION_DISABLE_PROCESS_SWITCHING: u64 = 1 << 5;
#[cfg(any(target_os = "macos", test))]
const MAC_PRESENTATION_DISABLE_FORCE_QUIT: u64 = 1 << 6;
#[cfg(any(target_os = "macos", test))]
const MAC_PRESENTATION_DISABLE_SESSION_TERMINATION: u64 = 1 << 7;
#[cfg(any(target_os = "macos", test))]
const MAC_PRESENTATION_DISABLE_HIDE_APPLICATION: u64 = 1 << 8;
#[cfg(any(target_os = "macos", test))]
const MAC_PRESENTATION_FULL_SCREEN: u64 = 1 << 10;
#[cfg(any(target_os = "macos", test))]
const MAC_APPROVED_PRESENTATION_BITS: u64 = MAC_PRESENTATION_HIDE_DOCK
    | MAC_PRESENTATION_HIDE_MENU_BAR
    | MAC_PRESENTATION_DISABLE_PROCESS_SWITCHING
    | MAC_PRESENTATION_DISABLE_FORCE_QUIT
    | MAC_PRESENTATION_DISABLE_SESSION_TERMINATION
    | MAC_PRESENTATION_DISABLE_HIDE_APPLICATION
    | MAC_PRESENTATION_FULL_SCREEN;

trait EnforcementCleanup: Send {
    fn stop(&mut self) -> Result<(), String>;
}

impl<F> EnforcementCleanup for F
where
    F: FnMut() -> Result<(), String> + Send,
{
    fn stop(&mut self) -> Result<(), String> {
        self()
    }
}

pub(crate) struct OverlayEnforcementGuard {
    labels: Vec<String>,
    primary_label: String,
    cleanup: Vec<Box<dyn EnforcementCleanup>>,
    stopped: bool,
}

impl OverlayEnforcementGuard {
    fn new(labels: &[String], primary_label: &str) -> Self {
        Self {
            labels: labels.to_vec(),
            primary_label: primary_label.to_string(),
            cleanup: Vec::new(),
            stopped: false,
        }
    }

    pub(crate) fn set_window_labels(&mut self, labels: Vec<String>, primary_label: &str) {
        self.labels = labels;
        self.primary_label = primary_label.to_string();
    }

    pub(crate) fn push_cleanup<F>(&mut self, cleanup: F)
    where
        F: FnMut() -> Result<(), String> + Send + 'static,
    {
        self.cleanup.push(Box::new(cleanup));
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    fn push_guard<G>(&mut self, guard: G)
    where
        G: EnforcementCleanup + 'static,
    {
        self.cleanup.push(Box::new(guard));
    }

    pub(crate) fn stop(&mut self) {
        if self.stopped {
            return;
        }
        self.stopped = true;
        let _ = self.labels.len();
        let _ = self.primary_label.as_str();
        while let Some(mut cleanup) = self.cleanup.pop() {
            if let Err(err) = cleanup.stop() {
                eprintln!("failed to stop Pomodoro overlay enforcement: {err}");
            }
        }
    }

    #[cfg(test)]
    fn cleanup_len(&self) -> usize {
        self.cleanup.len()
    }
}

impl Drop for OverlayEnforcementGuard {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg(any(target_os = "windows", test))]
pub(crate) struct WindowsOverlayShortcutModifiers {
    pub(crate) alt: bool,
    pub(crate) ctrl: bool,
    pub(crate) shift: bool,
    pub(crate) win: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg(any(target_os = "windows", test))]
pub(crate) struct WindowsOverlayShortcutEvent {
    pub(crate) key_code: u32,
    pub(crate) modifiers: WindowsOverlayShortcutModifiers,
}

#[cfg(any(target_os = "windows", test))]
pub(crate) fn should_block_windows_overlay_shortcut(event: WindowsOverlayShortcutEvent) -> bool {
    let key_code = event.key_code;
    let modifiers = event.modifiers;

    if key_code == VK_LWIN_CODE || key_code == VK_RWIN_CODE {
        return true;
    }

    if modifiers.ctrl && modifiers.alt && key_code == VK_DELETE_CODE {
        return false;
    }

    if modifiers.win {
        return is_shell_chord_key(key_code) || !is_modifier_only_key(key_code);
    }

    if modifiers.alt
        && matches!(
            key_code,
            VK_TAB_CODE | VK_ESCAPE_CODE | VK_F4_CODE | VK_SPACE_CODE
        )
    {
        return true;
    }

    if modifiers.ctrl && key_code == VK_ESCAPE_CODE {
        return true;
    }

    modifiers.ctrl && modifiers.shift && key_code == VK_ESCAPE_CODE
}

#[cfg(any(target_os = "windows", test))]
fn is_shell_chord_key(key_code: u32) -> bool {
    matches!(
        key_code,
        VK_TAB_CODE | VK_D_CODE | VK_E_CODE | VK_L_CODE | VK_M_CODE | VK_R_CODE
    ) || (VK_0_CODE..=VK_9_CODE).contains(&key_code)
}

#[cfg(any(target_os = "windows", test))]
fn is_modifier_only_key(key_code: u32) -> bool {
    matches!(key_code, VK_LWIN_CODE | VK_RWIN_CODE)
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn mac_overlay_presentation_options_bits() -> u64 {
    MAC_APPROVED_PRESENTATION_BITS
}

pub(crate) fn start_overlay_enforcement(
    app: &tauri::AppHandle,
    labels: &[String],
    primary_label: &str,
) -> OverlayEnforcementGuard {
    let guard = OverlayEnforcementGuard::new(labels, primary_label);

    #[cfg(target_os = "windows")]
    {
        let _ = app;
        let mut guard = guard;
        match windows::WindowsPowerGuard::start() {
            Ok(power_guard) => guard.push_guard(power_guard),
            Err(err) => eprintln!("failed to start Windows overlay power guard: {err}"),
        }
        match windows::WindowsShortcutHookGuard::start() {
            Ok(shortcut_guard) => guard.push_guard(shortcut_guard),
            Err(err) => eprintln!("failed to start Windows overlay shortcut guard: {err}"),
        }
        return guard;
    }

    #[cfg(target_os = "macos")]
    {
        let mut guard = guard;
        match macos::MacPresentationGuard::start(app) {
            Ok(presentation_guard) => guard.push_guard(presentation_guard),
            Err(err) => eprintln!("failed to start macOS overlay presentation guard: {err}"),
        }
        match macos::MacPowerAssertionGuard::start() {
            Ok(power_guard) => guard.push_guard(power_guard),
            Err(err) => eprintln!("failed to start macOS overlay power guard: {err}"),
        }
        return guard;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = app;
        guard
    }
}

pub(crate) fn reinforce_overlay_windows(
    app: &tauri::AppHandle,
    labels: &[String],
    primary_label: &str,
) {
    #[cfg(target_os = "windows")]
    let _ = primary_label;

    #[cfg(target_os = "windows")]
    if let Err(err) = windows::reinforce_overlay_windows(app, labels) {
        eprintln!("failed to reinforce Windows Pomodoro overlay windows: {err}");
    }

    #[cfg(target_os = "macos")]
    if let Err(err) = macos::reinforce_overlay_windows(app, labels, primary_label) {
        eprintln!("failed to reinforce macOS Pomodoro overlay windows: {err}");
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = app;
        let _ = labels;
        let _ = primary_label;
    }
}

pub(crate) struct OverlayReconcileGuard {
    stop: Arc<AtomicBool>,
}

impl OverlayReconcileGuard {
    pub(crate) fn start<F>(mut reconcile: F) -> Result<Self, String>
    where
        F: FnMut() -> bool + Send + 'static,
    {
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        std::thread::Builder::new()
            .name("ganbaru-ai-pomodoro-overlay-reconcile".to_string())
            .spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(2_500));
                if worker_stop.load(Ordering::SeqCst) || !reconcile() {
                    break;
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { stop })
    }

    pub(crate) fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

impl Drop for OverlayReconcileGuard {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn run_main_thread_setup<T, F>(app: &tauri::AppHandle, setup: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = tx.send(setup());
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

#[cfg(target_os = "windows")]
mod windows {
    use std::sync::mpsc::{self, SyncSender};
    use std::thread::JoinHandle;

    use super::{
        run_main_thread_setup, should_block_windows_overlay_shortcut, WindowsOverlayShortcutEvent,
        WindowsOverlayShortcutModifiers,
    };
    use tauri::Manager;
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_MENU,
        VK_RCONTROL, VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, PeekMessageW, PostThreadMessageW, SetWindowPos,
        SetWindowsHookExW, UnhookWindowsHookEx, HWND_TOPMOST, KBDLLHOOKSTRUCT, LLKHF_ALTDOWN, MSG,
        PM_NOREMOVE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP,
        WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    pub(super) struct WindowsPowerGuard {
        stop_tx: Option<SyncSender<()>>,
        worker: Option<JoinHandle<()>>,
    }

    impl WindowsPowerGuard {
        pub(super) fn start() -> Result<Self, String> {
            let (ready_tx, ready_rx) = mpsc::sync_channel(1);
            let (stop_tx, stop_rx) = mpsc::sync_channel(1);
            let worker = std::thread::Builder::new()
                .name("ganbaru-ai-overlay-windows-power".to_string())
                .spawn(move || {
                    let active_state = ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED;
                    let active = unsafe { SetThreadExecutionState(active_state) };
                    let _ = ready_tx.send(active.0 != 0);
                    let _ = stop_rx.recv();
                    let _ = unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
                })
                .map_err(|e| e.to_string())?;

            if !ready_rx.recv().map_err(|e| e.to_string())? {
                eprintln!("Windows did not accept the Pomodoro overlay execution state");
            }

            Ok(Self {
                stop_tx: Some(stop_tx),
                worker: Some(worker),
            })
        }
    }

    impl super::EnforcementCleanup for WindowsPowerGuard {
        fn stop(&mut self) -> Result<(), String> {
            if let Some(stop_tx) = self.stop_tx.take() {
                let _ = stop_tx.send(());
            }
            if let Some(worker) = self.worker.take() {
                worker
                    .join()
                    .map_err(|_| "Windows power guard thread panicked".to_string())?;
            }
            Ok(())
        }
    }

    pub(super) struct WindowsShortcutHookGuard {
        thread_id: u32,
        worker: Option<JoinHandle<()>>,
    }

    impl WindowsShortcutHookGuard {
        pub(super) fn start() -> Result<Self, String> {
            let (ready_tx, ready_rx) = mpsc::sync_channel(1);
            let worker = std::thread::Builder::new()
                .name("ganbaru-ai-overlay-keyboard-hook".to_string())
                .spawn(move || unsafe {
                    let thread_id = GetCurrentThreadId();
                    let mut msg = MSG::default();
                    let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
                    let hook =
                        SetWindowsHookExW(WH_KEYBOARD_LL, Some(low_level_keyboard_proc), None, 0);
                    let hook = match hook {
                        Ok(hook) => {
                            let _ = ready_tx.send(Ok(thread_id));
                            hook
                        }
                        Err(err) => {
                            let _ = ready_tx.send(Err(err.to_string()));
                            return;
                        }
                    };

                    loop {
                        let result = GetMessageW(&mut msg, None, 0, 0);
                        if result.0 <= 0 || msg.message == WM_QUIT {
                            break;
                        }
                    }

                    let _ = UnhookWindowsHookEx(hook);
                })
                .map_err(|e| e.to_string())?;

            match ready_rx.recv().map_err(|e| e.to_string())? {
                Ok(thread_id) => Ok(Self {
                    thread_id,
                    worker: Some(worker),
                }),
                Err(err) => {
                    let _ = worker.join();
                    Err(err)
                }
            }
        }
    }

    impl super::EnforcementCleanup for WindowsShortcutHookGuard {
        fn stop(&mut self) -> Result<(), String> {
            let _ = unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) };
            if let Some(worker) = self.worker.take() {
                worker
                    .join()
                    .map_err(|_| "Windows shortcut hook thread panicked".to_string())?;
            }
            Ok(())
        }
    }

    unsafe extern "system" fn low_level_keyboard_proc(
        ncode: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if ncode >= 0 && is_keyboard_message(wparam.0 as u32) {
            let keyboard = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            let event = WindowsOverlayShortcutEvent {
                key_code: keyboard.vkCode,
                modifiers: current_modifier_state(keyboard.vkCode, keyboard.flags),
            };
            if should_block_windows_overlay_shortcut(event) {
                return LRESULT(1);
            }
        }
        unsafe { CallNextHookEx(None, ncode, wparam, lparam) }
    }

    fn is_keyboard_message(message: u32) -> bool {
        matches!(message, WM_KEYDOWN | WM_KEYUP | WM_SYSKEYDOWN | WM_SYSKEYUP)
    }

    fn current_modifier_state(
        key_code: u32,
        flags: windows::Win32::UI::WindowsAndMessaging::KBDLLHOOKSTRUCT_FLAGS,
    ) -> WindowsOverlayShortcutModifiers {
        WindowsOverlayShortcutModifiers {
            alt: flags.contains(LLKHF_ALTDOWN)
                || async_key_down(VK_MENU)
                || async_key_down(VK_LMENU)
                || async_key_down(VK_RMENU),
            ctrl: async_key_down(VK_CONTROL)
                || async_key_down(VK_LCONTROL)
                || async_key_down(VK_RCONTROL),
            shift: async_key_down(VK_SHIFT)
                || async_key_down(VK_LSHIFT)
                || async_key_down(VK_RSHIFT),
            win: key_code == u32::from(VK_LWIN.0)
                || key_code == u32::from(VK_RWIN.0)
                || async_key_down(VK_LWIN)
                || async_key_down(VK_RWIN),
        }
    }

    fn async_key_down(key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY) -> bool {
        unsafe { GetAsyncKeyState(i32::from(key.0)) < 0 }
    }

    pub(super) fn reinforce_overlay_windows(
        app: &tauri::AppHandle,
        labels: &[String],
    ) -> Result<(), String> {
        let labels = labels.to_vec();
        let app_for_setup = app.clone();
        run_main_thread_setup(app, move || {
            for label in labels {
                let Some(window) = app_for_setup.get_webview_window(&label) else {
                    continue;
                };
                let hwnd = window.hwnd().map_err(|e| e.to_string())?;
                unsafe {
                    SetWindowPos(
                        hwnd,
                        Some(HWND_TOPMOST),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;

    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSApplication, NSApplicationPresentationOptions, NSScreenSaverWindowLevel, NSWindow,
    };
    use objc2_core_foundation::{CFRetained, CFString};
    use tauri::Manager;

    use super::{mac_overlay_presentation_options_bits, run_main_thread_setup};

    type IOPMAssertionId = u32;
    type IOPMAssertionLevel = u32;
    type IOReturn = i32;
    type CFStringRef = *const c_void;

    const K_IOPM_ASSERTION_LEVEL_ON: IOPMAssertionLevel = 255;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        static kIOPMAssertionTypePreventUserIdleDisplaySleep: CFStringRef;
        static kIOPMAssertionTypePreventUserIdleSystemSleep: CFStringRef;
        fn IOPMAssertionCreateWithName(
            assertion_type: CFStringRef,
            assertion_level: IOPMAssertionLevel,
            assertion_name: CFStringRef,
            assertion_id: *mut IOPMAssertionId,
        ) -> IOReturn;
        fn IOPMAssertionRelease(assertion_id: IOPMAssertionId) -> IOReturn;
    }

    pub(super) struct MacPresentationGuard {
        app: tauri::AppHandle,
        previous_options_bits: u64,
    }

    impl MacPresentationGuard {
        pub(super) fn start(app: &tauri::AppHandle) -> Result<Self, String> {
            let app_for_setup = app.clone();
            let previous_options_bits = run_main_thread_setup(app, move || {
                let mtm = MainThreadMarker::new()
                    .ok_or_else(|| "macOS presentation options need the main thread".to_string())?;
                let ns_app = NSApplication::sharedApplication(mtm);
                let previous_options = ns_app.presentationOptions();
                ns_app.setPresentationOptions(mac_overlay_presentation_options());
                Ok(previous_options.0 as u64)
            })?;

            Ok(Self {
                app: app_for_setup,
                previous_options_bits,
            })
        }
    }

    impl super::EnforcementCleanup for MacPresentationGuard {
        fn stop(&mut self) -> Result<(), String> {
            let previous_options_bits = self.previous_options_bits;
            run_main_thread_setup(&self.app, move || {
                let mtm = MainThreadMarker::new()
                    .ok_or_else(|| "macOS presentation options need the main thread".to_string())?;
                let ns_app = NSApplication::sharedApplication(mtm);
                ns_app.setPresentationOptions(mac_presentation_options_from_bits(
                    previous_options_bits,
                ));
                Ok(())
            })
        }
    }

    pub(super) struct MacPowerAssertionGuard {
        assertion_ids: Vec<IOPMAssertionId>,
    }

    impl MacPowerAssertionGuard {
        pub(super) fn start() -> Result<Self, String> {
            let mut assertion_ids = Vec::new();
            let display_id =
                create_power_assertion(unsafe { kIOPMAssertionTypePreventUserIdleDisplaySleep })?;
            assertion_ids.push(display_id);

            match create_power_assertion(unsafe { kIOPMAssertionTypePreventUserIdleSystemSleep }) {
                Ok(system_id) => assertion_ids.push(system_id),
                Err(err) => eprintln!("failed to create macOS system sleep assertion: {err}"),
            }

            Ok(Self { assertion_ids })
        }
    }

    impl super::EnforcementCleanup for MacPowerAssertionGuard {
        fn stop(&mut self) -> Result<(), String> {
            for assertion_id in self.assertion_ids.drain(..) {
                let result = unsafe { IOPMAssertionRelease(assertion_id) };
                if result != 0 {
                    eprintln!("failed to release macOS power assertion {assertion_id}: {result}");
                }
            }
            Ok(())
        }
    }

    fn create_power_assertion(assertion_type: CFStringRef) -> Result<IOPMAssertionId, String> {
        let name = CFString::from_static_str("Ganbaru AI Pomodoro overlay");
        let name_ref = CFRetained::as_ptr(&name).as_ptr().cast::<c_void>();
        let mut assertion_id = 0;
        let result = unsafe {
            IOPMAssertionCreateWithName(
                assertion_type,
                K_IOPM_ASSERTION_LEVEL_ON,
                name_ref,
                &mut assertion_id,
            )
        };
        if result == 0 {
            Ok(assertion_id)
        } else {
            Err(format!("IOPMAssertionCreateWithName returned {result}"))
        }
    }

    fn mac_overlay_presentation_options() -> NSApplicationPresentationOptions {
        mac_presentation_options_from_bits(mac_overlay_presentation_options_bits())
    }

    fn mac_presentation_options_from_bits(bits: u64) -> NSApplicationPresentationOptions {
        NSApplicationPresentationOptions::from_bits_retain(bits as _)
    }

    pub(super) fn reinforce_overlay_windows(
        app: &tauri::AppHandle,
        labels: &[String],
        _primary_label: &str,
    ) -> Result<(), String> {
        let labels = labels.to_vec();
        let app_for_setup = app.clone();
        run_main_thread_setup(app, move || {
            for label in labels {
                let Some(window) = app_for_setup.get_webview_window(&label) else {
                    continue;
                };
                let ns_window = window.ns_window().map_err(|e| e.to_string())?;
                if ns_window.is_null() {
                    continue;
                }
                let ns_window: &NSWindow = unsafe { &*ns_window.cast() };
                ns_window.setLevel(NSScreenSaverWindowLevel);
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn event(
        key_code: u32,
        modifiers: WindowsOverlayShortcutModifiers,
    ) -> WindowsOverlayShortcutEvent {
        WindowsOverlayShortcutEvent {
            key_code,
            modifiers,
        }
    }

    #[test]
    fn windows_shortcut_filter_blocks_escape_routes() {
        assert!(should_block_windows_overlay_shortcut(event(
            VK_TAB_CODE,
            WindowsOverlayShortcutModifiers {
                alt: true,
                ..Default::default()
            },
        )));
        assert!(should_block_windows_overlay_shortcut(event(
            VK_ESCAPE_CODE,
            WindowsOverlayShortcutModifiers {
                alt: true,
                ..Default::default()
            },
        )));
        assert!(should_block_windows_overlay_shortcut(event(
            VK_D_CODE,
            WindowsOverlayShortcutModifiers {
                win: true,
                ..Default::default()
            },
        )));
        assert!(should_block_windows_overlay_shortcut(event(
            VK_ESCAPE_CODE,
            WindowsOverlayShortcutModifiers {
                ctrl: true,
                ..Default::default()
            },
        )));
        assert!(should_block_windows_overlay_shortcut(event(
            VK_LWIN_CODE,
            WindowsOverlayShortcutModifiers::default(),
        )));
    }

    #[test]
    fn windows_shortcut_filter_passes_overlay_controls_and_text() {
        assert!(!should_block_windows_overlay_shortcut(event(
            u32::from(b'A'),
            WindowsOverlayShortcutModifiers::default(),
        )));
        assert!(!should_block_windows_overlay_shortcut(event(
            VK_SPACE_CODE,
            WindowsOverlayShortcutModifiers::default(),
        )));
        assert!(!should_block_windows_overlay_shortcut(event(
            VK_ESCAPE_CODE,
            WindowsOverlayShortcutModifiers::default(),
        )));
        assert!(!should_block_windows_overlay_shortcut(event(
            VK_SPACE_CODE,
            WindowsOverlayShortcutModifiers {
                ctrl: true,
                shift: true,
                ..Default::default()
            },
        )));
    }

    #[test]
    fn windows_shortcut_filter_leaves_secure_attention_unclaimed() {
        assert!(!should_block_windows_overlay_shortcut(event(
            VK_DELETE_CODE,
            WindowsOverlayShortcutModifiers {
                ctrl: true,
                alt: true,
                ..Default::default()
            },
        )));
    }

    #[test]
    fn overlay_enforcement_guard_stops_cleanup_once_in_reverse_order() {
        let calls = Arc::new(AtomicUsize::new(0));
        let order = Arc::new(std::sync::Mutex::new(Vec::new()));
        let mut guard = OverlayEnforcementGuard::new(&[], "primary");

        for id in [1, 2] {
            let calls = Arc::clone(&calls);
            let order = Arc::clone(&order);
            guard.push_cleanup(move || {
                calls.fetch_add(1, Ordering::SeqCst);
                order
                    .lock()
                    .expect("test order lock should not be poisoned")
                    .push(id);
                Ok(())
            });
        }

        guard.stop();
        guard.stop();

        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(
            *order
                .lock()
                .expect("test order lock should not be poisoned"),
            vec![2, 1]
        );
        assert_eq!(guard.cleanup_len(), 0);
    }

    #[test]
    fn overlay_enforcement_guard_survives_partial_cleanup_failure() {
        let calls = Arc::new(AtomicUsize::new(0));
        let mut guard = OverlayEnforcementGuard::new(&[], "primary");

        guard.push_cleanup(|| Err("first cleanup failed".to_string()));
        let calls_for_cleanup = Arc::clone(&calls);
        guard.push_cleanup(move || {
            calls_for_cleanup.fetch_add(1, Ordering::SeqCst);
            Ok(())
        });

        guard.stop();

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(guard.cleanup_len(), 0);
    }

    #[test]
    fn overlay_enforcement_guard_close_without_start_is_safe() {
        let mut guard = OverlayEnforcementGuard::new(&[], "primary");

        guard.stop();
        guard.stop();

        assert_eq!(guard.cleanup_len(), 0);
    }

    #[test]
    fn macos_presentation_options_use_only_kiosk_lite_bits() {
        let bits = mac_overlay_presentation_options_bits();

        assert_eq!(bits, MAC_APPROVED_PRESENTATION_BITS);
        assert_eq!(bits & (1 << 4), 0);
        assert_ne!(bits & MAC_PRESENTATION_HIDE_DOCK, 0);
        assert_ne!(bits & MAC_PRESENTATION_HIDE_MENU_BAR, 0);
        assert_ne!(bits & MAC_PRESENTATION_DISABLE_PROCESS_SWITCHING, 0);
        assert_ne!(bits & MAC_PRESENTATION_DISABLE_FORCE_QUIT, 0);
        assert_ne!(bits & MAC_PRESENTATION_DISABLE_SESSION_TERMINATION, 0);
        assert_ne!(bits & MAC_PRESENTATION_DISABLE_HIDE_APPLICATION, 0);
        assert_ne!(bits & MAC_PRESENTATION_FULL_SCREEN, 0);
    }
}
