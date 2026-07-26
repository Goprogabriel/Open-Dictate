use std::{
    fs,
    path::{Path, PathBuf},
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    Device, FromSample, Sample, SampleFormat, SizedSample, Stream, StreamConfig, I24, U24,
};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{AudioLevelEvent, MicrophoneDevice, RecordingDescriptor, RecordingStarted},
    native::focus::FocusTarget,
    state::StoredRecording,
};

const TARGET_SAMPLE_RATE: u32 = 16_000;
const MAX_RECORDING_SECONDS: usize = 10 * 60;
const SPEECH_WINDOW_MS: usize = 20;
const SPEECH_RMS_THRESHOLD: f32 = 0.012;

struct ActiveRecording {
    id: String,
    started_at: Instant,
    source_sample_rate: u32,
    path: PathBuf,
    focus_target: FocusTarget,
    stream: Stream,
    worker: thread::JoinHandle<Vec<f32>>,
    error: Arc<Mutex<Option<String>>>,
}

#[derive(Default)]
pub struct AudioRecorder {
    active: Mutex<Option<ActiveRecording>>,
}

impl AudioRecorder {
    pub fn list_devices(&self) -> AppResult<Vec<MicrophoneDevice>> {
        let host = cpal::default_host();
        let default_id = host
            .default_input_device()
            .and_then(|device| device.id().ok())
            .map(|id| id.to_string());
        let devices = host
            .input_devices()
            .map_err(|error| AppError::AudioDevice(error.to_string()))?;

        devices
            .map(|device| {
                let id = device
                    .id()
                    .map_err(|error| AppError::AudioDevice(error.to_string()))?
                    .to_string();
                let name = device
                    .description()
                    .map(|description| description.name().to_owned())
                    .unwrap_or_else(|_| "Microphone".into());
                Ok(MicrophoneDevice {
                    is_default: default_id.as_ref() == Some(&id),
                    id,
                    name,
                })
            })
            .collect()
    }

    pub fn probe_default_device(&self) -> AppResult<()> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| AppError::AudioDevice("no input device is available".into()))?;
        let supported = device
            .default_input_config()
            .map_err(|error| AppError::AudioDevice(error.to_string()))?;
        let config = supported.config();
        let (sender, _receiver) = mpsc::sync_channel(2);
        let error = Arc::new(Mutex::new(None));
        let stream = build_stream(
            &device,
            &config,
            supported.sample_format(),
            sender,
            error.clone(),
        )?;
        stream
            .play()
            .map_err(|error| AppError::AudioDevice(error.to_string()))?;
        thread::sleep(Duration::from_millis(180));
        drop(stream);

        if let Some(message) = error.lock().clone() {
            return Err(AppError::AudioDevice(message));
        }
        Ok(())
    }

    pub fn start(
        &self,
        app: &AppHandle,
        cache_directory: &Path,
        microphone_id: Option<&str>,
        focus_target: FocusTarget,
    ) -> AppResult<RecordingStarted> {
        let mut active = self.active.lock();
        if active.is_some() {
            return Err(AppError::RecordingAlreadyActive);
        }

        fs::create_dir_all(cache_directory)
            .map_err(|error| AppError::AudioRecording(error.to_string()))?;
        let host = cpal::default_host();
        let device = select_device(&host, microphone_id)?;
        let supported = device
            .default_input_config()
            .map_err(|error| AppError::AudioDevice(error.to_string()))?;
        let config = supported.config();
        let id = Uuid::new_v4().to_string();
        let path = cache_directory.join(format!("dictation-{id}.wav"));
        let (sender, receiver) = mpsc::sync_channel::<Vec<f32>>(64);
        let error = Arc::new(Mutex::new(None));
        let stream = build_stream(
            &device,
            &config,
            supported.sample_format(),
            sender,
            error.clone(),
        )?;

        let channels = usize::from(config.channels);
        let source_sample_rate = config.sample_rate;
        let event_app = app.clone();
        let event_id = id.clone();
        let worker = thread::Builder::new()
            .name("open-dictate-audio-worker".into())
            .spawn(move || {
                let maximum_samples = source_sample_rate as usize * MAX_RECORDING_SECONDS;
                let mut mono = Vec::with_capacity(source_sample_rate as usize * 30);
                let mut last_level_event = Instant::now() - Duration::from_secs(1);

                while let Ok(chunk) = receiver.recv() {
                    if mono.len() >= maximum_samples {
                        continue;
                    }
                    let remaining = maximum_samples.saturating_sub(mono.len());
                    let mut squared_sum = 0.0_f32;
                    let mut frames = 0_usize;
                    for frame in chunk.chunks(channels).take(remaining) {
                        let sample = frame.iter().copied().sum::<f32>() / frame.len().max(1) as f32;
                        squared_sum += sample * sample;
                        frames += 1;
                        mono.push(sample.clamp(-1.0, 1.0));
                    }

                    if frames > 0 && last_level_event.elapsed() >= Duration::from_millis(55) {
                        let rms = (squared_sum / frames as f32).sqrt();
                        let normalized = (rms * 7.5).clamp(0.0, 1.0);
                        let _ = event_app.emit(
                            "dictation://audio-level",
                            AudioLevelEvent {
                                recording_id: event_id.clone(),
                                level: normalized,
                            },
                        );
                        last_level_event = Instant::now();
                    }
                }
                mono
            })
            .map_err(|error| AppError::AudioRecording(error.to_string()))?;

        stream
            .play()
            .map_err(|error| AppError::AudioDevice(error.to_string()))?;

        *active = Some(ActiveRecording {
            id: id.clone(),
            started_at: Instant::now(),
            source_sample_rate,
            path,
            focus_target,
            stream,
            worker,
            error,
        });

        Ok(RecordingStarted { id })
    }

    pub fn stop(&self, expected_id: &str) -> AppResult<StoredRecording> {
        let active_recording = {
            let mut active = self.active.lock();
            let recording = active.take().ok_or(AppError::RecordingNotFound)?;
            if recording.id != expected_id {
                *active = Some(recording);
                return Err(AppError::RecordingNotFound);
            }
            recording
        };

        let ActiveRecording {
            id,
            started_at,
            source_sample_rate,
            path,
            focus_target,
            stream,
            worker,
            error,
        } = active_recording;
        drop(stream);
        let mono = worker
            .join()
            .map_err(|_| AppError::AudioRecording("audio worker panicked".into()))?;
        if let Some(message) = error.lock().clone() {
            return Err(AppError::AudioRecording(message));
        }

        let resampled = resample_linear(&mono, source_sample_rate, TARGET_SAMPLE_RATE);
        write_wave_file(&path, &resampled)?;
        let duration_ms = started_at.elapsed().as_millis() as u64;
        let speaking_ms = estimate_speaking_ms(&mono, source_sample_rate).min(duration_ms);
        let size_bytes = fs::metadata(&path)
            .map_err(|error| AppError::AudioRecording(error.to_string()))?
            .len();

        Ok(StoredRecording {
            descriptor: RecordingDescriptor {
                id,
                duration_ms,
                speaking_ms,
                size_bytes,
                sample_rate: TARGET_SAMPLE_RATE,
                application: focus_target.application.clone(),
            },
            path,
            focus_target,
        })
    }

    pub fn cancel(&self, expected_id: &str) -> AppResult<()> {
        let recording = {
            let mut active = self.active.lock();
            match active.take() {
                Some(recording) if recording.id == expected_id => Some(recording),
                Some(recording) => {
                    *active = Some(recording);
                    None
                }
                None => None,
            }
        };

        if let Some(recording) = recording {
            drop(recording.stream);
            let _ = recording.worker.join();
            let _ = fs::remove_file(recording.path);
        }
        Ok(())
    }

    pub fn cleanup_abandoned(cache_directory: &Path) {
        let Ok(entries) = fs::read_dir(cache_directory) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("dictation-") && name.ends_with(".wav"))
            {
                let _ = fs::remove_file(path);
            }
        }
    }
}

/// Estimates voiced time locally without retaining or uploading analysis data.
/// A conservative 20 ms RMS gate keeps the metric useful while avoiding an
/// expensive speech detector in the realtime audio callback.
fn estimate_speaking_ms(input: &[f32], sample_rate: u32) -> u64 {
    if input.is_empty() || sample_rate == 0 {
        return 0;
    }

    let window_samples = ((sample_rate as usize * SPEECH_WINDOW_MS) / 1_000).max(1);
    let active_samples = input
        .chunks(window_samples)
        .filter(|window| {
            let squared_sum = window.iter().map(|sample| sample * sample).sum::<f32>();
            (squared_sum / window.len() as f32).sqrt() >= SPEECH_RMS_THRESHOLD
        })
        .map(<[f32]>::len)
        .sum::<usize>();

    (active_samples as u64 * 1_000) / u64::from(sample_rate)
}

fn select_device(host: &cpal::Host, microphone_id: Option<&str>) -> AppResult<Device> {
    if let Some(id) = microphone_id {
        let devices = host
            .input_devices()
            .map_err(|error| AppError::AudioDevice(error.to_string()))?;
        for device in devices {
            if device
                .id()
                .ok()
                .is_some_and(|device_id| device_id.to_string() == id)
            {
                return Ok(device);
            }
        }
        return Err(AppError::AudioDevice(
            "selected microphone is unavailable".into(),
        ));
    }

    host.default_input_device()
        .ok_or_else(|| AppError::AudioDevice("no input device is available".into()))
}

fn build_stream(
    device: &Device,
    config: &StreamConfig,
    sample_format: SampleFormat,
    sender: mpsc::SyncSender<Vec<f32>>,
    error: Arc<Mutex<Option<String>>>,
) -> AppResult<Stream> {
    let result = match sample_format {
        SampleFormat::I8 => build_typed_stream::<i8>(device, config, sender, error),
        SampleFormat::I16 => build_typed_stream::<i16>(device, config, sender, error),
        SampleFormat::I24 => build_typed_stream::<I24>(device, config, sender, error),
        SampleFormat::I32 => build_typed_stream::<i32>(device, config, sender, error),
        SampleFormat::I64 => build_typed_stream::<i64>(device, config, sender, error),
        SampleFormat::U8 => build_typed_stream::<u8>(device, config, sender, error),
        SampleFormat::U16 => build_typed_stream::<u16>(device, config, sender, error),
        SampleFormat::U24 => build_typed_stream::<U24>(device, config, sender, error),
        SampleFormat::U32 => build_typed_stream::<u32>(device, config, sender, error),
        SampleFormat::U64 => build_typed_stream::<u64>(device, config, sender, error),
        SampleFormat::F32 => build_typed_stream::<f32>(device, config, sender, error),
        SampleFormat::F64 => build_typed_stream::<f64>(device, config, sender, error),
        other => {
            return Err(AppError::AudioDevice(format!(
                "unsupported sample format: {other:?}"
            )))
        }
    };

    result.map_err(|error| AppError::AudioDevice(error.to_string()))
}

fn build_typed_stream<T>(
    device: &Device,
    config: &StreamConfig,
    sender: mpsc::SyncSender<Vec<f32>>,
    error: Arc<Mutex<Option<String>>>,
) -> Result<Stream, cpal::BuildStreamError>
where
    T: Sample + SizedSample,
    f32: FromSample<T>,
{
    device.build_input_stream(
        config,
        move |data: &[T], _| {
            let converted = data.iter().copied().map(Sample::to_sample::<f32>).collect();
            // The realtime callback must never block. Dropping a chunk under
            // extreme backpressure is safer than stalling the audio device.
            let _ = sender.try_send(converted);
        },
        move |stream_error| {
            *error.lock() = Some(stream_error.to_string());
        },
        None,
    )
}

fn resample_linear(input: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if input.is_empty() || source_rate == target_rate {
        return input.to_vec();
    }

    let output_length =
        (input.len() as u64 * u64::from(target_rate) / u64::from(source_rate)) as usize;
    let ratio = source_rate as f64 / target_rate as f64;
    (0..output_length)
        .map(|index| {
            let source_position = index as f64 * ratio;
            let lower = source_position.floor() as usize;
            let upper = (lower + 1).min(input.len() - 1);
            let fraction = (source_position - lower as f64) as f32;
            input[lower] * (1.0 - fraction) + input[upper] * fraction
        })
        .collect()
}

fn write_wave_file(path: &Path, samples: &[f32]) -> AppResult<()> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|error| AppError::AudioRecording(error.to_string()))?;
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        writer
            .write_sample(value)
            .map_err(|error| AppError::AudioRecording(error.to_string()))?;
    }
    writer
        .finalize()
        .map_err(|error| AppError::AudioRecording(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::estimate_speaking_ms;

    #[test]
    fn speaking_time_ignores_silence_and_counts_voiced_windows() {
        let sample_rate = 1_000;
        let mut samples = vec![0.0; 100];
        samples.extend(vec![0.1; 200]);
        samples.extend(vec![0.0; 100]);

        assert_eq!(estimate_speaking_ms(&samples, sample_rate), 200);
    }

    #[test]
    fn speaking_time_handles_empty_input() {
        assert_eq!(estimate_speaking_ms(&[], 16_000), 0);
        assert_eq!(estimate_speaking_ms(&[0.1], 0), 0);
    }
}
