use crate::error::{AppError, AppResult};

/// Stable identity for the application that was focused when recording began.
///
/// The token is intentionally kept inside Rust. The webview receives only the
/// human-readable application name, preventing it from choosing an arbitrary
/// insertion target.
#[derive(Debug, Clone)]
pub struct FocusTarget {
    pub token: u64,
    pub application: String,
}

pub fn capture() -> AppResult<FocusTarget> {
    platform::capture()
}

pub fn is_current(target: &FocusTarget) -> bool {
    platform::current_token().is_some_and(|token| token == target.token)
}

#[cfg(target_os = "macos")]
mod platform {
    use std::{
        ffi::{c_void, CStr},
        ptr,
    };

    use core_foundation_sys::{
        base::{CFHash, CFRelease, CFTypeRef},
        string::{kCFStringEncodingUTF8, CFStringCreateWithCString, CFStringRef},
    };
    use objc2_app_kit::NSWorkspace;

    use super::{AppError, AppResult, FocusTarget};

    type AXUIElementRef = *const c_void;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> i32;
    }

    fn copy_attribute_value(element: AXUIElementRef, attribute_name: &CStr) -> Option<CFTypeRef> {
        // The Accessibility attribute constants are CFSTR macros in Apple's
        // headers, not exported linker symbols. Build the equivalent CFString
        // at runtime and release it immediately after the copy call.
        unsafe {
            let attribute = CFStringCreateWithCString(
                ptr::null(),
                attribute_name.as_ptr(),
                kCFStringEncodingUTF8,
            );
            if attribute.is_null() {
                return None;
            }

            let mut value: CFTypeRef = ptr::null();
            let status = AXUIElementCopyAttributeValue(element, attribute, &mut value);
            CFRelease(attribute.cast());

            if status != 0 || value.is_null() {
                // Be defensive if a future Accessibility implementation writes
                // a retained value while also returning an error.
                if !value.is_null() {
                    CFRelease(value);
                }
                return None;
            }

            Some(value)
        }
    }

    fn active_token(process_id: i32) -> u64 {
        // Include the focused accessibility window identity so switching
        // documents/windows inside the same application invalidates insertion.
        let window = focused_window_hash().unwrap_or_default();
        (process_id as u64).rotate_left(32) ^ window
    }

    fn focused_window_hash() -> Option<u64> {
        // SAFETY: All returned AX objects follow Core Foundation's create/copy
        // ownership rules and are released on every path after acquisition.
        unsafe {
            let system = AXUIElementCreateSystemWide();
            if system.is_null() {
                return None;
            }

            let application = copy_attribute_value(system, c"AXFocusedApplication");
            CFRelease(system.cast());
            let application = application?;

            let window = copy_attribute_value(application.cast(), c"AXFocusedWindow");
            CFRelease(application);
            let window = window?;

            let hash = CFHash(window) as u64;
            CFRelease(window);
            Some(hash)
        }
    }

    pub fn capture() -> AppResult<FocusTarget> {
        let application = NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .ok_or_else(|| AppError::System("no foreground application is available".into()))?;
        let process_id = application.processIdentifier();
        let token = active_token(process_id);
        let name = application
            .localizedName()
            .map(|name| name.to_string())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| "macOS application".into());

        Ok(FocusTarget {
            token,
            application: name,
        })
    }

    pub fn current_token() -> Option<u64> {
        NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .map(|application| active_token(application.processIdentifier()))
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
    };

    use super::{AppError, AppResult, FocusTarget};

    pub fn capture() -> AppResult<FocusTarget> {
        let window = unsafe { GetForegroundWindow() };
        if window.0.is_null() {
            return Err(AppError::System(
                "no foreground application is available".into(),
            ));
        }

        let token = window.0 as usize as u64;
        let length = unsafe { GetWindowTextLengthW(window) }.max(0) as usize;
        let mut buffer = vec![0_u16; length.saturating_add(1).max(2)];
        let copied = unsafe { GetWindowTextW(window, &mut buffer) }.max(0) as usize;
        let name = String::from_utf16_lossy(&buffer[..copied]);

        Ok(FocusTarget {
            token,
            application: if name.trim().is_empty() {
                "Windows application".into()
            } else {
                name
            },
        })
    }

    pub fn current_token() -> Option<u64> {
        let window = unsafe { GetForegroundWindow() };
        (!window.0.is_null()).then_some(window.0 as usize as u64)
    }
}
