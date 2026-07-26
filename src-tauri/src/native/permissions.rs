use crate::{
    error::{AppError, AppResult},
    models::PermissionState,
};

pub fn accessibility_state() -> PermissionState {
    platform::accessibility_state()
}

pub fn microphone_state(cached_grant: bool) -> PermissionState {
    platform::microphone_state(cached_grant)
}

pub fn open_settings(kind: &str) -> AppResult<()> {
    platform::open_settings(kind)
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};

    use super::{AppError, AppResult, PermissionState};

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }

    pub fn accessibility_state() -> PermissionState {
        // SAFETY: This parameterless system function is available on the app's
        // macOS 12+ deployment target and does not transfer ownership.
        if unsafe { AXIsProcessTrusted() } {
            PermissionState::Granted
        } else {
            PermissionState::Denied
        }
    }

    pub fn microphone_state(cached_grant: bool) -> PermissionState {
        // SAFETY: Reading this AVFoundation NSString constant does not transfer
        // ownership. A missing weak-linked symbol is represented as None.
        let Some(media_type) = (unsafe { AVMediaTypeAudio }) else {
            return if cached_grant {
                PermissionState::Granted
            } else {
                PermissionState::Unknown
            };
        };
        // SAFETY: AVMediaTypeAudio is a valid media type for this class method.
        let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
        match status {
            AVAuthorizationStatus::Authorized => PermissionState::Granted,
            AVAuthorizationStatus::Denied => PermissionState::Denied,
            AVAuthorizationStatus::Restricted => PermissionState::Restricted,
            _ if cached_grant => PermissionState::Granted,
            _ => PermissionState::Unknown,
        }
    }

    pub fn open_settings(kind: &str) -> AppResult<()> {
        let url = match kind {
            "microphone" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
            }
            "accessibility" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            _ => return Err(AppError::InvalidRequest("unknown permission kind".into())),
        };
        open::that(url).map_err(|error| AppError::System(error.to_string()))
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{AppError, AppResult, PermissionState};

    pub fn accessibility_state() -> PermissionState {
        // Win32 desktop applications do not have a separate accessibility
        // consent prompt. UIPI still prevents insertion into elevated apps.
        PermissionState::Granted
    }

    pub fn microphone_state(cached_grant: bool) -> PermissionState {
        if cached_grant {
            PermissionState::Granted
        } else {
            PermissionState::Unknown
        }
    }

    pub fn open_settings(kind: &str) -> AppResult<()> {
        let url = match kind {
            "microphone" => "ms-settings:privacy-microphone",
            "accessibility" => "ms-settings:easeofaccess",
            _ => return Err(AppError::InvalidRequest("unknown permission kind".into())),
        };
        open::that(url).map_err(|error| AppError::System(error.to_string()))
    }
}
