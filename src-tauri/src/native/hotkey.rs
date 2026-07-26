use std::{
    os::raw::{c_int, c_void},
    ptr,
    sync::Arc,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use parking_lot::Mutex;
#[cfg(not(target_os = "macos"))]
use rdev::{listen, Event, EventType, Key};
use tauri::{AppHandle, Emitter};

use crate::{error::AppResult, models::ShortcutEvent};

const ARMING_DELAY: Duration = Duration::from_millis(180);
const POLL_INTERVAL: Duration = Duration::from_millis(16);
const MAX_HOLD_DURATION: Duration = Duration::from_secs(10 * 60);
#[cfg(target_os = "macos")]
const MACOS_ESCAPE_KEYCODE: u16 = 53;
#[cfg(target_os = "macos")]
const MACOS_EVENT_KEY_DOWN: u32 = 10;
#[cfg(target_os = "macos")]
const MACOS_EVENT_KEY_UP: u32 = 11;
#[cfg(target_os = "macos")]
const MACOS_EVENT_FLAGS_CHANGED: u32 = 12;
#[cfg(target_os = "macos")]
const MACOS_EVENT_TAP_OPTION_DEFAULT: u32 = 0;
#[cfg(target_os = "macos")]
const MACOS_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = u32::MAX - 1;
#[cfg(target_os = "macos")]
const MACOS_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = u32::MAX - 2;
#[cfg(target_os = "macos")]
const MACOS_EVENT_FLAG_MASK_ALTERNATE: u64 = 1 << 19;
#[cfg(target_os = "macos")]
const MACOS_EVENT_FLAG_MASK_COMMAND: u64 = 1 << 20;
#[cfg(target_os = "macos")]
const MACOS_KEYBOARD_EVENT_KEYCODE_FIELD: u32 = 9;

#[derive(Default)]
struct KeyState {
    alternate: bool,
    trigger: bool,
    invalidated: bool,
    active: bool,
    armed_at: Option<Instant>,
    activated_at: Option<Instant>,
}

/// Starts the non-blocking Option+Command / Alt+Win modifier monitor.
///
/// A short arming delay protects normal application shortcuts: any third key
/// invalidates the gesture before recording starts.
pub fn start(app: AppHandle) -> AppResult<()> {
    let state = Arc::new(Mutex::new(KeyState::default()));

    #[cfg(target_os = "macos")]
    {
        let listener_state = state.clone();
        let listener_app = app.clone();
        thread::Builder::new()
            .name("open-dictate-shortcut-listener".into())
            .spawn(move || listen_for_macos_shortcut_events(listener_state, listener_app))
            .map_err(|error| crate::error::AppError::System(error.to_string()))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let listener_state = state.clone();
        let listener_app = app.clone();
        thread::Builder::new()
            .name("open-dictate-shortcut-listener".into())
            .spawn(move || listen_for_shortcut_events(listener_state, listener_app))
            .map_err(|error| crate::error::AppError::System(error.to_string()))?;
    }

    thread::Builder::new()
        .name("open-dictate-shortcut-watchdog".into())
        .spawn(move || loop {
            thread::sleep(POLL_INTERVAL);
            let phase = {
                let mut keys = state.lock();
                let chord = keys.alternate && keys.trigger;
                if keys.active
                    && keys
                        .activated_at
                        .is_some_and(|started| started.elapsed() >= MAX_HOLD_DURATION)
                {
                    keys.active = false;
                    keys.invalidated = true;
                    keys.armed_at = None;
                    keys.activated_at = None;
                    Some("released")
                } else if chord && !keys.invalidated && !keys.active {
                    match keys.armed_at {
                        Some(started) if started.elapsed() >= ARMING_DELAY => {
                            keys.active = true;
                            keys.activated_at = Some(Instant::now());
                            Some("pressed")
                        }
                        Some(_) => None,
                        None => {
                            keys.armed_at = Some(Instant::now());
                            None
                        }
                    }
                } else {
                    if !chord && !keys.active {
                        keys.armed_at = None;
                        keys.activated_at = None;
                    }
                    None
                }
            };

            if let Some(phase) = phase {
                emit(&app, phase);
            }
        })
        .map_err(|error| crate::error::AppError::System(error.to_string()))?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn listen_for_shortcut_events(listener_state: Arc<Mutex<KeyState>>, listener_app: AppHandle) {
    loop {
        let callback_state = listener_state.clone();
        let callback_app = listener_app.clone();
        if let Err(error) = listen(move |event| handle_event(event, &callback_state, &callback_app))
        {
            tracing::warn!(error = ?error, "global shortcut monitor unavailable; retrying");
            thread::sleep(Duration::from_secs(3));
        }
    }
}

#[cfg(target_os = "macos")]
fn listen_for_macos_shortcut_events(state: Arc<Mutex<KeyState>>, app: AppHandle) {
    let mut reported_unavailable = false;
    loop {
        if let Err(error) = run_macos_event_tap(&state, &app) {
            if !reported_unavailable {
                tracing::warn!(
                    error = ?error,
                    "global shortcut monitor unavailable; waiting for permission"
                );
                reported_unavailable = true;
            }
            thread::sleep(Duration::from_secs(3));
        }
    }
}

#[cfg(target_os = "macos")]
fn run_macos_event_tap(state: &Arc<Mutex<KeyState>>, app: &AppHandle) -> AppResult<()> {
    let context = Box::new(MacosShortcutContext {
        state: state.clone(),
        app: app.clone(),
        tap: ptr::null_mut(),
    });
    let context_ptr = Box::into_raw(context);
    let event_mask = (1_u64 << MACOS_EVENT_KEY_DOWN)
        | (1_u64 << MACOS_EVENT_KEY_UP)
        | (1_u64 << MACOS_EVENT_FLAGS_CHANGED);
    let tap = unsafe {
        CGEventTapCreate(
            1,
            0,
            MACOS_EVENT_TAP_OPTION_DEFAULT,
            event_mask,
            macos_event_tap_callback,
            context_ptr.cast::<c_void>(),
        )
    };
    if tap.is_null() {
        let _ = unsafe { Box::from_raw(context_ptr) };
        return Err(crate::error::AppError::System(
            "global shortcut monitor is unavailable; grant Accessibility access and restart Open Dictate"
                .into(),
        ));
    }

    unsafe { (*context_ptr).tap = tap };
    let source = unsafe { CFMachPortCreateRunLoopSource(ptr::null_mut(), tap, 0) };
    if source.is_null() {
        unsafe {
            CFRelease(tap);
            let _ = Box::from_raw(context_ptr);
        }
        return Err(crate::error::AppError::System(
            "global shortcut monitor run loop source is unavailable".into(),
        ));
    }

    let run_loop = unsafe { CFRunLoopGetCurrent() };
    unsafe {
        CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
        CGEventTapEnable(tap, true);
        CFRunLoopRun();
        CFRunLoopRemoveSource(run_loop, source, kCFRunLoopCommonModes);
        CFRelease(source);
        CFRelease(tap);
        let _ = Box::from_raw(context_ptr);
    }
    Err(crate::error::AppError::System(
        "global shortcut monitor stopped unexpectedly".into(),
    ))
}

#[cfg(target_os = "macos")]
struct MacosShortcutContext {
    state: Arc<Mutex<KeyState>>,
    app: AppHandle,
    tap: *mut c_void,
}

#[cfg(target_os = "macos")]
extern "C" fn macos_event_tap_callback(
    _proxy: *mut c_void,
    event_type: u32,
    event: *mut c_void,
    user_info: *mut c_void,
) -> *mut c_void {
    if user_info.is_null() {
        return event;
    }

    let context = unsafe { &*(user_info.cast::<MacosShortcutContext>()) };
    if event_type == MACOS_EVENT_TAP_DISABLED_BY_TIMEOUT
        || event_type == MACOS_EVENT_TAP_DISABLED_BY_USER_INPUT
    {
        if !context.tap.is_null() {
            unsafe { CGEventTapEnable(context.tap, true) };
        }
        return event;
    }
    if event.is_null() {
        return event;
    }

    let flags = unsafe { CGEventGetFlags(event) };
    let keycode = unsafe { CGEventGetIntegerValueField(event, MACOS_KEYBOARD_EVENT_KEYCODE_FIELD) };
    handle_macos_event(event_type, flags, keycode, &context.state, &context.app);
    event
}

#[cfg(target_os = "macos")]
fn handle_macos_event(
    event_type: u32,
    flags: u64,
    keycode: i64,
    state: &Arc<Mutex<KeyState>>,
    app: &AppHandle,
) {
    let alternate = flags & MACOS_EVENT_FLAG_MASK_ALTERNATE != 0;
    let command = flags & MACOS_EVENT_FLAG_MASK_COMMAND != 0;
    let mut emitted = None;
    {
        let mut keys = state.lock();
        keys.alternate = alternate;
        keys.trigger = command;

        if event_type == MACOS_EVENT_KEY_DOWN {
            if keycode == i64::from(MACOS_ESCAPE_KEYCODE) && keys.active {
                keys.active = false;
                keys.invalidated = true;
                keys.armed_at = None;
                keys.activated_at = None;
                emitted = Some("cancelled");
            } else if keys.alternate || keys.trigger || keys.armed_at.is_some() || keys.active {
                if keys.active {
                    keys.active = false;
                    keys.activated_at = None;
                    emitted = Some("cancelled");
                }
                keys.invalidated = true;
                keys.armed_at = None;
            }
        }

        if keys.active && !(keys.alternate && keys.trigger) {
            keys.active = false;
            keys.armed_at = None;
            keys.activated_at = None;
            emitted = Some("released");
        }

        if !keys.alternate && !keys.trigger {
            keys.invalidated = false;
            keys.armed_at = None;
            keys.activated_at = None;
        }
    }

    if let Some(phase) = emitted {
        emit(app, phase);
    }
}

#[cfg(not(target_os = "macos"))]
fn handle_event(event: Event, state: &Arc<Mutex<KeyState>>, app: &AppHandle) {
    let (key, pressed) = match event.event_type {
        EventType::KeyPress(key) => (key, true),
        EventType::KeyRelease(key) => (key, false),
        _ => return,
    };

    let mut emitted = None;
    {
        let mut keys = state.lock();
        if is_alternate(key) {
            keys.alternate = pressed;
        } else if is_meta(key) {
            keys.trigger = pressed;
        } else if pressed {
            if key == Key::Escape && keys.active {
                keys.active = false;
                keys.invalidated = true;
                keys.armed_at = None;
                keys.activated_at = None;
                emitted = Some("cancelled");
            } else if keys.alternate || keys.trigger || keys.armed_at.is_some() || keys.active {
                if keys.active {
                    keys.active = false;
                    keys.activated_at = None;
                    emitted = Some("cancelled");
                }
                keys.invalidated = true;
                keys.armed_at = None;
            }
        }

        if keys.active && !(keys.alternate && keys.trigger) {
            keys.active = false;
            keys.armed_at = None;
            keys.activated_at = None;
            emitted = Some("released");
        }

        if !keys.alternate && !keys.trigger {
            keys.invalidated = false;
            keys.armed_at = None;
            keys.activated_at = None;
        }
    }

    if let Some(phase) = emitted {
        emit(app, phase);
    }
}

#[cfg(not(target_os = "macos"))]
fn is_alternate(key: Key) -> bool {
    // AltGr is intentionally not accepted on Windows because it can be
    // represented as Ctrl+Alt by keyboard layouts.
    key == Key::Alt
}

#[cfg(not(target_os = "macos"))]
fn is_meta(key: Key) -> bool {
    matches!(key, Key::MetaLeft | Key::MetaRight)
}

fn emit(app: &AppHandle, phase: &'static str) {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let _ = app.emit(
        "dictation://shortcut",
        ShortcutEvent {
            phase,
            timestamp_ms,
        },
    );
}

#[cfg(target_os = "macos")]
type CGEventTapCallBack = extern "C" fn(*mut c_void, u32, *mut c_void, *mut c_void) -> *mut c_void;

#[cfg(target_os = "macos")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: CGEventTapCallBack,
        user_info: *mut c_void,
    ) -> *mut c_void;
    fn CGEventTapEnable(tap: *mut c_void, enable: bool);
    fn CGEventGetFlags(event: *mut c_void) -> u64;
    fn CGEventGetIntegerValueField(event: *mut c_void, field: u32) -> i64;
    fn CFMachPortCreateRunLoopSource(
        allocator: *mut c_void,
        port: *mut c_void,
        order: c_int,
    ) -> *mut c_void;
    fn CFRunLoopGetCurrent() -> *mut c_void;
    fn CFRunLoopAddSource(rl: *mut c_void, source: *mut c_void, mode: *const c_void);
    fn CFRunLoopRemoveSource(rl: *mut c_void, source: *mut c_void, mode: *const c_void);
    fn CFRunLoopRun();
    fn CFRelease(cf: *const c_void);
    static kCFRunLoopCommonModes: *const c_void;
}
